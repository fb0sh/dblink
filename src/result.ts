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

export interface ShapedList<T> {
  items: T[];
  truncated: boolean;
  reason?: "rows" | "bytes";
}

export function effectiveRowLimit(requested?: number): number {
  const base = requested && Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_LIMIT;
  return Math.min(base, MAX_LIMIT);
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function trimToLimits<T>(items: T[], rowLimit: number, maxBytes: number): ShapedList<T> {
  let out = items;
  let truncated = false;
  let reason: "rows" | "bytes" | undefined;

  if (out.length > rowLimit) {
    out = out.slice(0, rowLimit);
    truncated = true;
    reason = "rows";
  }

  while (byteLength(out) > maxBytes) {
    truncated = true;
    reason = "bytes";
    if (out.length <= 1) {
      out = [];
      break;
    }
    out = out.slice(0, Math.max(1, Math.floor(out.length * 0.8)));
  }

  return { items: out, truncated, ...(reason ? { reason } : {}) };
}

/** Trim a row set to the effective row limit and byte budget. Pure function. */
export function shapeRows<T extends Record<string, unknown>>(rows: T[], opts: ShapeOptions = {}): ShapedRows<T> {
  const rowLimit = effectiveRowLimit(opts.requestedLimit);
  const shaped = trimToLimits(rows, rowLimit, opts.maxBytes ?? MAX_BYTES);
  return { rows: shaped.items, truncated: shaped.truncated, ...(shaped.reason ? { reason: shaped.reason } : {}), rowLimit };
}

/** Trim a list (table names, columns, redis results) to the same budgets. */
export function shapeList<T>(items: T[], opts: ShapeOptions = {}): ShapedList<T> {
  return trimToLimits(items, effectiveRowLimit(opts.requestedLimit), opts.maxBytes ?? MAX_BYTES);
}
