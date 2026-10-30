import { DblinkError } from "../errors.js";
import { MAX_BYTES, MAX_LIMIT, effectiveRowLimit, type ShapedList, type ShapedRows } from "../result.js";

export interface QueryShaped {
  columns: string[];
  rows: Record<string, unknown>[];
  rows_returned: number;
  truncated: boolean;
  truncation_reason?: "rows" | "bytes";
  row_limit: number;
}

export interface MongoShaped {
  documents: Record<string, unknown>[];
  count: number;
  truncated: boolean;
  truncation_reason?: "rows" | "bytes";
  row_limit: number;
}

export type Reason = "rows" | "bytes" | undefined;

export function reasonField(reason: Reason): { truncation_reason?: "rows" | "bytes" } {
  return reason ? { truncation_reason: reason } : {};
}

/** Validate a requested limit and return the effective one. One seam for limits. */
export function checkedLimit(requestedLimit?: number): number {
  if (requestedLimit !== undefined && requestedLimit > MAX_LIMIT) {
    throw new DblinkError(
      "LIMIT_EXCEEDED",
      `Requested limit ${requestedLimit} exceeds the maximum of ${MAX_LIMIT}`,
      `Use limit <= ${MAX_LIMIT}.`,
    );
  }
  return effectiveRowLimit(requestedLimit);
}

export function queryEnvelope(columns: string[], shaped: ShapedRows<Record<string, unknown>>): QueryShaped {
  return {
    columns,
    rows: shaped.rows,
    rows_returned: shaped.rows.length,
    truncated: shaped.truncated,
    ...reasonField(shaped.reason),
    row_limit: shaped.rowLimit,
  };
}

export function mongoEnvelope(shaped: ShapedRows<Record<string, unknown>>): MongoShaped {
  return {
    documents: shaped.rows,
    count: shaped.rows.length,
    truncated: shaped.truncated,
    ...reasonField(shaped.reason),
    row_limit: shaped.rowLimit,
  };
}

export function listEnvelope<K extends string, T>(
  key: K,
  shaped: ShapedList<T>,
): { count: number; truncated: boolean; truncation_reason?: "rows" | "bytes" } & Record<K, T[]> {
  return {
    [key]: shaped.items,
    count: shaped.items.length,
    truncated: shaped.truncated,
    ...reasonField(shaped.reason),
  } as { count: number; truncated: boolean; truncation_reason?: "rows" | "bytes" } & Record<K, T[]>;
}

/** Throw LIMIT_EXCEEDED when a single payload exceeds the byte budget. */
export function guardBytes(value: unknown, message: string): void {
  if (Buffer.byteLength(JSON.stringify(value ?? null), "utf8") > MAX_BYTES) {
    throw new DblinkError("LIMIT_EXCEEDED", message);
  }
}
