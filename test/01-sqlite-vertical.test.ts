import { afterEach, describe, expect, it } from "vitest";
import { makeHarness, newDbFile, seedDb, sqliteDsn, type Harness } from "./helpers";

describe("01 — SQLite vertical slice (stdio-shaped tool boundary)", () => {
  let h: Harness;

  afterEach(async () => {
    await h?.close();
  });

  it("opens a sqlite connection and returns a handle", async () => {
    const file = newDbFile();
    seedDb(file, ["create table users(id integer primary key, name text)", "insert into users(name) values ('a'),('b')"]);
    h = await makeHarness();

    const res = await h.call("open_connection", { dsn: sqliteDsn(file) });
    expect(res.isError).toBe(false);
    expect(res.json.ok).toBe(true);
    expect(res.json.connection_id).toMatch(/^conn_[0-9a-f]{12}$/);
    expect(res.json.kind).toBe("sqlite");
    expect(res.json.read_only).toBe(true);
    expect(res.json.status).toBe("connected");
  });

  it("queries rows through the connection id", async () => {
    const file = newDbFile();
    seedDb(file, ["create table users(id integer primary key, name text)", "insert into users(name) values ('a'),('b')"]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const id = open.json.connection_id;

    const res = await h.call("db_query", { connection_id: id, sql: "select id, name from users order by id" });
    expect(res.isError).toBe(false);
    expect(res.json.rows).toHaveLength(2);
    expect(res.json.rows[0]).toEqual({ id: 1, name: "a" });
    expect(res.json.columns).toEqual(["id", "name"]);
  });

  it("returns CONN_NOT_FOUND for an unknown id", async () => {
    h = await makeHarness();
    const res = await h.call("db_query", { connection_id: "conn_nope", sql: "select 1" });
    expect(res.isError).toBe(true);
    expect(res.json.error.code).toBe("CONN_NOT_FOUND");
  });

  it("returns CONN_CLOSED after close_connection", async () => {
    const file = newDbFile();
    seedDb(file, ["create table t(a integer)"]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const id = open.json.connection_id;
    await h.call("close_connection", { connection_id: id });
    const res = await h.call("db_query", { connection_id: id, sql: "select * from t" });
    expect(res.isError).toBe(true);
    expect(res.json.error.code).toBe("CONN_CLOSED");
  });
});
