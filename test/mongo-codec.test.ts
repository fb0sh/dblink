import { Decimal128, ObjectId } from "bson";
import { describe, expect, it } from "vitest";
import { DblinkError } from "../src/errors";
import { defaultDatabaseFromDsn, fromEjson, planWrite, toRelaxedEjson } from "../src/drivers/mongo-codec";

describe("mongo-codec", () => {
  it("extracts the default database from common DSNs", () => {
    expect(defaultDatabaseFromDsn("mongodb://localhost:27017/app")).toBe("app");
    expect(defaultDatabaseFromDsn("mongodb://h1:27017,h2:27017/mydb?replicaSet=rs0")).toBe("mydb");
    expect(defaultDatabaseFromDsn("mongodb+srv://u:p@cluster.example/shop?retryWrites=true")).toBe("shop");
    expect(defaultDatabaseFromDsn("mongodb://localhost:27017")).toBe("test");
  });

  it("round-trips ObjectId, Date and Decimal128 through relaxed EJSON", () => {
    const oid = new ObjectId("507f1f77bcf86cd799439011");
    const when = new Date("2026-01-01T00:00:00.000Z");
    const price = Decimal128.fromString("1.50");
    const encoded = toRelaxedEjson({ _id: oid, when, price });

    expect(encoded._id).toEqual({ $oid: "507f1f77bcf86cd799439011" });
    expect(encoded.when).toHaveProperty("$date");

    const decoded = fromEjson(encoded);
    expect(decoded._id).toBeInstanceOf(ObjectId);
    expect(decoded.when).toBeInstanceOf(Date);
    expect(decoded.price).toBeInstanceOf(Decimal128);
  });

  it("plans writes and rejects empty/unknown operations", () => {
    expect(planWrite({ collection: "c", action: "insert", payload: { documents: [{ a: 1 }] } })).toMatchObject({
      kind: "insert",
    });
    expect(() => planWrite({ collection: "c", action: "insert", payload: { documents: [] } })).toThrow(DblinkError);
    expect(planWrite({ collection: "c", action: "update", payload: { filter: { a: 1 }, update: { $set: { b: 2 } } } })).toMatchObject({
      kind: "update",
      multi: false,
      upsert: false,
    });
    expect(planWrite({ collection: "c", action: "delete", payload: { filter: {}, multi: true } })).toMatchObject({
      kind: "delete",
      multi: true,
    });
    expect(() => planWrite({ collection: "c", action: "upsert", payload: {} })).toThrow(DblinkError);
  });
});
