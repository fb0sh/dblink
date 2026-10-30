import { describe, expect, it } from "vitest";
import type { Config } from "../src/config";
import { startHttpServer } from "../src/http";

const baseConfig: Config = {
  http: true,
  port: 0,
  host: "127.0.0.1",
  token: "test-token",
  poolSize: 2,
  idleMs: 60000,
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
});
