import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { createServer } from "./server.js";

export interface HttpServerHandle {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

function isAuthorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers["authorization"];
  return header === `Bearer ${token}`;
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

export async function startHttpServer(config: Config): Promise<HttpServerHandle> {
  if (!config.token) {
    throw new Error("HTTP transport requires DBLINK_HTTP_TOKEN");
  }
  const token = config.token;
  const { server, registry } = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const httpServer = http.createServer((req, res) => {
    void (async () => {
      if (!isAuthorized(req, token)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      try {
        const body = req.method === "POST" ? await readBody(req) : undefined;
        await transport.handleRequest(req, res, body);
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : "Bad request" }));
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
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await transport.close();
      await registry.closeAll();
    },
  };
}
