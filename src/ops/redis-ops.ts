import { redisOps } from "../drivers/types.js";
import { DblinkError } from "../errors.js";
import type { ConnectionRegistry } from "../registry.js";
import { shapeList } from "../result.js";
import { guardBytes, reasonField } from "./shared.js";

const READONLY_REDIS_COMMANDS = new Set([
  "GET", "MGET", "STRLEN", "EXISTS", "TYPE", "TTL", "PTTL", "SCAN",
  "HGET", "HGETALL", "HMGET", "HKEYS", "HVALS", "HLEN", "HEXISTS",
  "LRANGE", "LLEN", "LINDEX", "SMEMBERS", "SCARD", "SISMEMBER",
  "ZRANGE", "ZRANGEBYSCORE", "ZCARD", "ZSCORE", "ZRANK",
  "DBSIZE", "INFO", "PING",
]);

export class RedisOperations {
  constructor(private readonly registry: ConnectionRegistry) {}

  async command(
    id: string,
    command: string,
    args: string[],
  ): Promise<{ command: string; result: unknown; truncated: boolean; truncation_reason?: "rows" | "bytes" }> {
    const conn = this.registry.resolve(id);
    const normalized = command.trim().toUpperCase();
    if (!READONLY_REDIS_COMMANDS.has(normalized)) {
      throw new DblinkError(
        "UNSUPPORTED",
        `Command not allowed: ${normalized}`,
        "redis_command only permits read-only commands.",
      );
    }
    const result = await conn.run((d) => redisOps(d).command(normalized, args));
    if (Array.isArray(result)) {
      const shaped = shapeList(result);
      return { command: normalized, result: shaped.items, truncated: shaped.truncated, ...reasonField(shaped.reason) };
    }
    guardBytes(result, `Redis result exceeds the byte limit`);
    return { command: normalized, result, truncated: false };
  }
}
