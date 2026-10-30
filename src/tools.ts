import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toErrorPayload } from "./errors.js";
import type { EngineOperations } from "./operations.js";
import type { ConnectionRegistry } from "./registry.js";

type ToolResponse = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: object): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...data }) }] };
}

function fail(e: unknown): ToolResponse {
  const error = toErrorPayload(e);
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, error }) }], isError: true };
}

async function run(fn: () => Promise<object>): Promise<ToolResponse> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

const mongoObject = z.record(z.string(), z.any());

/**
 * The tool module is a thin registration adapter: validate args, delegate to
 * EngineOperations, serialize. Capability dispatch, guards and result limits all
 * live behind the operations seam.
 */
export function registerTools(server: McpServer, registry: ConnectionRegistry, operations: EngineOperations): void {
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
    { description: "Close a connection and release its pool.", inputSchema: { connection_id: z.string() } },
    async ({ connection_id }) =>
      run(async () => {
        await registry.close(connection_id);
        return { closed: true, connection_id };
      }),
  );

  server.registerTool(
    "list_connections",
    { description: "List active connections with alive/dead status.", inputSchema: {} },
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
      run(() => operations.query(connection_id, sql, params, { requestedLimit: limit })),
  );

  server.registerTool(
    "db_execute",
    {
      description: "Run a write statement on a writable connection (read_only=false). Returns affected_rows.",
      inputSchema: { connection_id: z.string(), sql: z.string(), params: z.array(z.any()).optional() },
    },
    async ({ connection_id, sql, params }) => run(() => operations.execute(connection_id, sql, params)),
  );

  server.registerTool(
    "db_list_tables",
    { description: "List tables/views in the connected database.", inputSchema: { connection_id: z.string(), schema: z.string().optional() } },
    async ({ connection_id, schema }) => run(() => operations.listTables(connection_id, schema)),
  );

  server.registerTool(
    "db_describe_table",
    {
      description: "Describe a table: columns (name/type/nullable/default) and indexes.",
      inputSchema: { connection_id: z.string(), table: z.string(), schema: z.string().optional() },
    },
    async ({ connection_id, table, schema }) => run(() => operations.describeTable(connection_id, table, schema)),
  );

  server.registerTool(
    "redis_command",
    {
      description: "Run a read-only Redis command (allow-list). Writes return UNSUPPORTED.",
      inputSchema: { connection_id: z.string(), command: z.string(), args: z.array(z.string()).optional() },
    },
    async ({ connection_id, command, args }) => run(() => operations.redisCommand(connection_id, command, args ?? [])),
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
      run(() => operations.mongoFind(connection_id, collection, { filter, projection, sort, limit, database })),
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
      run(() => operations.mongoAggregate(connection_id, collection, pipeline as unknown[], { limit, database })),
  );

  server.registerTool(
    "mongo_write",
    {
      description: "Write to MongoDB (action: insert|update|delete). Only allowed on writable connections (read_only=false).",
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
        const res = await operations.mongoWrite(connection_id, { collection, action, payload, database });
        return { action, collection, ...res };
      }),
  );

  server.registerTool(
    "mongo_list_collections",
    { description: "List collections in a MongoDB database.", inputSchema: { connection_id: z.string(), database: z.string().optional() } },
    async ({ connection_id, database }) => run(() => operations.mongoListCollections(connection_id, database)),
  );

  server.registerTool(
    "mongo_describe_collection",
    {
      description: "Describe a MongoDB collection: sample document (EJSON), indexes and inferred fields.",
      inputSchema: { connection_id: z.string(), collection: z.string(), database: z.string().optional() },
    },
    async ({ connection_id, collection, database }) =>
      run(() => operations.mongoDescribeCollection(connection_id, collection, database)),
  );
}
