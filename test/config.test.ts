import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, loadServeConfig } from "../src/config";

describe("config", () => {
  it("defaults to stdio", () => {
    const c = loadConfig([], {});
    expect(c.http).toBe(false);
    expect(c.host).toBe("127.0.0.1");
    expect(c.poolSize).toBe(5);
  });

  it("refuses HTTP without a token", () => {
    expect(() => loadConfig(["--http", "7331"], {})).toThrow(ConfigError);
  });

  it("parses serve flags", () => {
    const c = loadServeConfig(["--host", "0.0.0.0", "--port", "9000", "--token", "t"], {});
    expect(c.http).toBe(true);
    expect(c.host).toBe("0.0.0.0");
    expect(c.port).toBe(9000);
    expect(c.token).toBe("t");
  });

  it("rejects unknown serve flags instead of ignoring them", () => {
    expect(() => loadServeConfig(["--hots", "8080"], {})).toThrow(ConfigError);
  });

  it("requires a token for serve", () => {
    expect(() => loadServeConfig(["--port", "9000"], {})).toThrow(/token/);
  });

  it("accepts HTTP with a token", () => {
    const c = loadConfig(["--http", "9000"], { DBLINK_HTTP_TOKEN: "s3cret", DBLINK_BIND: "0.0.0.0" });
    expect(c.http).toBe(true);
    expect(c.port).toBe(9000);
    expect(c.token).toBe("s3cret");
    expect(c.host).toBe("0.0.0.0");
  });
});
