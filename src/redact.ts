/**
 * Mask secrets (DSN passwords and bearer tokens) before a string is logged or
 * returned in an error payload. See ADR-0002 and rules/KEEPSECURED.md.
 */
export function redactSecrets(input: string): string {
  return input
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:@/\s]+:)([^@/\s]+)(@)/gi, "$1***$3")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1***");
}
