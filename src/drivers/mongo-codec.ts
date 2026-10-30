import { EJSON } from "bson";
import type { Document } from "mongodb";
import { DblinkError } from "../errors.js";
import type { MongoWriteOperation } from "./types.js";

/** Extract the default database from a mongodb:// or mongodb+srv:// DSN. */
export function defaultDatabaseFromDsn(dsn: string): string {
  // new URL() rejects multi-host DSNs like mongodb://h1,h2/db, so fall back to
  // a scheme-aware regex that still extracts the database path.
  try {
    const parsed = new URL(dsn);
    return decodeURIComponent((parsed.pathname || "").replace(/^\//, "")) || "test";
  } catch {
    const match = /^mongodb(?:\+srv)?:\/\/[^/]*\/([^?]*)/i.exec(dsn);
    if (!match) {
      throw new DblinkError("SQL_ERROR", "Invalid MongoDB DSN", "Expected mongodb:// or mongodb+srv:// URL.");
    }
    return decodeURIComponent(match[1] || "") || "test";
  }
}

export function toRelaxedEjson(value: unknown): Record<string, unknown> {
  return EJSON.serialize(value, { relaxed: true }) as Record<string, unknown>;
}

export function fromEjson(value: unknown): Document {
  return EJSON.deserialize(value as never) as Document;
}

export function fromEjsonArray(value: unknown): Document[] {
  return EJSON.deserialize(value as never) as Document[];
}

export type WritePlan =
  | { kind: "insert"; documents: Document[] }
  | { kind: "update"; filter: Document; update: Document; multi: boolean; upsert: boolean }
  | { kind: "delete"; filter: Document; multi: boolean };

/** Validate and normalize a mongo_write payload into one discriminated plan. */
export function planWrite(op: MongoWriteOperation): WritePlan {
  const payload = op.payload ?? {};
  if (op.action === "insert") {
    const documents = (payload.documents as unknown[]) ?? [];
    if (!Array.isArray(documents) || documents.length === 0) {
      throw new DblinkError("SQL_ERROR", "insert requires a non-empty documents array");
    }
    return { kind: "insert", documents: documents.map(fromEjson) };
  }
  if (op.action === "update") {
    return {
      kind: "update",
      filter: fromEjson(payload.filter ?? {}),
      update: fromEjson(payload.update ?? {}),
      multi: Boolean(payload.multi),
      upsert: Boolean(payload.upsert),
    };
  }
  if (op.action === "delete") {
    return { kind: "delete", filter: fromEjson(payload.filter ?? {}), multi: Boolean(payload.multi) };
  }
  throw new DblinkError("SQL_ERROR", `Unknown write action: ${String(op.action)}`);
}
