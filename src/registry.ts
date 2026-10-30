import { randomBytes } from "node:crypto";
import { DblinkError } from "./errors.js";
import { createDriver, detectKind } from "./drivers/index.js";
import { sqlitePathFromDsn } from "./drivers/sqlite.js";
import type { Driver, EngineKind, TableDescription } from "./drivers/types.js";
import { effectiveRowLimit, shapeRows } from "./result.js";

export interface RegistryOptions {
  poolSize?: number;
  idleMs?: number;
  maxPools?: number;
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

export interface QueryShaped {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  reason?: "rows" | "bytes";
  row_limit: number;
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

export class ConnectionRegistry {
  private readonly byFingerprint = new Map<string, Entry>();
  private readonly byId = new Map<string, Entry>();
  private readonly closedIds = new Set<string>();
  private readonly poolSize: number;
  private readonly idleMs: number;
  private readonly maxPools: number;
  private readonly factory: NonNullable<RegistryOptions["driverFactory"]>;
  private readonly clock: () => number;

  constructor(opts: RegistryOptions = {}) {
    this.poolSize = opts.poolSize ?? 5;
    this.idleMs = opts.idleMs ?? 15 * 60 * 1000;
    this.maxPools = opts.maxPools ?? 20;
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

  kindOf(id: string): EngineKind {
    return this.require(id).kind;
  }

  async query(
    id: string,
    sql: string,
    params?: unknown[],
    opts: { requestedLimit?: number; timeoutMs?: number } = {},
  ): Promise<QueryShaped> {
    const entry = this.require(id);
    const limit = effectiveRowLimit(opts.requestedLimit);
    const raw = await this.withReconnect(entry, (d) =>
      d.query(sql, params, { maxRows: limit + 1, timeoutMs: opts.timeoutMs ?? 30000 }),
    );
    const shaped = shapeRows(raw.rows, { requestedLimit: opts.requestedLimit });
    return {
      columns: raw.columns,
      rows: shaped.rows,
      truncated: shaped.truncated,
      reason: shaped.reason,
      row_limit: shaped.rowLimit,
    };
  }

  async execute(id: string, sql: string, params?: unknown[]): Promise<{ affected_rows: number }> {
    const entry = this.require(id);
    if (entry.readOnly) {
      throw new DblinkError(
        "READ_ONLY_VIOLATION",
        "This connection is read-only; db_execute is not allowed",
        "Re-open the connection with read_only=false to allow writes.",
      );
    }
    const res = await this.withReconnect(entry, (d) => d.execute(sql, params));
    return { affected_rows: res.affectedRows };
  }

  async listTables(id: string, schema?: string): Promise<string[]> {
    const entry = this.require(id);
    return this.withReconnect(entry, (d) => d.listTables(schema));
  }

  async describeTable(id: string, table: string, schema?: string): Promise<TableDescription> {
    const entry = this.require(id);
    return this.withReconnect(entry, (d) => d.describeTable(table, schema));
  }

  async command(id: string, command: string, args: string[]): Promise<unknown> {
    const entry = this.require(id);
    if (!entry.driver.command) {
      throw new DblinkError("UNSUPPORTED", "This connection does not support raw commands");
    }
    return this.withReconnect(entry, (d) => d.command!(command, args));
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

  private async withReconnect<T>(entry: Entry, fn: (driver: Driver) => Promise<T>): Promise<T> {
    entry.lastUsedAt = this.clock();
    try {
      return await fn(entry.driver);
    } catch (e) {
      if (!isConnectionError(e)) throw e;
      try {
        await entry.driver.close();
      } catch {
        /* ignore */
      }
      await entry.driver.connect();
      entry.lastUsedAt = this.clock();
      return await fn(entry.driver);
    }
  }
}
