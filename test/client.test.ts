import { describe, expect, it } from "vitest";
import type { Config } from "../src/config";
import { startHttpServer } from "../src/http";
import { callRemoteTool, listRemoteTools, parseClientArgs } from "../src/cli/client";
import { createDblinkClient } from "../src/client";

const baseConfig: Config = {
  http: true,
  port: 0,
  host: "127.0.0.1",
  token: "client-token",
  poolSize: 2,
  idleMs: 60000,
  maxPools: 20,
};

describe("dblink client", () => {
  it("parses --tool/--args/--url/--token", () => {
    const opts = parseClientArgs(
      ["--tool", "db_query", "--args", '{"connection_id":"x","sql":"select 1"}', "--url", "http://h/mcp", "--token", "t"],
      {},
    );
    expect(opts.tool).toBe("db_query");
    expect(opts.url).toBe("http://h/mcp");
    expect(opts.token).toBe("t");
    expect(opts.args).toEqual({ connection_id: "x", sql: "select 1" });
  });

  it("lists tools and calls a remote tool end-to-end", async () => {
    const handle = await startHttpServer(baseConfig);
    try {
      const url = `http://127.0.0.1:${handle.port}/mcp`;
      const tools = await listRemoteTools({ url, token: "client-token" });
      expect(tools).toHaveLength(13);
      expect(tools).toContain("mongo_find");

      const open = await callRemoteTool({ url, token: "client-token" }, "open_connection", {
        dsn: "sqlite::memory:",
      });
      const openJson = open.json as { ok: boolean; connection_id: string };
      expect(openJson.ok).toBe(true);

      const q = await callRemoteTool({ url, token: "client-token" }, "db_query", {
        connection_id: openJson.connection_id,
        sql: "select 1 as v",
      });
      const qJson = q.json as { rows: { v: number }[] };
      expect(qJson.rows[0]?.v).toBe(1);
    } finally {
      await handle.close();
    }
  });

  it("reuses one session through createDblinkClient", async () => {
    const handle = await startHttpServer(baseConfig);
    try {
      const url = `http://127.0.0.1:${handle.port}/mcp`;
      const client = await createDblinkClient({ url, token: "client-token" });
      try {
        expect(await client.listTools()).toHaveLength(13);
        const open = (await client.call("open_connection", { dsn: "sqlite::memory:" })) as any;
        const id = open.json.connection_id;
        const q1 = (await client.call("db_query", { connection_id: id, sql: "select 1 as v" })) as any;
        const q2 = (await client.call("db_query", { connection_id: id, sql: "select 2 as v" })) as any;
        expect(q1.json.rows[0].v).toBe(1);
        expect(q2.json.rows[0].v).toBe(2);
      } finally {
        await client.close();
      }
    } finally {
      await handle.close();
    }
  });

  it("rejects a wrong token", async () => {
    const handle = await startHttpServer(baseConfig);
    try {
      const url = `http://127.0.0.1:${handle.port}/mcp`;
      await expect(listRemoteTools({ url, token: "wrong" })).rejects.toBeTruthy();
    } finally {
      await handle.close();
    }
  });
});
