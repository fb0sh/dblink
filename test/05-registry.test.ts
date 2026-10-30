import { afterEach, describe, expect, it } from "vitest";
import type { Driver, EngineKind } from "../src/drivers/types";
import { makeHarness, newDbFile, seedDb, sqliteDsn, type Harness } from "./helpers";

class FakeDriver implements Driver {
  readonly kind: EngineKind = "sqlite";
  connects = 0;
  failNextQuery = true;

  async connect(): Promise<void> {
    this.connects++;
  }
  async serverVersion(): Promise<string> {
    return "fake-1";
  }
  async query(): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    if (this.failNextQuery) {
      this.failNextQuery = false;
      throw new Error("Connection terminated unexpectedly");
    }
    return { columns: ["v"], rows: [{ v: 1 }] };
  }
  async execute(): Promise<{ affectedRows: number }> {
    return { affectedRows: 1 };
  }
  async listTables(): Promise<string[]> {
    return ["fake_table"];
  }
  async describeTable(): Promise<{ columns: []; indexes: [] }> {
    return { columns: [], indexes: [] };
  }
  async ping(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}

describe("05 — connection registry: idempotency, pooling, reconnect", () => {
  let h: Harness;

  afterEach(async () => {
    await h?.close();
  });

  it("is idempotent for the same DSN", async () => {
    const file = newDbFile();
    seedDb(file, ["create table t(a integer)"]);
    h = await makeHarness();
    const a = await h.call("open_connection", { dsn: sqliteDsn(file) });
    const b = await h.call("open_connection", { dsn: sqliteDsn(file) });
    expect(b.json.connection_id).toBe(a.json.connection_id);
    expect(b.json.reused).toBe(true);
  });

  it("uses different handles for different DSNs", async () => {
    const aFile = newDbFile();
    const bFile = newDbFile();
    seedDb(aFile, ["create table a(x integer)"]);
    seedDb(bFile, ["create table b(x integer)"]);
    h = await makeHarness();
    const a = await h.call("open_connection", { dsn: sqliteDsn(aFile) });
    const b = await h.call("open_connection", { dsn: sqliteDsn(bFile) });
    expect(a.json.connection_id).not.toBe(b.json.connection_id);
  });

  it("keeps connection ids opaque", async () => {
    const file = newDbFile();
    seedDb(file, ["create table t(a integer)"]);
    h = await makeHarness();
    const open = await h.call("open_connection", { dsn: sqliteDsn(file) });
    expect(open.json.connection_id).toMatch(/^conn_[0-9a-f]{12}$/);
    expect(open.json.connection_id).not.toContain(file);
  });

  it("reports alive status via list_connections", async () => {
    const file = newDbFile();
    seedDb(file, ["create table t(a integer)"]);
    h = await makeHarness();
    await h.call("open_connection", { dsn: sqliteDsn(file) });
    const res = await h.call("list_connections", {});
    expect(res.json.connections).toHaveLength(1);
    expect(res.json.connections[0].alive).toBe(true);
  });

  it("lazily reconnects after a dropped connection", async () => {
    let instance: FakeDriver | undefined;
    h = await makeHarness({
      driverFactory: () => {
        instance = new FakeDriver();
        return instance;
      },
    });
    const open = await h.call("open_connection", { dsn: "sqlite:fake" });
    const res = await h.call("db_query", { connection_id: open.json.connection_id, sql: "select 1" });
    expect(res.json.ok).toBe(true);
    expect(res.json.rows).toEqual([{ v: 1 }]);
    expect(instance?.connects).toBe(2);
  });

  it("enforces max pools", async () => {
    const aFile = newDbFile();
    const bFile = newDbFile();
    seedDb(aFile, ["create table a(x integer)"]);
    seedDb(bFile, ["create table b(x integer)"]);
    h = await makeHarness({ maxPools: 1 });
    await h.call("open_connection", { dsn: sqliteDsn(aFile) });
    const second = await h.call("open_connection", { dsn: sqliteDsn(bFile) });
    expect(second.json.error.code).toBe("LIMIT_EXCEEDED");
  });
});
