import { describe, expect, it } from "vitest";
import { DblinkError } from "../src/errors";
import { detectKind } from "../src/drivers/index";
import { assertAggregatePipeline } from "../src/mongo-guard";

describe("mongo guard — aggregate pipeline", () => {
  it("detects mongodb DSNs", () => {
    expect(detectKind("mongodb://localhost:27017/app")).toBe("mongodb");
    expect(detectKind("mongodb+srv://user:pw@cluster.example/app")).toBe("mongodb");
  });

  it("rejects non-array pipelines", () => {
    expect(() => assertAggregatePipeline({ $match: {} }, true)).toThrow(DblinkError);
  });

  it("rejects write stages on read-only connections", () => {
    expect(() => assertAggregatePipeline([{ $match: {} }, { $out: "x" }], true)).toThrow(/not allowed|writes data/);
    expect(() => assertAggregatePipeline([{ $merge: { into: "x" } }], true)).toThrow(/not allowed|writes data/);
  });

  it("allows write stages on writable connections", () => {
    expect(() => assertAggregatePipeline([{ $match: {} }, { $out: "x" }], false)).not.toThrow();
  });

  it("rejects server-side JavaScript on any connection", () => {
    expect(() => assertAggregatePipeline([{ $match: { $where: "this.a == 1" } }], false)).toThrow(/UNSUPPORTED|not allowed/);
    expect(() => assertAggregatePipeline([{ $group: { _id: { $function: {} } } }], false)).toThrow();
    expect(() => assertAggregatePipeline([{ $match: { $accumulator: {} } }], false)).toThrow();
  });

  it("allows ordinary read stages", () => {
    expect(() => assertAggregatePipeline([{ $match: { a: 1 } }, { $group: { _id: "$a" } }], true)).not.toThrow();
  });
});
