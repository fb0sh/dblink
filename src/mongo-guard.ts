import { DblinkError } from "./errors.js";

const WRITE_STAGES = ["$out", "$merge"];
const JS_OPERATORS = ["$where", "$function", "$accumulator"];

/**
 * Validate a MongoDB aggregate pipeline before execution.
 *
 * - `$out` / `$merge` write data and are rejected on read-only connections.
 * - `$where` / `$function` / `$accumulator` execute server-side JavaScript and
 *   are rejected on every connection (defence in depth, best-effort).
 */
export function assertAggregatePipeline(pipeline: unknown, readOnly: boolean): void {
  if (!Array.isArray(pipeline)) {
    throw new DblinkError("SQL_ERROR", "pipeline must be an array of aggregation stages");
  }
  const text = JSON.stringify(pipeline);
  for (const op of JS_OPERATORS) {
    if (text.includes(`"${op}"`)) {
      throw new DblinkError(
        "UNSUPPORTED",
        `Aggregation operator ${op} is not allowed`,
        "Server-side JavaScript operators are disabled.",
      );
    }
  }
  if (!readOnly) return;
  for (const stage of pipeline) {
    if (stage && typeof stage === "object") {
      for (const key of WRITE_STAGES) {
        if (key in (stage as Record<string, unknown>)) {
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
