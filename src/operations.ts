import { mongoOps, redisOps, sqlOps } from "./drivers/types.js";
import type {
  MongoAggregateOptions,
  MongoCollectionDescription,
  MongoFindOptions,
  MongoWriteOperation,
} from "./drivers/types.js";
import { DblinkError } from "./errors.js";
import { assertReadOnlySql, assertSingleStatement } from "./guard.js";
import { assertAggregatePipeline, assertNoServerSideJs } from "./mongo-guard.js";
import type { ConnectionRegistry } from "./registry.js";
import { MAX_BYTES, MAX_LIMIT, effectiveRowLimit, shapeList, shapeRows } from "./result.js";

const READONLY_REDIS_COMMANDS = new Set([
  "GET", "MGET", "STRLEN", "EXISTS", "TYPE", "TTL", "PTTL", "SCAN",
  "HGET", "HGETALL", "HMGET", "HKEYS", "HVALS", "HLEN", "HEXISTS",
  "LRANGE", "LLEN", "LINDEX", "SMEMBERS", "SCARD", "SISMEMBER",
  "ZRANGE", "ZRANGEBYSCORE", "ZCARD", "ZSCORE", "ZRANK",
  "DBSIZE", "INFO", "PING",
]);

export interface QueryShaped {
  columns: string[];
  rows: Record<string, unknown>[];
  rows_returned: number;
  truncated: boolean;
  truncation_reason?: "rows" | "bytes";
  row_limit: number;
}

export interface MongoShaped {
  documents: Record<string, unknown>[];
  count: number;
  truncated: boolean;
  truncation_reason?: "rows" | "bytes";
  row_limit: number;
}

type Reason = "rows" | "bytes" | undefined;

function reasonField(reason: Reason): { truncation_reason?: "rows" | "bytes" } {
  return reason ? { truncation_reason: reason } : {};
}

/**
 * Every engine operation lives here, behind one interface. `ConnectionRegistry`
 * owns lifecycle only; this module owns capability dispatch, read-only policy,
 * guards and result capping — the single seam where limits are enforced.
 */
export class EngineOperations {
  constructor(private readonly registry: ConnectionRegistry) {}

  private limit(requestedLimit?: number): number {
    if (requestedLimit !== undefined && requestedLimit > MAX_LIMIT) {
      throw new DblinkError(
        "LIMIT_EXCEEDED",
        `Requested limit ${requestedLimit} exceeds the maximum of ${MAX_LIMIT}`,
        `Use limit <= ${MAX_LIMIT}.`,
      );
    }
    return effectiveRowLimit(requestedLimit);
  }

  async query(
    id: string,
    sql: string,
    params?: unknown[],
    opts: { requestedLimit?: number } = {},
  ): Promise<QueryShaped> {
    const conn = this.registry.resolve(id);
    assertReadOnlySql(sql);
    const limit = this.limit(opts.requestedLimit);
    const raw = await conn.run((d) => sqlOps(d).query(sql, params, { maxRows: limit + 1 }));
    const shaped = shapeRows(raw.rows, { requestedLimit: opts.requestedLimit });
    return {
      columns: raw.columns,
      rows: shaped.rows,
      rows_returned: shaped.rows.length,
      truncated: shaped.truncated,
      ...reasonField(shaped.reason),
      row_limit: shaped.rowLimit,
    };
  }

  async execute(id: string, sql: string, params?: unknown[]): Promise<{ affected_rows: number }> {
    const conn = this.registry.resolve(id);
    if (conn.readOnly) {
      throw new DblinkError(
        "READ_ONLY_VIOLATION",
        "This connection is read-only; db_execute is not allowed",
        "Re-open the connection with read_only=false to allow writes.",
      );
    }
    assertSingleStatement(sql);
    const res = await conn.run((d) => sqlOps(d).execute(sql, params));
    return { affected_rows: res.affectedRows };
  }

  async listTables(id: string, schema?: string): Promise<{ tables: string[]; count: number; truncated: boolean; truncation_reason?: "rows" | "bytes" }> {
    const conn = this.registry.resolve(id);
    const tables = await conn.run((d) => sqlOps(d).listTables(schema));
    const shaped = shapeList(tables);
    return { tables: shaped.items, count: shaped.items.length, truncated: shaped.truncated, ...reasonField(shaped.reason) };
  }

  async describeTable(
    id: string,
    table: string,
    schema?: string,
  ): Promise<{ columns: unknown[]; indexes: unknown[]; truncated: boolean }> {
    const conn = this.registry.resolve(id);
    const desc = await conn.run((d) => sqlOps(d).describeTable(table, schema));
    const columns = shapeList(desc.columns);
    const indexes = shapeList(desc.indexes);
    return { columns: columns.items, indexes: indexes.items, truncated: columns.truncated || indexes.truncated };
  }

  async mongoFind(id: string, collection: string, opts: MongoFindOptions = {}): Promise<MongoShaped> {
    const conn = this.registry.resolve(id);
    assertNoServerSideJs(opts.filter);
    const limit = this.limit(opts.limit);
    const docs = await conn.run((d) => mongoOps(d).find(collection, { ...opts, limit: limit + 1 }));
    const shaped = shapeRows(docs, { requestedLimit: opts.limit });
    return { documents: shaped.rows, count: shaped.rows.length, truncated: shaped.truncated, ...reasonField(shaped.reason), row_limit: shaped.rowLimit };
  }

  async mongoAggregate(
    id: string,
    collection: string,
    pipeline: unknown[],
    opts: MongoAggregateOptions = {},
  ): Promise<MongoShaped> {
    const conn = this.registry.resolve(id);
    assertAggregatePipeline(pipeline, conn.readOnly);
    const limit = this.limit(opts.limit);
    const docs = await conn.run((d) => mongoOps(d).aggregate(collection, pipeline, { ...opts, limit: limit + 1 }));
    const shaped = shapeRows(docs, { requestedLimit: opts.limit });
    return { documents: shaped.rows, count: shaped.rows.length, truncated: shaped.truncated, ...reasonField(shaped.reason), row_limit: shaped.rowLimit };
  }

  async mongoWrite(id: string, op: MongoWriteOperation): Promise<Record<string, unknown>> {
    const conn = this.registry.resolve(id);
    assertNoServerSideJs(op.payload.filter);
    assertNoServerSideJs(op.payload.update);
    if (conn.readOnly) {
      throw new DblinkError(
        "READ_ONLY_VIOLATION",
        "This connection is read-only; mongo_write is not allowed",
        "Re-open the connection with read_only=false to allow writes.",
      );
    }
    return conn.run((d) => mongoOps(d).mongoWrite(op));
  }

  async mongoListCollections(
    id: string,
    database?: string,
  ): Promise<{ collections: string[]; count: number; truncated: boolean; truncation_reason?: "rows" | "bytes" }> {
    const conn = this.registry.resolve(id);
    const collections = await conn.run((d) => mongoOps(d).listCollections(database));
    const shaped = shapeList(collections);
    return { collections: shaped.items, count: shaped.items.length, truncated: shaped.truncated, ...reasonField(shaped.reason) };
  }

  async mongoDescribeCollection(id: string, collection: string, database?: string): Promise<MongoCollectionDescription & { collection: string; truncated: boolean }> {
    const conn = this.registry.resolve(id);
    const desc = await conn.run((d) => mongoOps(d).describeCollection(collection, database));
    const indexes = shapeList(desc.indexes);
    const sampleBytes = Buffer.byteLength(JSON.stringify(desc.sample_document ?? null), "utf8");
    if (sampleBytes > MAX_BYTES) {
      throw new DblinkError("LIMIT_EXCEEDED", "Sample document exceeds the result byte limit");
    }
    return { collection, sample_document: desc.sample_document, indexes: indexes.items, inferred_fields: desc.inferred_fields, truncated: indexes.truncated };
  }

  async redisCommand(
    id: string,
    command: string,
    args: string[],
  ): Promise<{ command: string; result: unknown; truncated: boolean; truncation_reason?: "rows" | "bytes" }> {
    const conn = this.registry.resolve(id);
    const normalized = command.trim().toUpperCase();
    if (!READONLY_REDIS_COMMANDS.has(normalized)) {
      throw new DblinkError(
        "UNSUPPORTED",
        `Command not allowed: ${normalized}`,
        "redis_command only permits read-only commands.",
      );
    }
    const result = await conn.run((d) => redisOps(d).command(normalized, args));
    if (Array.isArray(result)) {
      const shaped = shapeList(result);
      return { command: normalized, result: shaped.items, truncated: shaped.truncated, ...reasonField(shaped.reason) };
    }
    if (Buffer.byteLength(JSON.stringify(result ?? null), "utf8") > MAX_BYTES) {
      throw new DblinkError("LIMIT_EXCEEDED", `Redis result exceeds ${MAX_BYTES} bytes`, "Narrow the command (e.g. SCAN or LRANGE with bounds).");
    }
    return { command: normalized, result, truncated: false };
  }
}
