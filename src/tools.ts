import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DblinkError, toErrorPayload } from "./errors.js";
import { assertReadOnlySql, assertSingleStatement } from "./guard.js";
import { assertAggregatePipeline, assertNoServerSideJs } from "./mongo-guard.js";
import type { ConnectionRegistry } from "./registry.js";
import { MAX_BYTES, MAX_LIMIT, shapeList } from "./result.js";

const READONLY_REDIS_COMMANDS = new Set([
  "GET",
  "MGET",
  "STRLEN",
  "EXISTS",
  "TYPE",
  "TTL",
  "PTTL",
  "SCAN",
  "HGET",
  "HGETALL",
  "HMGET",
  "HKEYS",
  "HVALS",
  "HLEN",
  "HEXISTS",
  "LRANGE",
  "LLEN",
  "LINDEX",
  "SMEMBERS",
  "SCARD",
  "SISMEMBER",
  "ZRANGE",
  "ZRANGEBYSCORE",
  "ZCARD",
  "ZSCORE",
  "ZRANK",
  "DBSIZE",
  "INFO",
  "PING",
]);

type ToolResponse = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: Record<string, unknown>): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...data }) }] };
}

function fail(e: unknown): ToolResponse {
  const error = toErrorPayload(e);
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, error }) }], isError: true };
}

async function run(fn: () => Promise<Record<string, unknown>>): Promise<ToolResponse> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

function requireSqlEngine(registry: ConnectionRegistry, connectionId: string): void {
  const kind = registry.kindOf(connectionId);
  if (kind === "redis" || kind === "mongodb") {
    throw new DblinkError(
      "UNSUPPORTED",
      `${kind} connections do not support SQL tools`,
      kind === "mongodb" ? "Use the mongo_* tools." : "Use redis_command.",
    );
  }
}

function requireMongoEngine(registry: ConnectionRegistry, connectionId: string): void {
  if (registry.kindOf(connectionId) !== "mongodb") {
    throw new DblinkError("UNSUPPORTED", "This tool requires a mongodb connection");
  }
}

const mongoObject = z.record(z.string(), z.any());

export function registerTools(server: McpServer, registry: ConnectionRegistry): void {
  server.registerTool(
    "open_connection",
    {
      description:
        "Open (or reuse) a database connection. Returns a connection_id used by the other tools. DSN schemes: postgres://, mysql://, redis://, mongodb://, mongodb+srv://, sqlite:",
      inputSchema: {
        dsn: z.string().describe("Database URL / DSN"),
        read_only: z.boolean().optional().describe("Read-only connection (default true)"),
        name: z.string().optional().describe("Optional human-friendly label"),
      },
    },
    async ({ dsn, read_only, name }) =>
      run(async () => {
        const res = await registry.open(dsn, { readOnly: read_only ?? true, name });
        return {
          connection_id: res.connection_id,
          kind: res.kind,
          status: res.status,
          read_only: res.read_only,
          server_version: res.server_version,
          reused: res.reused,
          ...(name ? { name } : {}),
        };
      }),
  );

  server.registerTool(
    "close_connection",
    {
      description: "Close a connection and release its pool.",
      inputSchema: { connection_id: z.string() },
    },
    async ({ connection_id }) =>
      run(async () => {
        await registry.close(connection_id);
        return { closed: true, connection_id };
      }),
  );

  server.registerTool(
    "list_connections",
    {
      description: "List active connections with alive/dead status.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const connections = await registry.list();
        return { connections, count: connections.length };
      }),
  );

  server.registerTool(
    "db_query",
    {
      description: "Run a read-only SQL statement (SELECT/SHOW/EXPLAIN/read-only WITH) and return rows.",
      inputSchema: {
        connection_id: z.string(),
        sql: z.string(),
        params: z.array(z.any()).optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    async ({ connection_id, sql, params, limit }) =>
      run(async () => {
        requireSqlEngine(registry, connection_id);
        if (limit !== undefined && limit > MAX_LIMIT) {
          throw new DblinkError(
            "LIMIT_EXCEEDED",
            `Requested limit ${limit} exceeds the maximum of ${MAX_LIMIT}`,
            `Use limit <= ${MAX_LIMIT}.`,
          );
        }
        assertReadOnlySql(sql);
        const res = await registry.query(connection_id, sql, params, { requestedLimit: limit });
        return {
          columns: res.columns,
          rows: res.rows,
          rows_returned: res.rows.length,
          truncated: res.truncated,
          ...(res.reason ? { truncation_reason: res.reason } : {}),
          row_limit: res.row_limit,
        };
      }),
  );

  server.registerTool(
    "db_execute",
    {
      description: "Run a write statement on a writable connection (read_only=false). Returns affected_rows.",
      inputSchema: {
        connection_id: z.string(),
        sql: z.string(),
        params: z.array(z.any()).optional(),
      },
    },
    async ({ connection_id, sql, params }) =>
      run(async () => {
        requireSqlEngine(registry, connection_id);
        assertSingleStatement(sql);
        const res = await registry.execute(connection_id, sql, params);
        return { affected_rows: res.affected_rows };
      }),
  );

  server.registerTool(
    "db_list_tables",
    {
      description: "List tables/views in the connected database.",
      inputSchema: { connection_id: z.string(), schema: z.string().optional() },
    },
    async ({ connection_id, schema }) =>
      run(async () => {
        requireSqlEngine(registry, connection_id);
        const tables = await registry.listTables(connection_id, schema);
        const shaped = shapeList(tables);
        return {
          tables: shaped.items,
          count: shaped.items.length,
          truncated: shaped.truncated,
          ...(shaped.reason ? { truncation_reason: shaped.reason } : {}),
        };
      }),
  );

  server.registerTool(
    "db_describe_table",
    {
      description: "Describe a table: columns (name/type/nullable/default) and indexes.",
      inputSchema: {
        connection_id: z.string(),
        table: z.string(),
        schema: z.string().optional(),
      },
    },
    async ({ connection_id, table, schema }) =>
      run(async () => {
        requireSqlEngine(registry, connection_id);
        const desc = await registry.describeTable(connection_id, table, schema);
        const columns = shapeList(desc.columns);
        const indexes = shapeList(desc.indexes);
        return {
          table,
          columns: columns.items,
          indexes: indexes.items,
          truncated: columns.truncated || indexes.truncated,
        };
      }),
  );

  server.registerTool(
    "redis_command",
    {
      description: "Run a read-only Redis command (allow-list). Writes return UNSUPPORTED.",
      inputSchema: {
        connection_id: z.string(),
        command: z.string(),
        args: z.array(z.string()).optional(),
      },
    },
    async ({ connection_id, command, args }) =>
      run(async () => {
        if (registry.kindOf(connection_id) !== "redis") {
          throw new DblinkError("UNSUPPORTED", "redis_command requires a redis connection");
        }
        const normalized = command.trim().toUpperCase();
        if (!READONLY_REDIS_COMMANDS.has(normalized)) {
          throw new DblinkError(
            "UNSUPPORTED",
            `Command not allowed: ${normalized}`,
            "redis_command only permits read-only commands.",
          );
        }
        const result = await registry.command(connection_id, normalized, args ?? []);
        if (Array.isArray(result)) {
          const shaped = shapeList(result);
          return {
            command: normalized,
            result: shaped.items,
            truncated: shaped.truncated,
            ...(shaped.reason ? { truncation_reason: shaped.reason } : {}),
          };
        }
        if (Buffer.byteLength(JSON.stringify(result ?? null), "utf8") > MAX_BYTES) {
          throw new DblinkError(
            "LIMIT_EXCEEDED",
            `Redis result exceeds ${MAX_BYTES} bytes`,
            "Narrow the command (e.g. SCAN or LRANGE with bounds).",
          );
        }
        return { command: normalized, result };
      }),
  );

  server.registerTool(
    "mongo_find",
    {
      description:
        "Query documents from a MongoDB collection. filter/projection/sort accept relaxed EJSON. Returns relaxed EJSON documents.",
      inputSchema: {
        connection_id: z.string(),
        collection: z.string(),
        filter: mongoObject.optional(),
        projection: mongoObject.optional(),
        sort: mongoObject.optional(),
        limit: z.number().int().positive().optional(),
        database: z.string().optional(),
      },
    },
    async ({ connection_id, collection, filter, projection, sort, limit, database }) =>
      run(async () => {
        requireMongoEngine(registry, connection_id);
        assertNoServerSideJs(filter);
        if (limit !== undefined && limit > MAX_LIMIT) {
          throw new DblinkError("LIMIT_EXCEEDED", `Requested limit ${limit} exceeds the maximum of ${MAX_LIMIT}`);
        }
        const res = await registry.mongoFind(connection_id, collection, {
          filter,
          projection,
          sort,
          limit,
          database,
        });
        return {
          documents: res.documents,
          count: res.documents.length,
          truncated: res.truncated,
          ...(res.reason ? { truncation_reason: res.reason } : {}),
          row_limit: res.row_limit,
        };
      }),
  );

  server.registerTool(
    "mongo_aggregate",
    {
      description: "Run a MongoDB aggregation pipeline. Read-only connections reject $out/$merge.",
      inputSchema: {
        connection_id: z.string(),
        collection: z.string(),
        pipeline: z.unknown(),
        limit: z.number().int().positive().optional(),
        database: z.string().optional(),
      },
    },
    async ({ connection_id, collection, pipeline, limit, database }) =>
      run(async () => {
        requireMongoEngine(registry, connection_id);
        if (limit !== undefined && limit > MAX_LIMIT) {
          throw new DblinkError("LIMIT_EXCEEDED", `Requested limit ${limit} exceeds the maximum of ${MAX_LIMIT}`);
        }
        const readOnly = registry.isReadOnly(connection_id);
        assertAggregatePipeline(pipeline, readOnly);
        const res = await registry.mongoAggregate(connection_id, collection, pipeline as unknown[], { limit, database });
        return {
          documents: res.documents,
          count: res.documents.length,
          truncated: res.truncated,
          ...(res.reason ? { truncation_reason: res.reason } : {}),
          row_limit: res.row_limit,
        };
      }),
  );

  server.registerTool(
    "mongo_write",
    {
      description:
        "Write to MongoDB (action: insert|update|delete). Only allowed on writable connections (read_only=false).",
      inputSchema: {
        connection_id: z.string(),
        collection: z.string(),
        action: z.string(),
        payload: mongoObject,
        database: z.string().optional(),
      },
    },
    async ({ connection_id, collection, action, payload, database }) =>
      run(async () => {
        requireMongoEngine(registry, connection_id);
        const res = await registry.mongoWrite(connection_id, { collection, action, payload, database });
        return { action, collection, ...res };
      }),
  );

  server.registerTool(
    "mongo_list_collections",
    {
      description: "List collections in a MongoDB database.",
      inputSchema: { connection_id: z.string(), database: z.string().optional() },
    },
    async ({ connection_id, database }) =>
      run(async () => {
        requireMongoEngine(registry, connection_id);
        const collections = await registry.mongoListCollections(connection_id, database);
        const shaped = shapeList(collections);
        return {
          collections: shaped.items,
          count: shaped.items.length,
          truncated: shaped.truncated,
        };
      }),
  );

  server.registerTool(
    "mongo_describe_collection",
    {
      description: "Describe a MongoDB collection: sample document (EJSON), indexes and inferred fields.",
      inputSchema: {
        connection_id: z.string(),
        collection: z.string(),
        database: z.string().optional(),
      },
    },
    async ({ connection_id, collection, database }) =>
      run(async () => {
        requireMongoEngine(registry, connection_id);
        const desc = await registry.mongoDescribeCollection(connection_id, collection, database);
        const indexes = shapeList(desc.indexes);
        const sampleBytes = Buffer.byteLength(JSON.stringify(desc.sample_document ?? null), "utf8");
        if (sampleBytes > MAX_BYTES) {
          throw new DblinkError("LIMIT_EXCEEDED", "Sample document exceeds the result byte limit");
        }
        return {
          collection,
          sample_document: desc.sample_document,
          indexes: indexes.items,
          inferred_fields: desc.inferred_fields,
          truncated: indexes.truncated,
        };
      }),
  );
}

