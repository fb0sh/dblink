import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toErrorPayload } from "./errors.js";
import type { EngineOperations } from "./operations.js";
import type { ConnectionRegistry } from "./registry.js";

type ToolResponse = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: any) => Promise<object>;
}

function ok(data: object): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...data }) }] };
}

function fail(e: unknown): ToolResponse {
  const error = toErrorPayload(e);
  return { content: [{ type: "text", text: JSON.stringify({ ok: false, error }) }], isError: true };
}

/** One place owns the result envelope and error mapping for every tool. */
function defineTool(server: McpServer, spec: ToolSpec): void {
  (server.registerTool as any)(
    spec.name,
    { description: spec.description, inputSchema: spec.schema },
    async (args: any) => {
      try {
        return ok(await spec.handler(args));
      } catch (e) {
        return fail(e);
      }
    },
  );
}

const mongoObject = z.record(z.string(), z.any());

/**
 * The tool module is a declarative adapter: a ToolSpec table plus one generic
 * registration helper. Capability dispatch, guards and limits live behind
 * EngineOperations.
 */
export function registerTools(server: McpServer, registry: ConnectionRegistry, operations: EngineOperations): void {
  const specs: ToolSpec[] = [
    {
      name: "open_connection",
      description:
        "Open (or reuse) a database connection. Returns a connection_id used by the other tools. DSN schemes: postgres://, mysql://, redis://, mongodb://, mongodb+srv://, sqlite:",
      schema: {
        dsn: z.string().describe("Database URL / DSN"),
        read_only: z.boolean().optional().describe("Read-only connection (default true)"),
        name: z.string().optional().describe("Optional human-friendly label"),
      },
      handler: async ({ dsn, read_only, name }) => {
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
      },
    },
    {
      name: "close_connection",
      description: "Close a connection and release its pool.",
      schema: { connection_id: z.string() },
      handler: async ({ connection_id }) => {
        await registry.close(connection_id);
        return { closed: true, connection_id };
      },
    },
    {
      name: "list_connections",
      description: "List active connections with alive/dead status.",
      schema: {},
      handler: async () => {
        const connections = await registry.list();
        return { connections, count: connections.length };
      },
    },
    {
      name: "db_query",
      description: "Run a read-only SQL statement (SELECT/SHOW/EXPLAIN/read-only WITH) and return rows.",
      schema: {
        connection_id: z.string(),
        sql: z.string(),
        params: z.array(z.any()).optional(),
        limit: z.number().int().positive().optional(),
      },
      handler: ({ connection_id, sql, params, limit }) =>
        operations.query(connection_id, sql, params, { requestedLimit: limit }),
    },
    {
      name: "db_execute",
      description: "Run a write statement on a writable connection (read_only=false). Returns affected_rows.",
      schema: { connection_id: z.string(), sql: z.string(), params: z.array(z.any()).optional() },
      handler: ({ connection_id, sql, params }) => operations.execute(connection_id, sql, params),
    },
    {
      name: "db_list_tables",
      description: "List tables/views in the connected database.",
      schema: { connection_id: z.string(), schema: z.string().optional() },
      handler: ({ connection_id, schema }) => operations.listTables(connection_id, schema),
    },
    {
      name: "db_describe_table",
      description: "Describe a table: columns (name/type/nullable/default) and indexes.",
      schema: { connection_id: z.string(), table: z.string(), schema: z.string().optional() },
      handler: ({ connection_id, table, schema }) => operations.describeTable(connection_id, table, schema),
    },
    {
      name: "redis_command",
      description: "Run a read-only Redis command (allow-list). Writes return UNSUPPORTED.",
      schema: { connection_id: z.string(), command: z.string(), args: z.array(z.string()).optional() },
      handler: ({ connection_id, command, args }) => operations.redisCommand(connection_id, command, args ?? []),
    },
    {
      name: "mongo_find",
      description:
        "Query documents from a MongoDB collection. filter/projection/sort accept relaxed EJSON. Returns relaxed EJSON documents.",
      schema: {
        connection_id: z.string(),
        collection: z.string(),
        filter: mongoObject.optional(),
        projection: mongoObject.optional(),
        sort: mongoObject.optional(),
        limit: z.number().int().positive().optional(),
        database: z.string().optional(),
      },
      handler: ({ connection_id, collection, filter, projection, sort, limit, database }) =>
        operations.mongoFind(connection_id, collection, { filter, projection, sort, limit, database }),
    },
    {
      name: "mongo_aggregate",
      description: "Run a MongoDB aggregation pipeline. Read-only connections reject $out/$merge.",
      schema: {
        connection_id: z.string(),
        collection: z.string(),
        pipeline: z.unknown(),
        limit: z.number().int().positive().optional(),
        database: z.string().optional(),
      },
      handler: ({ connection_id, collection, pipeline, limit, database }) =>
        operations.mongoAggregate(connection_id, collection, pipeline as unknown[], { limit, database }),
    },
    {
      name: "mongo_write",
      description: "Write to MongoDB (action: insert|update|delete). Only allowed on writable connections (read_only=false).",
      schema: {
        connection_id: z.string(),
        collection: z.string(),
        action: z.string(),
        payload: mongoObject,
        database: z.string().optional(),
      },
      handler: async ({ connection_id, collection, action, payload, database }) => {
        const res = await operations.mongoWrite(connection_id, { collection, action, payload, database });
        return { action, collection, ...res };
      },
    },
    {
      name: "mongo_list_collections",
      description: "List collections in a MongoDB database.",
      schema: { connection_id: z.string(), database: z.string().optional() },
      handler: ({ connection_id, database }) => operations.mongoListCollections(connection_id, database),
    },
    {
      name: "mongo_describe_collection",
      description: "Describe a MongoDB collection: sample document (EJSON), indexes and inferred fields.",
      schema: { connection_id: z.string(), collection: z.string(), database: z.string().optional() },
      handler: ({ connection_id, collection, database }) =>
        operations.mongoDescribeCollection(connection_id, collection, database),
    },
  ];

  for (const spec of specs) defineTool(server, spec);
}
