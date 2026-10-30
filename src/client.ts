import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { decodeToolResult } from "./tool-envelope.js";
import { VERSION } from "./version.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface RemoteOptions {
  url: string;
  token?: string;
}

export interface ToolCallResult {
  json: unknown;
  isError: boolean;
}

/**
 * Deep client interface for integration: one long-lived MCP session, everything
 * else (transport, bearer header, JSON envelope, close semantics) hidden.
 */
export interface DblinkClient {
  listTools(): Promise<string[]>;
  call(name: string, args?: Record<string, unknown>): Promise<ToolCallResult>;
  close(): Promise<void>;
}

function createTransport(opts: RemoteOptions): StreamableHTTPClientTransport {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return new StreamableHTTPClientTransport(new URL(opts.url), { requestInit: { headers } });
}

export async function createDblinkClient(opts: RemoteOptions): Promise<DblinkClient> {
  const client = new Client({ name: "dblink-client", version: VERSION });
  await client.connect(createTransport(opts));
  let closed = false;

  return {
    async listTools(): Promise<string[]> {
      const res = await client.listTools();
      return res.tools.map((t) => t.name);
    },
    async call(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
      const res: any = await client.callTool({ name, arguments: args });
      return decodeToolResult(res);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await client.close();
    },
  };
}

/** Convenience for scripts: connect, call once, close. */
export async function callOnce(
  opts: RemoteOptions,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
  const client = await createDblinkClient(opts);
  try {
    return await client.call(name, args);
  } finally {
    await client.close();
  }
}
