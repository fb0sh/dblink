import { afterEach, describe, expect, it } from "vitest";
import { toErrorPayload } from "../src/errors";
import { MAX_LIMIT, shapeRows } from "../src/result";
import { makeHarness, newDbFile, seedDb, sqliteDsn, type Harness } from "./helpers";

describe("02 — result limits, truncation and error contract", () => {
  let h: Harness;

  afterEach(async () => {
    await h?.close();
  });

  it("defaults to 100 rows and marks truncation", async () => {
    const file = newDbFile();
    const values = Array.from({ length: 150 }, (_, i) => `(${i})`).join(",");
    seedDb(file, ["create table t(a integer)", `insert into t(a) values ${values}`]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const res = await h.call("db_query", { connection_id: open.json.connection_id, sql: "select a from t" });
    expect(res.json.rows).toHaveLength(100);
    expect(res.json.truncated).toBe(true);
    expect(res.json.truncation_reason).toBe("rows");
  });

  it("honours requested limit but caps at MAX_LIMIT", async () => {
    const file = newDbFile();
    seedDb(file, ["create table t(a integer)", "insert into t(a) values (1),(2),(3)"]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const res = await h.call("db_query", { connection_id: open.json.connection_id, sql: "select a from t", limit: 2 });
    expect(res.json.rows).toHaveLength(2);
    expect(res.json.truncated).toBe(true);
    expect(res.json.row_limit).toBe(2);

    const capped = await h.call("db_query", { connection_id: open.json.connection_id, sql: "select a from t", limit: 5000 });
    expect(capped.json.row_limit).toBe(MAX_LIMIT);
  });

  it("truncates by byte budget", async () => {
    const file = newDbFile();
    seedDb(file, ["create table big(v text)", `insert into big(v) values ('${"x".repeat(300 * 1024)}')`]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const res = await h.call("db_query", { connection_id: open.json.connection_id, sql: "select v from big" });
    expect(res.json.truncated).toBe(true);
    expect(res.json.truncation_reason).toBe("bytes");
  });

  it("returns SQL_ERROR for bad SQL", async () => {
    const file = newDbFile();
    seedDb(file, ["create table t(a integer)"]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const res = await h.call("db_query", { connection_id: open.json.connection_id, sql: "select * from missing" });
    expect(res.isError).toBe(true);
    expect(res.json.error.code).toBe("SQL_ERROR");
  });

  it("maps timeouts and connection drops to stable codes", () => {
    expect(toErrorPayload(new Error("Query read timeout")).code).toBe("TIMEOUT");
    expect(toErrorPayload(new Error("Connection terminated unexpectedly")).code).toBe("CONN_CLOSED");
  });
});

describe("shapeRows (pure)", () => {
  it("keeps rows under both limits untouched", () => {
    const rows = [{ a: 1 }, { a: 2 }];
    const out = shapeRows(rows, { requestedLimit: 10 });
    expect(out.rows).toHaveLength(2);
    expect(out.truncated).toBe(false);
  });
});
