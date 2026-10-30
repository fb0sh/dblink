import { afterEach, describe, expect, it } from "vitest";
import { makeHarness, newDbFile, seedDb, sqliteDsn, type Harness } from "./helpers";

describe("04 — schema introspection", () => {
  let h: Harness;

  afterEach(async () => {
    await h?.close();
  });

  it("lists tables and describes a table", async () => {
    const file = newDbFile();
    seedDb(file, [
      "create table users(id integer primary key, name text not null)",
      "create index idx_users_name on users(name)",
    ]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const id = open.json.connection_id;

    const tables = await h.call("db_list_tables", { connection_id: id });
    expect(tables.json.tables).toContain("users");

    const desc = await h.call("db_describe_table", { connection_id: id, table: "users" });
    expect(desc.json.ok).toBe(true);
    const names = desc.json.columns.map((c: { name: string }) => c.name);
    expect(names).toEqual(["id", "name"]);
    const idCol = desc.json.columns.find((c: { name: string }) => c.name === "id");
    expect(idCol.primaryKey).toBe(true);
    const nameCol = desc.json.columns.find((c: { name: string }) => c.name === "name");
    expect(nameCol.nullable).toBe(false);
    expect(desc.json.indexes.length).toBeGreaterThanOrEqual(1);
  });

  it("returns SQL_ERROR for a missing table", async () => {
    const file = newDbFile();
    seedDb(file, ["create table users(id integer)"]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const res = await h.call("db_describe_table", { connection_id: open.json.connection_id, table: "nope" });
    expect(res.json.error.code).toBe("SQL_ERROR");
  });
});
