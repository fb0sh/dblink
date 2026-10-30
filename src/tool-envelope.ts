export interface DecodedToolResult {
  json: unknown;
  isError: boolean;
}

/**
 * Decode the `{ok,...}` envelope that every dblink tool returns. One contract,
 * shared by the SDK client and test harness (and any future consumer).
 */
export function decodeToolResult(result: unknown): DecodedToolResult {
  const res = result as { content?: { text?: string }[]; isError?: boolean } | undefined;
  const text = res?.content?.[0]?.text;
  return { json: text ? JSON.parse(text) : undefined, isError: res?.isError === true };
}
