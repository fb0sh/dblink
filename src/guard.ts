import { DblinkError } from "./errors.js";

/**
 * Best-effort SQL guard. This is NOT a security boundary: it exists to catch
 * accidents before they reach the database. Real read-only enforcement is the
 * database account itself (see ADR-0003).
 */

const READ_START = /^\s*(select|with|show|explain)\b/i;

const WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|upsert|replace|drop|alter|create|truncate|grant|revoke|call|copy|vacuum|attach|detach|reindex|cluster|comment|load_extension)\b/i;

export function stripSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/#[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
}

/** True when the statement text contains more than one statement. */
export function isSingleStatement(sql: string): boolean {
  const stripped = stripSql(sql).trim();
  const withoutTrailing = stripped.replace(/[;\s]+$/, "");
  return !withoutTrailing.includes(";");
}

export function assertSingleStatement(sql: string): void {
  if (!sql || !sql.trim()) {
    throw new DblinkError("SQL_ERROR", "SQL statement is empty");
  }
  if (!isSingleStatement(sql)) {
    throw new DblinkError("READ_ONLY_VIOLATION", "Multiple SQL statements are not allowed", "Send one statement per call.");
  }
}

/**
 * Throws unless `sql` is a single, read-only statement.
 */
export function assertReadOnlySql(sql: string): void {
  assertSingleStatement(sql);
  const stripped = stripSql(sql).trim();
  if (!READ_START.test(stripped)) {
    throw new DblinkError(
      "READ_ONLY_VIOLATION",
      "Only read statements (SELECT/SHOW/EXPLAIN/WITH) are allowed via db_query",
      "Use db_execute on a writable connection for writes.",
    );
  }
  if (WRITE_KEYWORDS.test(stripped)) {
    throw new DblinkError(
      "READ_ONLY_VIOLATION",
      "Statement contains a write keyword and is not allowed via db_query",
      "Use db_execute on a writable connection for writes.",
    );
  }
  // SELECT ... INTO (Postgres) and INTO OUTFILE/DUMPFILE (MySQL) write to disk.
  if (/\binto\b/i.test(stripped)) {
    throw new DblinkError(
      "READ_ONLY_VIOLATION",
      "SELECT ... INTO is not allowed via db_query",
      "Use db_execute on a writable connection for writes.",
    );
  }
}
