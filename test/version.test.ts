import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, VERSION } from "../src/version";

describe("version", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      name: string;
      version: string;
    };
    expect(PACKAGE_NAME).toBe("dblink");
    expect(VERSION).toBe(pkg.version);
  });
});
