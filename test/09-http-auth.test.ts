import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Config } from "../src/config";
import { startHttpServer } from "../src/http";

const baseConfig: Config = {
  http: true,
  port: 0,
  host: "127.0.0.1",
  token: "test-token",
  poolSize: 2,
  idleMs: 60000,
  maxPools: 20,
};

const initializeBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
});

describe("09 — HTTP transport auth (S3)", () => {
  it("refuses to start without a token", async () => {
    await expect(startHttpServer({ ...baseConfig, token: undefined })).rejects.toThrow(/DBLINK_HTTP_TOKEN/);
  });

  it("rejects missing and wrong bearer tokens, accepts the right one", async () => {
    const handle = await startHttpServer(baseConfig);
    try {
      const url = `http://127.0.0.1:${handle.port}/mcp`;
      const noAuth = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: initializeBody,
      });
      expect(noAuth.status).toBe(401);

      const wrong = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer nope",
        },
        body: initializeBody,
      });
      expect(wrong.status).toBe(401);

      const good = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer test-token",
        },
        body: initializeBody,
      });
      expect(good.status).not.toBe(401);
    } finally {
      await handle.close();
    }
  });

  it("serves tools end-to-end over HTTP with a valid token", async () => {
    const handle = await startHttpServer(baseConfig);
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`), {
        requestInit: { headers: { authorization: "Bearer test-token" } },
      });
      const client = new Client({ name: "http-test", version: "1.0.0" });
      await client.connect(transport);

      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(13);

      const open: any = await client.callTool({ name: "open_connection", arguments: { dsn: "sqlite::memory:" } });
      const openJson = JSON.parse(open.content[0].text);
      expect(openJson.ok).toBe(true);

      const q: any = await client.callTool({
        name: "db_query",
        arguments: { connection_id: openJson.connection_id, sql: "select 1 as v" },
      });
      const qJson = JSON.parse(q.content[0].text);
      expect(qJson.rows[0].v).toBe(1);

      await client.close();
    } finally {
      await handle.close();
    }
  });
});
