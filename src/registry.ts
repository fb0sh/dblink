import { randomBytes } from "node:crypto";
import { createDriver, detectKind } from "./drivers/index.js";
import { sqlitePathFromDsn } from "./drivers/sqlite.js";
import type { Driver, EngineKind } from "./drivers/types.js";
import { DblinkError } from "./errors.js";

const DEFAULT_STATEMENT_TIMEOUT_MS = 30000;

export interface Scheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultScheduler: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface RegistryOptions {
  poolSize?: number;
  idleMs?: number;
  maxPools?: number;
  statementTimeoutMs?: number;
  scheduler?: Scheduler;
  driverFactory?: (kind: EngineKind, dsn: string, opts: { readOnly: boolean; poolSize: number }) => Driver;
  now?: () => number;
}

export interface OpenOptions {
  readOnly?: boolean;
  name?: string;
}

export interface OpenResult {
  connection_id: string;
  kind: EngineKind;
  status: "connected";
  read_only: boolean;
  server_version?: string;
  reused: boolean;
}

export interface PublicConnection {
  connection_id: string;
  kind: EngineKind;
  read_only: boolean;
  name?: string;
  status: "connected";
  created_at: string;
  last_used_at: string;
  idle_ms: number;
  alive: boolean;
}

interface Entry {
  id: string;
  fingerprint: string;
  dsn: string;
  kind: EngineKind;
  readOnly: boolean;
  name?: string;
  driver: Driver;
  createdAt: number;
  lastUsedAt: number;
}

function isConnectionError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /connection.*(closed|terminated|ended|reset)|not connected|ECONNRESET|ECONNREFUSED|Connection terminated|server closed the connection|Connection is closed|closed state/i.test(
    m,
  );
}

async function safeVersion(driver: Driver): Promise<string | undefined> {
  try {
    return await driver.serverVersion();
  } catch {
    return undefined;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, scheduler: Scheduler): Promise<T> {
  let handle: unknown;
  const timeout = new Promise<never>((_, reject) => {
    handle = scheduler.set(
      () => reject(new DblinkError("TIMEOUT", `Statement timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (handle !== undefined) scheduler.clear(handle);
  });
}

/**
 * A resolved connection handle. Owns the per-connection policy every operation
 * shares: touch-on-use, statement timeout, and one reconnect retry.
 */
export class Connection {
  constructor(
    private readonly entry: Entry,
    private readonly clock: () => number,
    private readonly timeoutMs: number,
    private readonly scheduler: Scheduler,
  ) {}

  get id(): string {
    return this.entry.id;
  }

  get kind(): EngineKind {
    return this.entry.kind;
  }

  get readOnly(): boolean {
    return this.entry.readOnly;
  }

  get driver(): Driver {
    return this.entry.driver;
  }

  touch(): void {
    this.entry.lastUsedAt = this.clock();
  }

  async run<T>(fn: (driver: Driver) => Promise<T>, timeoutMs: number = this.timeoutMs): Promise<T> {
    this.touch();
    try {
      return await withTimeout(fn(this.entry.driver), timeoutMs, this.scheduler);
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      try {
        await this.entry.driver.close();
      } catch {
        /* ignore */
      }
      await this.entry.driver.connect();
      this.touch();
      return await withTimeout(fn(this.entry.driver), timeoutMs, this.scheduler);
    }
  }
}

export class ConnectionRegistry {
  private readonly byFingerprint = new Map<string, Entry>();
  private readonly byId = new Map<string, Entry>();
  private readonly closedIds = new Set<string>();
  private readonly poolSize: number;
  private readonly idleMs: number;
  private readonly maxPools: number;
  private readonly statementTimeoutMs: number;
  private readonly scheduler: Scheduler;
  private readonly factory: NonNullable<RegistryOptions["driverFactory"]>;
  private readonly clock: () => number;

  constructor(opts: RegistryOptions = {}) {
    this.poolSize = opts.poolSize ?? 5;
    this.idleMs = opts.idleMs ?? 15 * 60 * 1000;
    this.maxPools = opts.maxPools ?? 20;
    this.statementTimeoutMs = opts.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
    this.scheduler = opts.scheduler ?? defaultScheduler;
    this.factory = opts.driverFactory ?? ((kind, dsn, o) => createDriver(kind, dsn, o));
    this.clock = opts.now ?? Date.now;
  }

  static fingerprint(dsn: string): string {
    if (/^sqlite:/i.test(dsn)) return `sqlite:${sqlitePathFromDsn(dsn)}`;
    try {
      const u = new URL(dsn);
      const user = u.username ? `${u.username}@` : "";
      const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
      const qs = params.map(([k, v]) => `${k}=${v}`).join("&");
      return `${u.protocol}//${user}${u.host}${u.pathname}${qs ? `?${qs}` : ""}`;
    } catch {
      return dsn;
    }
  }

  async open(dsn: string, opts: OpenOptions = {}): Promise<OpenResult> {
    const kind = detectKind(dsn);
    const readOnly = opts.readOnly ?? true;
    const key = `${ConnectionRegistry.fingerprint(dsn)}|ro=${readOnly}`;

    const existing = this.byFingerprint.get(key);
    if (existing) {
      existing.lastUsedAt = this.clock();
      return {
        connection_id: existing.id,
        kind,
        status: "connected",
        read_only: readOnly,
        server_version: await safeVersion(existing.driver),
        reused: true,
      };
    }

    await this.evictIdle();
    if (this.byFingerprint.size >= this.maxPools) {
      throw new DblinkError(
        "LIMIT_EXCEEDED",
        `Maximum number of connection pools (${this.maxPools}) reached`,
        "Close unused connections with close_connection.",
      );
    }

    const driver = this.factory(kind, dsn, { readOnly, poolSize: this.poolSize });
    try {
      await driver.connect();
    } catch (e) {
      try {
        await driver.close();
      } catch {
        /* ignore */
      }
      throw e;
    }

    const now = this.clock();
    const entry: Entry = {
      id: `conn_${randomBytes(6).toString("hex")}`,
      fingerprint: key,
      dsn,
      kind,
      readOnly,
      name: opts.name,
      driver,
      createdAt: now,
      lastUsedAt: now,
    };
    this.byFingerprint.set(key, entry);
    this.byId.set(entry.id, entry);

    return {
      connection_id: entry.id,
      kind,
      status: "connected",
      read_only: readOnly,
      server_version: await safeVersion(driver),
      reused: false,
    };
  }

  private require(id: string): Entry {
    if (this.closedIds.has(id)) {
      throw new DblinkError("CONN_CLOSED", `Connection ${id} is closed`, "Open a new connection.");
    }
    const entry = this.byId.get(id);
    if (!entry) {
      throw new DblinkError("CONN_NOT_FOUND", `Unknown connection: ${id}`, "Call open_connection first.");
    }
    return entry;
  }

  resolve(id: string): Connection {
    return new Connection(this.require(id), this.clock, this.statementTimeoutMs, this.scheduler);
  }

  async list(): Promise<PublicConnection[]> {
    const now = this.clock();
    const out: PublicConnection[] = [];
    for (const entry of this.byId.values()) {
      const alive = await entry.driver.ping().catch(() => false);
      out.push({
        connection_id: entry.id,
        kind: entry.kind,
        read_only: entry.readOnly,
        name: entry.name,
        status: "connected",
        created_at: new Date(entry.createdAt).toISOString(),
        last_used_at: new Date(entry.lastUsedAt).toISOString(),
        idle_ms: now - entry.lastUsedAt,
        alive,
      });
    }
    return out;
  }

  async close(id: string): Promise<void> {
    const entry = this.byId.get(id);
    if (!entry) {
      if (this.closedIds.has(id)) return;
      throw new DblinkError("CONN_NOT_FOUND", `Unknown connection: ${id}`);
    }
    this.byId.delete(id);
    this.byFingerprint.delete(entry.fingerprint);
    this.closedIds.add(id);
    await entry.driver.close();
  }

  async closeAll(): Promise<void> {
    const entries = [...this.byId.values()];
    this.byId.clear();
    this.byFingerprint.clear();
    await Promise.all(entries.map((e) => e.driver.close().catch(() => undefined)));
  }

  private async evictIdle(): Promise<void> {
    const now = this.clock();
    for (const [key, entry] of [...this.byFingerprint.entries()]) {
      if (now - entry.lastUsedAt > this.idleMs) {
        this.byFingerprint.delete(key);
        this.byId.delete(entry.id);
        this.closedIds.add(entry.id);
        await entry.driver.close().catch(() => undefined);
      }
    }
  }
}
