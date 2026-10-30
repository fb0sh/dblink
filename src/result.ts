export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;
export const MAX_BYTES = 256 * 1024;

export interface ShapeOptions {
  requestedLimit?: number;
  maxBytes?: number;
}

export interface ShapedRows<T> {
  rows: T[];
  truncated: boolean;
  reason?: "rows" | "bytes";
  rowLimit: number;
}

export function effectiveRowLimit(requested?: number): number {
  const base = requested && Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_LIMIT;
  return Math.min(base, MAX_LIMIT);
}

/**
 * Trim a row set to the effective row limit and byte budget. Pure function so
 * the limits are testable without a database.
 */
export function shapeRows<T extends Record<string, unknown>>(rows: T[], opts: ShapeOptions = {}): ShapedRows<T> {
  const rowLimit = effectiveRowLimit(opts.requestedLimit);
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  let out = rows;
  let truncated = false;
  let reason: "rows" | "bytes" | undefined;

  if (out.length > rowLimit) {
    out = out.slice(0, rowLimit);
    truncated = true;
    reason = "rows";
  }

  let bytes = byteLength(out);
  while (bytes > maxBytes) {
    truncated = true;
    reason = "bytes";
    if (out.length <= 1) {
      out = [];
      bytes = byteLength(out);
      break;
    }
    out = out.slice(0, Math.max(1, Math.floor(out.length * 0.8)));
    bytes = byteLength(out);
  }

  return { rows: out, truncated, reason, rowLimit };
}

function byteLength(rows: unknown): number {
  return Buffer.byteLength(JSON.stringify(rows), "utf8");
}
