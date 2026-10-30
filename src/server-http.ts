import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { redactSecrets } from "./redact.js";
import { createDblinkCore, type DblinkCore } from "./server.js";

export interface HttpServerHandle {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

/** Session bookkeeping for the HTTP transport. */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  add(id: string, session: Session): void {
    this.sessions.set(id, session);
  }
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }
  remove(id: string): void {
    this.sessions.delete(id);
  }
  all(): Session[] {
    return [...this.sessions.values()];
  }
  clear(): void {
    this.sessions.clear();
  }
}

export function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return false;
  const provided = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${token}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export class BodyTooLargeError extends Error {
  readonly status = 413;
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
  }
}

export function readBody(req: http.IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(new BodyTooLargeError());
        req.resume(); // drain without destroying, so the 413 response can be written
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) return resolve(undefined);
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", (e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
  });
}

export type RequestClass = "unauthorized" | "bad-request" | "unknown-session" | "initialize" | "forward";

/** Pure classification of an inbound MCP HTTP request (unit-testable, no socket). */
export function classifyRequest(input: {
  authorized: boolean;
  method?: string;
  hasSessionId: boolean;
  hasSession: boolean;
  body: unknown;
}): RequestClass {
  if (!input.authorized) return "unauthorized";
  const isInitialize =
    input.method === "POST" &&
    typeof input.body === "object" &&
    input.body !== null &&
    !Array.isArray(input.body) &&
    (input.body as { method?: string }).method === "initialize";
  if (input.hasSession) return "forward";
  if (isInitialize) return "initialize";
  return input.hasSessionId ? "unknown-session" : "bad-request";
}

async function createSession(core: DblinkCore, sessions: SessionStore): Promise<Session> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  const server = core.buildServer();
  await server.connect(transport);
  const session: Session = { transport, server };
  transport.onclose = () => {
    const id = transport.sessionId;
    if (id) sessions.remove(id);
  };
  return session;
}

export function createRequestHandler(options: {
  core: DblinkCore;
  sessions: SessionStore;
  token: string;
}): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  const { core, sessions, token } = options;
  return async (req, res) => {
    if (!isAuthorized(req, token)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    let body: unknown;
    if (req.method === "POST") {
      try {
        body = await readBody(req);
      } catch (e) {
        const status = e instanceof BodyTooLargeError ? e.status : 400;
        const message = e instanceof Error ? e.message : "Bad request";
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: message }));
        return;
      }
    }

    const sessionHeader = req.headers["mcp-session-id"];
    const sessionId = typeof sessionHeader === "string" ? sessionHeader : undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    const kind = classifyRequest({
      authorized: true,
      method: req.method,
      hasSessionId: Boolean(sessionId),
      hasSession: Boolean(session),
      body,
    });

    try {
      if (kind === "initialize") {
        const created = await createSession(core, sessions);
        await created.transport.handleRequest(req, res, body);
        const id = created.transport.sessionId;
        if (id) sessions.add(id, created);
        return;
      }
      if (kind === "forward") {
        await session!.transport.handleRequest(req, res, body);
        return;
      }
      const status = kind === "unknown-session" ? 404 : 400;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: kind === "unknown-session" ? "Unknown session" : "Missing session" }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Internal error";
      console.error(`dblink: http handler error: ${redactSecrets(message)}`);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    }
  };
}

export async function serveHttp(config: Config): Promise<HttpServerHandle> {
  if (!config.token) throw new Error("HTTP transport requires DBLINK_HTTP_TOKEN");
  const token = config.token;

  // Same assembly as stdio: one core shared across all sessions.
  const core = createDblinkCore({
    poolSize: config.poolSize,
    idleMs: config.idleMs,
    maxPools: config.maxPools,
  });
  const sessions = new SessionStore();
  const handler = createRequestHandler({ core, sessions, token });

  const httpServer = http.createServer((req, res) => {
    void handler(req, res);
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
      await Promise.all(sessions.all().map((s) => s.transport.close().catch(() => undefined)));
      sessions.clear();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections?.();
      });
      await core.close();
    },
  };
}
