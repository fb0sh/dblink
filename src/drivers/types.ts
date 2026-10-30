import { DblinkError } from "../errors.js";

export type EngineKind = "postgres" | "mysql" | "redis" | "sqlite" | "mongodb";

export interface ColumnMeta {
  name: string;
  type?: string;
  nullable?: boolean;
  default?: string | null;
  primaryKey?: boolean;
}

export interface IndexMeta {
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface TableDescription {
  columns: ColumnMeta[];
  indexes: IndexMeta[];
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ExecuteResult {
  affectedRows: number;
}

export interface QueryOptions {
  maxRows?: number;
  timeoutMs?: number;
}

export interface MongoFindOptions {
  database?: string;
  filter?: unknown;
  projection?: unknown;
  sort?: unknown;
  limit?: number;
}

export interface MongoAggregateOptions {
  database?: string;
  limit?: number;
}

export interface MongoWriteOperation {
  database?: string;
  collection: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface MongoCollectionDescription {
  sample_document: unknown;
  indexes: unknown[];
  inferred_fields: string[];
}

/** Every engine has a connection lifecycle and nothing more. */
export interface CoreDriver {
  readonly kind: EngineKind;
  connect(): Promise<void>;
  serverVersion(): Promise<string | undefined>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

/** Capability: SQL engines. */
export interface SqlOps {
  query(sql: string, params?: unknown[], opts?: QueryOptions): Promise<QueryResult>;
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>;
  listTables(schema?: string): Promise<string[]>;
  describeTable(table: string, schema?: string): Promise<TableDescription>;
}

/** Capability: Redis. */
export interface RedisOps {
  command(command: string, args: string[]): Promise<unknown>;
}

/** Capability: MongoDB. */
export interface MongoOps {
  find(collection: string, opts: MongoFindOptions): Promise<Record<string, unknown>[]>;
  aggregate(collection: string, pipeline: unknown[], opts: MongoAggregateOptions): Promise<Record<string, unknown>[]>;
  mongoWrite(op: MongoWriteOperation): Promise<Record<string, unknown>>;
  listCollections(database?: string): Promise<string[]>;
  describeCollection(collection: string, database?: string): Promise<MongoCollectionDescription>;
}

/**
 * A driver implements the core lifecycle plus only the capabilities its engine
 * has. Callers narrow through the guards below instead of checking `kind`.
 */
export type Driver = CoreDriver & Partial<SqlOps> & Partial<RedisOps> & Partial<MongoOps>;

export function sqlOps(driver: Driver): Driver & SqlOps {
  if (!driver.query || !driver.execute || !driver.listTables || !driver.describeTable) {
    throw new DblinkError("UNSUPPORTED", "This engine does not support SQL operations", "Use the tool for this engine.");
  }
  return driver as Driver & SqlOps;
}

export function redisOps(driver: Driver): Driver & RedisOps {
  if (!driver.command) {
    throw new DblinkError("UNSUPPORTED", "This engine does not support raw commands", "Use redis_command on a redis connection.");
  }
  return driver as Driver & RedisOps;
}

export function mongoOps(driver: Driver): Driver & MongoOps {
  if (!driver.find || !driver.aggregate || !driver.mongoWrite || !driver.listCollections || !driver.describeCollection) {
    throw new DblinkError("UNSUPPORTED", "This engine does not support MongoDB operations", "Use the mongo_* tools.");
  }
  return driver as Driver & MongoOps;
}
