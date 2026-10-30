import { DblinkError } from "./errors.js";

const WRITE_STAGES = new Set(["$out", "$merge"]);
const JS_OPERATORS = new Set(["$where", "$function", "$accumulator"]);

function collectKeys(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.add(key);
      collectKeys(child, out);
    }
  }
}

/**
 * Reject server-side JavaScript operators ($where/$function/$accumulator) at
 * any depth of a filter or aggregation pipeline. Best-effort defence in depth.
 */
export function assertNoServerSideJs(value: unknown): void {
  if (value === undefined || value === null) return;
  const keys = new Set<string>();
  collectKeys(value, keys);
  for (const op of JS_OPERATORS) {
    if (keys.has(op)) {
      throw new DblinkError(
        "UNSUPPORTED",
        `MongoDB operator ${op} is not allowed`,
        "Server-side JavaScript operators are disabled.",
      );
    }
  }
}

/**
 * Validate a MongoDB aggregate pipeline before execution.
 *
 * - `$where` / `$function` / `$accumulator` rejected on every connection.
 * - `$out` / `$merge` write data and are rejected on read-only connections.
 *
 * Keys are checked structurally (not substring matching) so a field that merely
 * contains the text "$where" is not a false positive.
 */
export function assertAggregatePipeline(pipeline: unknown, readOnly: boolean): void {
  if (!Array.isArray(pipeline)) {
    throw new DblinkError("SQL_ERROR", "pipeline must be an array of aggregation stages");
  }
  assertNoServerSideJs(pipeline);
  if (!readOnly) return;
  for (const stage of pipeline) {
    if (stage && typeof stage === "object" && !Array.isArray(stage)) {
      for (const key of Object.keys(stage as Record<string, unknown>)) {
        if (WRITE_STAGES.has(key)) {
          throw new DblinkError(
            "READ_ONLY_VIOLATION",
            `Aggregation stage ${key} writes data and is not allowed on a read-only connection`,
            "Open a writable connection (read_only:false).",
          );
        }
      }
    }
  }
}
