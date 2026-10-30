#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./config.js";
import { startHttpServer } from "./http.js";
import { redactSecrets } from "./redact.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`dblink: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  if (config.http) {
    const handle = await startHttpServer(config);
    console.error(
      `dblink: HTTP MCP server listening on http://${config.host}:${handle.port}` +
        (config.host === "0.0.0.0" ? " (WARNING: bound to 0.0.0.0, ensure DBLINK_HTTP_TOKEN is secret)" : ""),
    );
    const shutdown = () => {
      void handle.close().finally(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const { server, registry } = createServer({
    poolSize: config.poolSize,
    idleMs: config.idleMs,
    maxPools: config.maxPools,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    void registry.closeAll().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`dblink: fatal error: ${redactSecrets(message)}`);
  process.exit(1);
});
