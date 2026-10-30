import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { EngineOperations } from "./operations.js";
import { redactSecrets } from "./redact.js";
import { ConnectionRegistry, type RegistryOptions } from "./registry.js";
import { registerTools } from "./tools.js";

export const PACKAGE_NAME = "dblink";
export const VERSION = "1.0.0";

export interface CreateServerOptions extends RegistryOptions {
  name?: string;
  version?: string;
}

export interface DblinkApp {
  server: McpServer;
  registry: ConnectionRegistry;
  operations: EngineOperations;
  close: () => Promise<void>;
}

function buildMcpServer(
  registry: ConnectionRegistry,
  operations: EngineOperations,
  name = PACKAGE_NAME,
  version = VERSION,
): McpServer {
  const server = new McpServer({ name, version });
  registerTools(server, registry, operations);
  return server;
}

/** Assemble one registry + operations + MCP server. The single assembly point. */
export function createDblinkServer(opts: CreateServerOptions = {}): DblinkApp {
  const registry = new ConnectionRegistry(opts);
  const operations = new EngineOperations(registry);
  const server = buildMcpServer(registry, operations, opts.name, opts.version);
  return {
    server,
    registry,
    operations,
    close: async () => {
      await registry.closeAll();
      await server.close();
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

export interface HttpServerHandle {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${token}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export async function serveHttp(config: Config): Promise<HttpServerHandle> {
  if (!config.token) throw new Error("HTTP transport requires DBLINK_HTTP_TOKEN");
  const token = config.token;

  // One shared registry + operations across sessions.
  const registry = new ConnectionRegistry({
    poolSize: config.poolSize,
    idleMs: config.idleMs,
    maxPools: config.maxPools,
  });
  const operations = new EngineOperations(registry);
  const sessions = new Map<string, Session>();

  async function createSession(): Promise<Session> {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    const server = buildMcpServer(registry, operations);
    await server.connect(transport);
    const session: Session = { transport, server };
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) sessions.delete(id);
    };
    return session;
  }

  const httpServer = http.createServer((req, res) => {
    void (async () => {
      if (!isAuthorized(req, token)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      try {
        const sessionHeader = req.headers["mcp-session-id"];
        const sessionId = typeof sessionHeader === "string" ? sessionHeader : undefined;
        const body = req.method === "POST" ? await readBody(req) : undefined;

        let session = sessionId ? sessions.get(sessionId) : undefined;

        if (!session) {
          const isInitialize =
            req.method === "POST" &&
            typeof body === "object" &&
            body !== null &&
            (body as { method?: string }).method === "initialize";
          if (isInitialize) {
            session = await createSession();
            await session.transport.handleRequest(req, res, body);
            const id = session.transport.sessionId;
            if (id) sessions.set(id, session);
            return;
          }
          res.writeHead(sessionId ? 404 : 400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: sessionId ? "Unknown session" : "Missing session" }));
          return;
        }

        await session.transport.handleRequest(req, res, body);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Internal error";
        console.error(`dblink: http handler error: ${redactSecrets(message)}`);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }));
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });

  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : config.port;

  return {
    server: httpServer,
    port,
    close: async () => {
      await Promise.all([...sessions.values()].map((s) => s.transport.close().catch(() => undefined)));
      sessions.clear();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections?.();
      });
      await registry.closeAll();
    },
  };
}
