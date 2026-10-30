#!/usr/bin/env node
import { parseFlags, stringFlag } from "./cli/args.js";
import { runClient } from "./cli/client.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { redactSecrets } from "./redact.js";
import { serveStdio } from "./server.js";
import { serveHttp } from "./server-http.js";

const USAGE = `dblink — MCP server for multi-database access

Usage:
  dblink                      start stdio server (default)
  dblink stdio                start stdio server
  dblink serve [--host H] [--port P] [--token T]
                              start Streamable HTTP server (token required)
  dblink client [--url URL] [--token T] [--list]
  dblink client --tool <name> --args '<json>'
  dblink --http [port]        legacy alias for serve

Environment:
  DBLINK_HTTP_TOKEN   bearer token (required for serve)
  DBLINK_BIND         default bind host (default 127.0.0.1)
  DBLINK_PORT         default HTTP port (default 7331)
  DBLINK_POOL_SIZE    max clients per pool (default 5)
  DBLINK_MAX_POOLS    max pools per process (default 20)
  DBLINK_IDLE_MS      idle pool eviction ms (default 900000)
`;

async function startHttp(config: Config): Promise<void> {
  const handle = await serveHttp(config);
  console.error(
    `dblink: HTTP MCP server listening on http://${config.host}:${handle.port}` +
      (config.host === "0.0.0.0" ? " (WARNING: bound to 0.0.0.0, ensure the token is secret)" : ""),
  );
  const shutdown = () => {
    void handle.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function serveConfig(argv: string[]): Config {
  const flags = parseFlags(argv);
  const base = loadConfig([], process.env);
  const host = stringFlag(flags, "host") ?? base.host;
  const rawPort = stringFlag(flags, "port") ?? String(base.port);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`Invalid --port: ${rawPort}`);
  }
  const token = stringFlag(flags, "token") ?? base.token;
  if (!token) {
    throw new ConfigError("serve requires a token: pass --token or set DBLINK_HTTP_TOKEN");
  }
  return { ...base, http: true, host, port, token };
}

async function legacy(argv: string[]): Promise<void> {
  const config = loadConfig(argv);
  if (config.http) {
    await startHttp(config);
    return;
  }
  await serveStdio();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === "client") {
    await runClient(argv.slice(1));
    return;
  }
  if (cmd === "serve") {
    await startHttp(serveConfig(argv.slice(1)));
    return;
  }
  if (cmd === "stdio") {
    await serveStdio();
    return;
  }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(USAGE);
    return;
  }
  await legacy(argv);
}

main().catch((e) => {
  if (e instanceof ConfigError) {
    console.error(`dblink: ${e.message}`);
    process.exit(1);
  }
  const message = e instanceof Error ? e.message : String(e);
  console.error(`dblink: fatal error: ${redactSecrets(message)}`);
  process.exit(1);
});
