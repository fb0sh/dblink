import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  BodyTooLargeError,
  SessionStore,
  classifyRequest,
  createRequestHandler,
  isAuthorized,
  readBody,
} from "../src/server-http";

function request(headers: Record<string, string>): any {
  return { headers };
}

function recorder(): any {
  return {
    status: 0,
    body: "",
    headersSent: false,
    writeHead(status: number) {
      this.status = status;
    },
    end(body?: string) {
      this.body = body ?? "";
    },
  };
}

function streamRequest(body: string, headers: Record<string, string> = {}, method = "POST"): any {
  const req: any = Readable.from([Buffer.from(body)]);
  req.headers = headers;
  req.method = method;
  return req;
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

  it("rejects oversized bodies with a 413 error", async () => {
    const req = Readable.from([Buffer.from("0123456789")]) as any;
    await expect(readBody(req, 5)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("classifies every request outcome", () => {
    const initBody = { jsonrpc: "2.0", method: "initialize" };
    expect(classifyRequest({ authorized: false, hasSessionId: false, hasSession: false, body: initBody })).toBe("unauthorized");
    expect(classifyRequest({ authorized: true, hasSessionId: false, hasSession: false, body: initBody, method: "POST" })).toBe("initialize");
    expect(classifyRequest({ authorized: true, hasSessionId: true, hasSession: true, body: {}, method: "POST" })).toBe("forward");
    expect(classifyRequest({ authorized: true, hasSessionId: true, hasSession: false, body: {}, method: "POST" })).toBe("unknown-session");
    expect(classifyRequest({ authorized: true, hasSessionId: false, hasSession: false, body: {}, method: "POST" })).toBe("bad-request");
  });

  it("returns 401 / 400 / 404 without opening a socket", async () => {
    const core: any = { buildServer: () => Promise.reject(new Error("unused")) };
    const handler = createRequestHandler({ core, sessions: new SessionStore(), token: "t" });

    let res = recorder();
    await handler(streamRequest("{}", {}), res);
    expect(res.status).toBe(401);

    res = recorder();
    await handler(streamRequest('{"jsonrpc":"2.0","method":"tools/list"}', { authorization: "Bearer t" }), res);
    expect(res.status).toBe(400);

    res = recorder();
    await handler(
      streamRequest('{"jsonrpc":"2.0","method":"tools/list"}', {
        authorization: "Bearer t",
        "mcp-session-id": "nope",
      }),
      res,
    );
    expect(res.status).toBe(404);
  });

  it("returns 413 for an oversized body through the handler", async () => {
    const core: any = { buildServer: () => Promise.reject(new Error("unused")) };
    const handler = createRequestHandler({ core, sessions: new SessionStore(), token: "t" });
    const req: any = Readable.from([Buffer.alloc(4 * 1024 * 1024 + 1)]);
    req.headers = { authorization: "Bearer t" };
    req.method = "POST";
    const res = recorder();
    await handler(req, res);
    expect(res.status).toBe(413);
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
