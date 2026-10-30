import { describe, expect, it } from "vitest";
import { makeHarness } from "./helpers";

/**
 * S2 — driver conformance (integration). Each engine runs the same minimal
 * open → query → close path against a real server. Tests are skipped unless the
 * corresponding DSN env var is provided (docker-compose supplies them).
 */

const engines: { name: string; env: string; sql: string }[] = [
  { name: "postgres", env: "DBLINK_TEST_PG_DSN", sql: "select 1 as v" },
  { name: "mysql", env: "DBLINK_TEST_MYSQL_DSN", sql: "select 1 as v" },
];

for (const engine of engines) {
  const dsn = process.env[engine.env];
  describe.skipIf(!dsn)(`S2 conformance — ${engine.name}`, () => {
    it("opens, queries, introspects and closes", async () => {
      const h = await makeHarness();
      try {
        const open = await h.call("open_connection", { dsn });
        expect(open.json.ok).toBe(true);
        expect(open.json.kind).toBe(engine.name);

        const q = await h.call("db_query", { connection_id: open.json.connection_id, sql: engine.sql });
        expect(q.json.ok).toBe(true);
        expect(q.json.rows.length).toBe(1);

        const tables = await h.call("db_list_tables", { connection_id: open.json.connection_id });
        expect(tables.json.ok).toBe(true);

        await h.call("close_connection", { connection_id: open.json.connection_id });
      } finally {
        await h.close();
      }
    });
  });
}

const mongoDsn = process.env.DBLINK_TEST_MONGO_DSN;
describe.skipIf(!mongoDsn)("S2 conformance — mongodb", () => {
  it("opens, lists collections and closes", async () => {
    const h = await makeHarness();
    try {
      const open = await h.call("open_connection", { dsn: mongoDsn });
      expect(open.json.kind).toBe("mongodb");
      const list = await h.call("mongo_list_collections", { connection_id: open.json.connection_id });
      expect(list.json.ok).toBe(true);
      await h.call("close_connection", { connection_id: open.json.connection_id });
    } finally {
      await h.close();
    }
  });
});

const redisDsn = process.env.DBLINK_TEST_REDIS_DSN;
describe.skipIf(!redisDsn)("S2 conformance — redis", () => {
  it("opens, runs a read-only command, rejects writes, closes", async () => {
    const h = await makeHarness();
    try {
      const open = await h.call("open_connection", { dsn: redisDsn });
      expect(open.json.kind).toBe("redis");

      const ping = await h.call("redis_command", { connection_id: open.json.connection_id, command: "PING" });
      expect(ping.json.ok).toBe(true);

      const write = await h.call("redis_command", {
        connection_id: open.json.connection_id,
        command: "SET",
        args: ["k", "v"],
      });
      expect(write.json.error.code).toBe("UNSUPPORTED");

      await h.call("close_connection", { connection_id: open.json.connection_id });
    } finally {
      await h.close();
    }
  });
});
