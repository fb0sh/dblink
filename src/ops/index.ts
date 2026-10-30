import type { ConnectionRegistry } from "../registry.js";
import { MongoOperations } from "./mongo-ops.js";
import { RedisOperations } from "./redis-ops.js";
import { SqlOperations } from "./sql-ops.js";

export interface CapabilityOps {
  sql: SqlOperations;
  mongo: MongoOperations;
  redis: RedisOperations;
}

export function createCapabilityOps(registry: ConnectionRegistry): CapabilityOps {
  return {
    sql: new SqlOperations(registry),
    mongo: new MongoOperations(registry),
    redis: new RedisOperations(registry),
  };
}
