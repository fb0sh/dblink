import { afterEach, describe, expect, it } from "vitest";
import { makeHarness, newDbFile, seedDb, sqliteDsn, type Harness } from "./helpers";

describe("03 — read-only gate and write path", () => {
  let h: Harness;

  afterEach(async () => {
    await h?.close();
  });

  it("rejects db_execute on a read-only connection", async () => {
    const file = newDbFile();
    seedDb(file, ["create table t(a integer)"]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const res = await h.call("db_execute", { connection_id: open.json.connection_id, sql: "insert into t(a) values (1)" });
    expect(res.isError).toBe(true);
    expect(res.json.error.code).toBe("READ_ONLY_VIOLATION");
  });

  it("permits writes on a writable connection", async () => {
    const file = newDbFile();
    seedDb(file, ["create table t(a integer)"]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file), read_only: false });
    const exec = await h.call("db_execute", { connection_id: open.json.connection_id, sql: "insert into t(a) values (7),(8)" });
    expect(exec.json.ok).toBe(true);
    expect(exec.json.affected_rows).toBe(2);

    const q = await h.call("db_query", { connection_id: open.json.connection_id, sql: "select count(*) as c from t" });
    expect(q.json.rows[0].c).toBe(2);
  });

  it("rejects write statements routed through db_query", async () => {
    const file = newDbFile();
    seedDb(file, ["create table t(a integer)"]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file), read_only: false });
    const res = await h.call("db_query", { connection_id: open.json.connection_id, sql: "delete from t" });
    expect(res.json.error.code).toBe("READ_ONLY_VIOLATION");
  });

  it("rejects multiple statements", async () => {
    const file = newDbFile();
    seedDb(file, ["create table t(a integer)"]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const res = await h.call("db_query", { connection_id: open.json.connection_id, sql: "select 1; select 2" });
    expect(res.json.error.code).toBe("READ_ONLY_VIOLATION");
  });
});
