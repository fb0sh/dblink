import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface RemoteOptions {
  url: string;
  token?: string;
}

export interface ToolCallResult {
  json: unknown;
  isError: boolean;
}

function createTransport(opts: RemoteOptions): StreamableHTTPClientTransport {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return new StreamableHTTPClientTransport(new URL(opts.url), { requestInit: { headers } });
}

async function withClient<T>(opts: RemoteOptions, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "dblink-client", version: "1.0.0" });
  await client.connect(createTransport(opts));
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function listRemoteTools(opts: RemoteOptions): Promise<string[]> {
  return withClient(opts, async (client) => {
    const res = await client.listTools();
    return res.tools.map((t) => t.name);
  });
}

export async function callRemoteTool(
  opts: RemoteOptions,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  return withClient(opts, async (client) => {
    const res: any = await client.callTool({ name, arguments: args });
    const text = res?.content?.[0]?.text;
    return { json: text ? JSON.parse(text) : undefined, isError: res?.isError === true };
  });
}

export interface ClientArgs {
  url: string;
  token?: string;
  list: boolean;
  tool?: string;
  args?: Record<string, unknown>;
  help: boolean;
}

const DEFAULT_URL = "http://127.0.0.1:7331/mcp";

export function parseClientArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ClientArgs {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    if (body.includes("=")) {
      const idx = body.indexOf("=");
      flags.set(body.slice(0, idx), body.slice(idx + 1));
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(body, next);
        i++;
      } else {
        flags.set(body, true);
      }
    }
  }

  const tool = typeof flags.get("tool") === "string" ? (flags.get("tool") as string) : undefined;
  let args: Record<string, unknown> | undefined;
  const rawArgs = flags.get("args");
  if (typeof rawArgs === "string") {
    args = JSON.parse(rawArgs) as Record<string, unknown>;
  }

  return {
    url: typeof flags.get("url") === "string" ? (flags.get("url") as string) : DEFAULT_URL,
    token:
      (typeof flags.get("token") === "string" ? (flags.get("token") as string) : undefined) ??
      env.DBLINK_HTTP_TOKEN,
    list: flags.get("list") === true,
    tool,
    args,
    help: flags.get("help") === true || flags.get("h") === true,
  };
}

const USAGE = `dblink client — connect to a running dblink MCP server

Usage:
  dblink client [--url http://127.0.0.1:7331/mcp] [--token TOKEN]
  dblink client --list
  dblink client --tool db_query --args '{"connection_id":"conn_x","sql":"select 1"}'

Environment:
  DBLINK_HTTP_TOKEN   bearer token (fallback for --token)

REPL commands:
  tools                      list available tools
  call <tool> <json-args>    call a tool (json-args optional, blank = {})
  help                       show this help
  quit                       exit
`;

export async function runClient(argv: string[]): Promise<void> {
  const opts = parseClientArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  if (opts.list) {
    const tools = await listRemoteTools(opts);
    console.log(tools.join("\n"));
    return;
  }

  if (opts.tool) {
    const result = await callRemoteTool(opts, opts.tool, opts.args ?? {});
    console.log(JSON.stringify(result.json, null, 2));
    if (result.isError) process.exitCode = 1;
    return;
  }

  const tools = await listRemoteTools(opts);
  console.log(`connected: ${opts.url}`);
  console.log(`tools: ${tools.join(", ")}`);
  console.log("type 'help' for commands, 'quit' to exit");

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      let line: string;
      try {
        line = await rl.question("dblink> ");
      } catch {
        break; // EOF
      }
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (["quit", "exit", "q"].includes(trimmed)) break;
      if (trimmed === "help" || trimmed === "?") {
        console.log(USAGE);
        continue;
      }
      if (trimmed === "tools") {
        console.log(tools.join("\n"));
        continue;
      }
      if (trimmed.startsWith("call ")) {
        const rest = trimmed.slice("call ".length).trim();
        const spaceIdx = rest.indexOf(" ");
        const toolName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
        let jsonText = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();
        if (!jsonText) {
          jsonText = (await rl.question("args (JSON, blank = {}): ")).trim();
        }
        let args: Record<string, unknown> = {};
        if (jsonText) {
          try {
            args = JSON.parse(jsonText) as Record<string, unknown>;
          } catch (e) {
            console.error(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
            continue;
          }
        }
        try {
          const result = await callRemoteTool(opts, toolName, args);
          console.log(result.isError ? "error:" : "ok:");
          console.log(JSON.stringify(result.json, null, 2));
        } catch (e) {
          console.error(`call failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        continue;
      }
      console.error(`unknown command: ${trimmed} (type 'help')`);
    }
  } finally {
    rl.close();
  }
}
