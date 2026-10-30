import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/redact";

describe("redactSecrets", () => {
  it("masks the password in a DSN", () => {
    const out = redactSecrets("connect failed: postgres://alice:supersecret@db.example.com:5432/app");
    expect(out).not.toContain("supersecret");
    expect(out).toContain("alice:***@db.example.com");
  });

  it("masks bearer tokens", () => {
    const out = redactSecrets("authorization: Bearer abc.DEF-123");
    expect(out).not.toContain("abc.DEF-123");
    expect(out).toContain("Bearer ***");
  });

  it("leaves ordinary text alone", () => {
    expect(redactSecrets("select * from users")).toBe("select * from users");
  });
});
