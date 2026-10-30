import { redactSecrets } from "./redact.js";

export type ErrorCode =
  | "CONN_NOT_FOUND"
  | "CONN_CLOSED"
  | "READ_ONLY_VIOLATION"
  | "SQL_ERROR"
  | "TIMEOUT"
  | "LIMIT_EXCEEDED"
  | "UNSUPPORTED";

export class DblinkError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DblinkError";
    this.code = code;
    this.hint = hint;
  }
}

export function isDblinkError(e: unknown): e is DblinkError {
  return e instanceof DblinkError;
}

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  hint?: string;
}

function mapUnknownCode(message: string): ErrorCode {
  if (/timeout|timed out|statement timeout/i.test(message)) return "TIMEOUT";
  if (/read[- ]?only|query_only|READ ONLY/i.test(message)) return "READ_ONLY_VIOLATION";
  if (
    /connection.*(closed|terminated|ended)|not connected|ECONNRESET|ECONNREFUSED|Connection terminated|server closed the connection|Connection is closed/i.test(
      message,
    )
  ) {
    return "CONN_CLOSED";
  }
  return "SQL_ERROR";
}

export function toErrorPayload(e: unknown): ErrorPayload {
  if (isDblinkError(e)) {
    return {
      code: e.code,
      message: redactSecrets(e.message),
      ...(e.hint ? { hint: redactSecrets(e.hint) } : {}),
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { code: mapUnknownCode(message), message: redactSecrets(message) };
}
