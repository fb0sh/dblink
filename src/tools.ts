import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DblinkError, toErrorPayload } from "./errors.js";
import { assertReadOnlySql, assertSingleStatement } from "./guard.js";
import type { ConnectionRegistry } from "./registry.js";

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

export function registerTools(server: McpServer, registry: ConnectionRegistry): void {
  server.registerTool(
    "open_connection",
    {
      description:
        "Open (or reuse) a database connection. Returns a connection_id used by the other tools. DSN schemes: postgres://, mysql://, redis://, sqlite:",
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
        if (registry.kindOf(connection_id) === "redis") {
          throw new DblinkError("UNSUPPORTED", "Redis connections do not support SQL", "Use redis_command instead.");
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
        const tables = await registry.listTables(connection_id, schema);
        return { tables, count: tables.length };
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
        const desc = await registry.describeTable(connection_id, table, schema);
        return { table, columns: desc.columns, indexes: desc.indexes };
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
        return { command: normalized, result };
      }),
  );
}
