import { DblinkError } from "../errors.js";
import { MongoDriver } from "./mongodb.js";
import { MysqlDriver } from "./mysql.js";
import { PostgresDriver } from "./postgres.js";
import { RedisDriver } from "./redis.js";
import { SqliteDriver, sqlitePathFromDsn } from "./sqlite.js";
import type { Driver, EngineKind } from "./types.js";

export type Capability = "sql" | "redis" | "mongodb";

export interface EngineAdapter {
  readonly kind: EngineKind;
  readonly capabilities: readonly Capability[];
  match(dsn: string): boolean;
  create(dsn: string, opts: { readOnly: boolean; poolSize: number }): Driver;
}

const ADAPTERS: readonly EngineAdapter[] = [
  {
    kind: "postgres",
    capabilities: ["sql"],
    match: (dsn) => /^postgres(ql)?:\/\//i.test(dsn),
    create: (dsn, o) => new PostgresDriver(dsn, o.readOnly, o.poolSize),
  },
  {
    kind: "mysql",
    capabilities: ["sql"],
    match: (dsn) => /^mysql:\/\//i.test(dsn),
    create: (dsn, o) => new MysqlDriver(dsn, o.readOnly, o.poolSize),
  },
  {
    kind: "redis",
    capabilities: ["redis"],
    match: (dsn) => /^rediss?:\/\//i.test(dsn),
    create: (dsn) => new RedisDriver(dsn),
  },
  {
    kind: "mongodb",
    capabilities: ["mongodb"],
    match: (dsn) => /^mongodb(\+srv)?:\/\//i.test(dsn),
    create: (dsn, o) => new MongoDriver(dsn, o.poolSize),
  },
  {
    kind: "sqlite",
    capabilities: ["sql"],
    match: (dsn) => /^sqlite:/i.test(dsn),
    create: (dsn, o) => new SqliteDriver(sqlitePathFromDsn(dsn), o.readOnly),
  },
];

function adapterForKind(kind: EngineKind): EngineAdapter {
  const adapter = ADAPTERS.find((a) => a.kind === kind);
  if (!adapter) throw new DblinkError("UNSUPPORTED", `Unsupported engine kind: ${kind}`);
  return adapter;
}

export function detectKind(dsn: string): EngineKind {
  const adapter = ADAPTERS.find((a) => a.match(dsn));
  if (!adapter) {
    throw new DblinkError(
      "UNSUPPORTED",
      `Unsupported DSN scheme: ${dsn.split(":")[0] ?? dsn}`,
      "Supported: postgres://, mysql://, redis://, mongodb://, sqlite:",
    );
  }
  return adapter.kind;
}

export interface CreateDriverOptions {
  readOnly: boolean;
  poolSize: number;
}

export function createDriver(kind: EngineKind, dsn: string, opts: CreateDriverOptions): Driver {
  return adapterForKind(kind).create(dsn, opts);
}

export function capabilitiesOf(kind: EngineKind): readonly Capability[] {
  return adapterForKind(kind).capabilities;
}

export type { Driver, EngineKind } from "./types.js";
