import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type CreateServerOptions } from "../src/server";
import { decodeToolResult } from "../src/tool-envelope";
import type { ConnectionRegistry } from "../src/registry";

const TMP_DIR = join(process.cwd(), "tmp", "tests");

export function newDbFile(): string {
  mkdirSync(TMP_DIR, { recursive: true });
  return join(TMP_DIR, `dblink-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

export function seedDb(file: string, statements: string[]): void {
  const db = new DatabaseSync(file);
  try {
    for (const s of statements) db.exec(s);
  } finally {
    db.close();
  }
}

export function sqliteDsn(file: string): string {
  return `sqlite:${file}`;
}

export interface CallResult {
  json: any;
  isError: boolean;
}

export interface Harness {
  client: Client;
  registry: ConnectionRegistry;
  call: (name: string, args?: Record<string, unknown>) => Promise<CallResult>;
  close: () => Promise<void>;
}

export async function makeHarness(opts: CreateServerOptions = {}): Promise<Harness> {
  const { server, registry } = createServer(opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);

  async function call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    const res: any = await client.callTool({ name, arguments: args });
    return decodeToolResult(res);
  }

  return {
    client,
    registry,
    call,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
