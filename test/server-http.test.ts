import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { SessionStore, isAuthorized, readBody } from "../src/server-http";

function request(headers: Record<string, string>): any {
  return { headers };
}

describe("server-http helpers", () => {
  it("authorizes only the exact bearer token", () => {
    expect(isAuthorized(request({ authorization: "Bearer secret" }), "secret")).toBe(true);
    expect(isAuthorized(request({ authorization: "Bearer nope" }), "secret")).toBe(false);
    expect(isAuthorized(request({ authorization: "secret" }), "secret")).toBe(false);
    expect(isAuthorized(request({}), "secret")).toBe(false);
  });

  it("reads JSON bodies and treats empty input as undefined", async () => {
    const req = Readable.from([Buffer.from('{"a":1}')]) as any;
    await expect(readBody(req)).resolves.toEqual({ a: 1 });

    const empty = Readable.from([]) as any;
    await expect(readBody(empty)).resolves.toBeUndefined();
  });

  it("tracks sessions in a store", () => {
    const store = new SessionStore();
    const session = { transport: {} as any, server: {} as any };
    store.add("s1", session);
    expect(store.get("s1")).toBe(session);
    expect(store.all()).toHaveLength(1);
    store.remove("s1");
    expect(store.get("s1")).toBeUndefined();
  });
});
