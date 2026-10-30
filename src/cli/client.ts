import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { callOnce, createDblinkClient, type RemoteOptions, type ToolCallResult } from "../client.js";
import { parseFlags, stringFlag } from "./args.js";

export type { RemoteOptions, ToolCallResult } from "../client.js";

export async function listRemoteTools(opts: RemoteOptions): Promise<string[]> {
  const client = await createDblinkClient(opts);
  try {
    return await client.listTools();
  } finally {
    await client.close();
  }
}

export async function callRemoteTool(
  opts: RemoteOptions,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  return callOnce(opts, name, args);
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
  const flags = parseFlags(argv);
  const tool = stringFlag(flags, "tool");
  let args: Record<string, unknown> | undefined;
  const rawArgs = stringFlag(flags, "args");
  if (rawArgs !== undefined) {
    args = JSON.parse(rawArgs) as Record<string, unknown>;
  }

  return {
    url: stringFlag(flags, "url") ?? DEFAULT_URL,
    token: stringFlag(flags, "token") ?? env.DBLINK_HTTP_TOKEN,
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

  const client = await createDblinkClient(opts);
  const tools = await client.listTools();
  console.log(`connected: ${opts.url}`);
  console.log(`tools: ${tools.join(", ")}`);
  console.log("type 'help' for commands, 'quit' to exit");

  const interactive = Boolean(stdin.isTTY);
  const rl = createInterface({ input: stdin, output: stdout, terminal: interactive });
  const iterator = rl[Symbol.asyncIterator]();

  const nextLine = async (prompt?: string): Promise<string | undefined> => {
    if (interactive) stdout.write(prompt ?? "dblink> ");
    const { value, done } = await iterator.next();
    return done ? undefined : value;
  };

  const handle = async (raw: string): Promise<boolean> => {
    const trimmed = raw.trim();
    if (!trimmed) return true;
    if (["quit", "exit", "q"].includes(trimmed)) return false;
    if (trimmed === "help" || trimmed === "?") {
      console.log(USAGE);
      return true;
    }
    if (trimmed === "tools") {
      console.log(tools.join("\n"));
      return true;
    }
    if (trimmed.startsWith("call ")) {
      const rest = trimmed.slice("call ".length).trim();
      const spaceIdx = rest.indexOf(" ");
      const toolName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
      let jsonText = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();
      if (!jsonText) {
        jsonText = (await nextLine("args (JSON, blank = {}): "))?.trim() ?? "";
      }
      let args: Record<string, unknown> = {};
      if (jsonText) {
        try {
          args = JSON.parse(jsonText) as Record<string, unknown>;
        } catch (e) {
          console.error(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
          return true;
        }
      }
      try {
        const result = await client.call(toolName, args);
        console.log(result.isError ? "error:" : "ok:");
        console.log(JSON.stringify(result.json, null, 2));
      } catch (e) {
        console.error(`call failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return true;
    }
    console.error(`unknown command: ${trimmed} (type 'help')`);
    return true;
  };

  try {
    for (;;) {
      const line = await nextLine();
      if (line === undefined) break;
      if (!(await handle(line))) break;
    }
  } finally {
    rl.close();
    await client.close();
  }
}
