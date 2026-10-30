import { describe, expect, it } from "vitest";
import { assertReadOnlySql, isSingleStatement } from "../src/guard";

describe("guard — best-effort SQL classification", () => {
  it("allows read statements", () => {
    expect(() => assertReadOnlySql("select * from t")).not.toThrow();
    expect(() => assertReadOnlySql("WITH x AS (SELECT 1) SELECT * FROM x")).not.toThrow();
    expect(() => assertReadOnlySql("explain select 1")).not.toThrow();
  });

  it("rejects write keywords", () => {
    expect(() => assertReadOnlySql("insert into t values (1)")).toThrow(/READ_ONLY|read statements|write keyword/i);
    expect(() => assertReadOnlySql("WITH x AS (SELECT 1) DELETE FROM t")).toThrow();
    expect(() => assertReadOnlySql("drop table t")).toThrow();
  });

  it("rejects multiple statements", () => {
    expect(() => assertReadOnlySql("select 1; select 2")).toThrow();
    expect(isSingleStatement("select 1;")).toBe(true);
    expect(isSingleStatement("select 1; select 2")).toBe(false);
  });

  it("rejects SELECT INTO", () => {
    expect(() => assertReadOnlySql("select * into new_t from t")).toThrow();
  });

  it("ignores write words inside string literals and comments", () => {
    expect(() => assertReadOnlySql("select 'delete from t' as s")).not.toThrow();
    expect(() => assertReadOnlySql("select 1 -- drop table t")).not.toThrow();
  });
});
