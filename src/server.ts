import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EngineOperations } from "./operations.js";
import { ConnectionRegistry, type RegistryOptions } from "./registry.js";
import { registerTools } from "./tools.js";

export const PACKAGE_NAME = "dblink";
export const VERSION = "1.0.0";

export interface CreateServerOptions extends RegistryOptions {
  name?: string;
  version?: string;
}

/** The assembly core shared by every transport: registry + operations. */
export interface DblinkCore {
  registry: ConnectionRegistry;
  operations: EngineOperations;
  buildServer: () => McpServer;
  close: () => Promise<void>;
}

export function createDblinkCore(opts: CreateServerOptions = {}): DblinkCore {
  const registry = new ConnectionRegistry(opts);
  const operations = new EngineOperations(registry);
  return {
    registry,
    operations,
    buildServer: () => {
      const server = new McpServer({ name: opts.name ?? PACKAGE_NAME, version: opts.version ?? VERSION });
      registerTools(server, registry, operations);
      return server;
    },
    close: () => registry.closeAll(),
  };
}

export interface DblinkApp {
  server: McpServer;
  registry: ConnectionRegistry;
  operations: EngineOperations;
  close: () => Promise<void>;
}

/** Assemble one core + MCP server. The single assembly point. */
export function createDblinkServer(opts: CreateServerOptions = {}): DblinkApp {
  const core = createDblinkCore(opts);
  const server = core.buildServer();
  return {
    server,
    registry: core.registry,
    operations: core.operations,
    close: async () => {
      await server.close();
      await core.close();
    },
  };
}

/** Backwards-compatible alias. */
export const createServer = createDblinkServer;

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
