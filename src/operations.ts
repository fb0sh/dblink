import type {
  MongoAggregateOptions,
  MongoCollectionDescription,
  MongoFindOptions,
  MongoWriteOperation,
} from "./drivers/types.js";
import { MongoOperations } from "./ops/mongo-ops.js";
import { RedisOperations } from "./ops/redis-ops.js";
import type { QueryShaped, MongoShaped } from "./ops/shared.js";
import { SqlOperations } from "./ops/sql-ops.js";
import type { ConnectionRegistry } from "./registry.js";

export type { QueryShaped, MongoShaped } from "./ops/shared.js";

/**
 * Engine operations façade. The 10-method interface is the seam callers and
 * tests use; SQL / MongoDB / Redis implementations live in internal capability
 * modules so each can change for its own reasons.
 */
export class EngineOperations {
  readonly sql: SqlOperations;
  readonly mongo: MongoOperations;
  readonly redis: RedisOperations;

  constructor(registry: ConnectionRegistry) {
    this.sql = new SqlOperations(registry);
    this.mongo = new MongoOperations(registry);
    this.redis = new RedisOperations(registry);
  }

  query(id: string, sql: string, params?: unknown[], opts: { requestedLimit?: number } = {}): Promise<QueryShaped> {
    return this.sql.query(id, sql, params, opts);
  }

  execute(id: string, sql: string, params?: unknown[]): Promise<{ affected_rows: number }> {
    return this.sql.execute(id, sql, params);
  }

  listTables(id: string, schema?: string) {
    return this.sql.listTables(id, schema);
  }

  describeTable(id: string, table: string, schema?: string) {
    return this.sql.describeTable(id, table, schema);
  }

  mongoFind(id: string, collection: string, opts?: MongoFindOptions): Promise<MongoShaped> {
    return this.mongo.find(id, collection, opts);
  }

  mongoAggregate(
    id: string,
    collection: string,
    pipeline: unknown[],
    opts?: MongoAggregateOptions,
  ): Promise<MongoShaped> {
    return this.mongo.aggregate(id, collection, pipeline, opts);
  }

  mongoWrite(id: string, op: MongoWriteOperation): Promise<Record<string, unknown>> {
    return this.mongo.write(id, op);
  }

  mongoListCollections(id: string, database?: string) {
    return this.mongo.listCollections(id, database);
  }

  mongoDescribeCollection(id: string, collection: string, database?: string): Promise<MongoCollectionDescription & { collection: string; truncated: boolean }> {
    return this.mongo.describeCollection(id, collection, database);
  }

  redisCommand(id: string, command: string, args: string[]) {
    return this.redis.command(id, command, args);
  }
}
