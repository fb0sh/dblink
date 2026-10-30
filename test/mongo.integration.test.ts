import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeHarness, type Harness } from "./helpers";

const dsn = process.env.DBLINK_TEST_MONGO_DSN;
const collection = `mtest_${Date.now()}`;

describe.skipIf(!dsn)("MongoDB — S1 tool boundary + S2 conformance", () => {
  let h: Harness;
  let writableId: string;
  let readOnlyId: string;

  beforeAll(async () => {
    h = await makeHarness();
    const writable = await h.call("open_connection", { dsn, read_only: false });
    expect(writable.json.ok).toBe(true);
    writableId = writable.json.connection_id;
    expect(writable.json.kind).toBe("mongodb");

    const ro = await h.call("open_connection", { dsn, read_only: true });
    readOnlyId = ro.json.connection_id;

    await h.call("mongo_write", {
      connection_id: writableId,
      collection,
      action: "delete",
      payload: { filter: {}, multi: true },
    });
  });

  afterAll(async () => {
    if (h) await h.close();
  });

  it("inserts EJSON-typed documents", async () => {
    const res = await h.call("mongo_write", {
      connection_id: writableId,
      collection,
      action: "insert",
      payload: {
        documents: [
          { _id: { $oid: "507f1f77bcf86cd799439011" }, name: "alpha", when: { $date: "2026-01-01T00:00:00Z" } },
          { name: "beta", price: { $numberDecimal: "1.50" } },
        ],
      },
    });
    expect(res.json.ok).toBe(true);
    expect(res.json.inserted_count).toBe(2);
  });

  it("finds documents and preserves EJSON types", async () => {
    const res = await h.call("mongo_find", {
      connection_id: writableId,
      collection,
      filter: { name: "alpha" },
    });
    expect(res.json.ok).toBe(true);
    expect(res.json.count).toBe(1);
    expect(res.json.documents[0]._id).toEqual({ $oid: "507f1f77bcf86cd799439011" });
    expect(res.json.documents[0].when).toHaveProperty("$date");
  });

  it("matches by EJSON ObjectId filter", async () => {
    const res = await h.call("mongo_find", {
      connection_id: writableId,
      collection,
      filter: { _id: { $oid: "507f1f77bcf86cd799439011" } },
    });
    expect(res.json.count).toBe(1);
    expect(res.json.documents[0].name).toBe("alpha");
  });

  it("aggregates read-only stages", async () => {
    const res = await h.call("mongo_aggregate", {
      connection_id: writableId,
      collection,
      pipeline: [{ $group: { _id: null, n: { $sum: 1 } } }],
    });
    expect(res.json.ok).toBe(true);
    expect(res.json.documents[0].n).toBeGreaterThanOrEqual(2);
  });

  it("updates and deletes documents", async () => {
    const up = await h.call("mongo_write", {
      connection_id: writableId,
      collection,
      action: "update",
      payload: { filter: { name: "beta" }, update: { $set: { price: { $numberDecimal: "2.00" } } } },
    });
    expect(up.json.matched_count).toBe(1);
    expect(up.json.modified_count).toBe(1);

    const del = await h.call("mongo_write", {
      connection_id: writableId,
      collection,
      action: "delete",
      payload: { filter: { name: "beta" } },
    });
    expect(del.json.deleted_count).toBe(1);
  });

  it("lists and describes collections", async () => {
    const list = await h.call("mongo_list_collections", { connection_id: writableId });
    expect(list.json.collections).toContain(collection);

    const desc = await h.call("mongo_describe_collection", { connection_id: writableId, collection });
    expect(desc.json.ok).toBe(true);
    expect(desc.json.inferred_fields).toContain("name");
    expect(Array.isArray(desc.json.indexes)).toBe(true);
  });

  it("reports truncation on large result sets", async () => {
    const many = `many_${Date.now()}`;
    const documents = Array.from({ length: 150 }, (_, i) => ({ i }));
    const ins = await h.call("mongo_write", {
      connection_id: writableId,
      collection: many,
      action: "insert",
      payload: { documents },
    });
    expect(ins.json.inserted_count).toBe(150);
    const res = await h.call("mongo_find", { connection_id: writableId, collection: many });
    expect(res.json.count).toBe(100);
    expect(res.json.truncated).toBe(true);
    expect(res.json.truncation_reason).toBe("rows");
  });

  it("truncates by byte budget", async () => {
    const big = `big_${Date.now()}`;
    await h.call("mongo_write", {
      connection_id: writableId,
      collection: big,
      action: "insert",
      payload: { documents: [{ blob: "x".repeat(300 * 1024) }] },
    });
    const res = await h.call("mongo_find", { connection_id: writableId, collection: big });
    expect(res.json.truncated).toBe(true);
    expect(res.json.truncation_reason).toBe("bytes");
  });

  it("rejects non-array pipelines and unknown actions with SQL_ERROR", async () => {
    const noPipeline = await h.call("mongo_aggregate", {
      connection_id: writableId,
      collection,
      pipeline: { $match: {} },
    });
    expect(noPipeline.json.error.code).toBe("SQL_ERROR");

    const badAction = await h.call("mongo_write", {
      connection_id: writableId,
      collection,
      action: "upsert",
      payload: {},
    });
    expect(badAction.json.error.code).toBe("SQL_ERROR");
  });

  it("rejects $where in a mongo_find filter", async () => {
    const res = await h.call("mongo_find", {
      connection_id: writableId,
      collection,
      filter: { $where: "true" },
    });
    expect(res.json.error.code).toBe("UNSUPPORTED");
  });

  it("returns SQL_ERROR for a missing collection", async () => {
    const res = await h.call("mongo_describe_collection", {
      connection_id: writableId,
      collection: `missing_${Date.now()}`,
    });
    expect(res.json.error.code).toBe("SQL_ERROR");
  });

  it("blocks a write on a read-only connection", async () => {
    const res = await h.call("mongo_write", {
      connection_id: readOnlyId,
      collection,
      action: "insert",
      payload: { documents: [{ name: "nope" }] },
    });
    expect(res.json.error.code).toBe("READ_ONLY_VIOLATION");
  });

  it("blocks $out on a read-only connection and $where anywhere", async () => {
    const out = await h.call("mongo_aggregate", {
      connection_id: readOnlyId,
      collection,
      pipeline: [{ $match: {} }, { $out: collection }],
    });
    expect(out.json.error.code).toBe("READ_ONLY_VIOLATION");

    const js = await h.call("mongo_aggregate", {
      connection_id: writableId,
      collection,
      pipeline: [{ $match: { $where: "true" } }],
    });
    expect(js.json.error.code).toBe("UNSUPPORTED");
  });

  it("rejects SQL tools against a mongodb connection", async () => {
    const res = await h.call("db_query", { connection_id: writableId, sql: "select 1" });
    expect(res.json.error.code).toBe("UNSUPPORTED");
  });
});
