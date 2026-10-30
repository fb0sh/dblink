import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConnectionRegistry, type RegistryOptions } from "./registry.js";
import { registerTools } from "./tools.js";

export interface CreateServerOptions extends RegistryOptions {
  name?: string;
  version?: string;
}

export function createServer(opts: CreateServerOptions = {}): {
  server: McpServer;
  registry: ConnectionRegistry;
} {
  const registry = new ConnectionRegistry(opts);
  const server = new McpServer({
    name: opts.name ?? "dblink",
    version: opts.version ?? "0.1.0",
  });
  registerTools(server, registry);
  return { server, registry };
}
