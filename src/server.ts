import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCapabilityOps, type CapabilityOps } from "./ops/index.js";
import { ConnectionRegistry, type RegistryOptions } from "./registry.js";
import { registerTools } from "./tools.js";

import { PACKAGE_NAME, VERSION } from "./version.js";
export { PACKAGE_NAME, VERSION } from "./version.js";

export interface CreateServerOptions extends RegistryOptions {
  name?: string;
  version?: string;
}

/** The assembly core shared by every transport: registry + operations. */
export interface DblinkCore {
  registry: ConnectionRegistry;
  ops: CapabilityOps;
  buildServer: () => McpServer;
  close: () => Promise<void>;
}

export function createDblinkCore(opts: CreateServerOptions = {}): DblinkCore {
  const registry = new ConnectionRegistry(opts);
  const ops = createCapabilityOps(registry);
  return {
    registry,
    ops,
    buildServer: () => {
      const server = new McpServer({ name: opts.name ?? PACKAGE_NAME, version: opts.version ?? VERSION });
      registerTools(server, registry, ops);
      return server;
    },
    close: () => registry.closeAll(),
  };
}

export type DblinkApp = DblinkCore & {
  server: McpServer;
  close: () => Promise<void>;
};

/** Assemble one core + MCP server. The single assembly point. */
export function createDblinkServer(opts: CreateServerOptions = {}): DblinkApp {
  const core = createDblinkCore(opts);
  const server = core.buildServer();
  return {
    ...core,
    server,
    close: async () => {
      await server.close();
      await core.close();
    },
  };
}

export async function serveStdio(opts: CreateServerOptions = {}): Promise<DblinkApp> {
  const app = createDblinkServer(opts);
  const transport = new StdioServerTransport();
  await app.server.connect(transport);
  const shutdown = () => {
    void app.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return app;
}
