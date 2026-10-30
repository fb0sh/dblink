import { DblinkError } from "../errors.js";
import { MongoDriver } from "./mongodb.js";
import { MysqlDriver } from "./mysql.js";
import { PostgresDriver } from "./postgres.js";
import { RedisDriver } from "./redis.js";
import { SqliteDriver, sqlitePathFromDsn } from "./sqlite.js";
import type { Driver, EngineKind } from "./types.js";

export function detectKind(dsn: string): EngineKind {
  if (/^postgres(ql)?:\/\//i.test(dsn)) return "postgres";
  if (/^mysql:\/\//i.test(dsn)) return "mysql";
  if (/^rediss?:\/\//i.test(dsn)) return "redis";
  if (/^mongodb(\+srv)?:\/\//i.test(dsn)) return "mongodb";
  if (/^sqlite:/i.test(dsn)) return "sqlite";
  throw new DblinkError(
    "UNSUPPORTED",
    `Unsupported DSN scheme: ${dsn.split(":")[0] ?? dsn}`,
    "Supported: postgres://, mysql://, redis://, mongodb://, sqlite:",
  );
}

export interface CreateDriverOptions {
  readOnly: boolean;
  poolSize: number;
}

export function createDriver(kind: EngineKind, dsn: string, opts: CreateDriverOptions): Driver {
  switch (kind) {
    case "sqlite":
      return new SqliteDriver(sqlitePathFromDsn(dsn), opts.readOnly);
    case "postgres":
      return new PostgresDriver(dsn, opts.readOnly, opts.poolSize);
    case "mysql":
      return new MysqlDriver(dsn, opts.readOnly, opts.poolSize);
    case "redis":
      return new RedisDriver(dsn);
    case "mongodb":
      return new MongoDriver(dsn, opts.poolSize);
    default:
      throw new DblinkError("UNSUPPORTED", `Unsupported engine kind: ${kind}`);
  }
}

export type { Driver, EngineKind } from "./types.js";
