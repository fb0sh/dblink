import { mongoOps } from "../drivers/types.js";
import type {
  MongoAggregateOptions,
  MongoCollectionDescription,
  MongoFindOptions,
  MongoWriteOperation,
} from "../drivers/types.js";
import { assertAggregatePipeline, assertNoServerSideJs } from "../mongo-guard.js";
import type { ConnectionRegistry } from "../registry.js";
import { shapeList, shapeRows } from "../result.js";
import { assertWritable, checkedLimit, guardBytes, listEnvelope, mongoEnvelope, type ListShaped, type MongoShaped } from "./shared.js";

export class MongoOperations {
  constructor(private readonly registry: ConnectionRegistry) {}

  async find(id: string, collection: string, opts: MongoFindOptions = {}): Promise<MongoShaped> {
    const conn = this.registry.resolve(id);
    assertNoServerSideJs(opts.filter);
    const limit = checkedLimit(opts.limit);
    const docs = await conn.run((d) => mongoOps(d).find(collection, { ...opts, limit: limit + 1 }));
    return mongoEnvelope(shapeRows(docs, { requestedLimit: opts.limit }));
  }

  async aggregate(
    id: string,
    collection: string,
    pipeline: unknown[],
    opts: MongoAggregateOptions = {},
  ): Promise<MongoShaped> {
    const conn = this.registry.resolve(id);
    assertAggregatePipeline(pipeline, conn.readOnly);
    const limit = checkedLimit(opts.limit);
    const docs = await conn.run((d) => mongoOps(d).aggregate(collection, pipeline, { ...opts, limit: limit + 1 }));
    return mongoEnvelope(shapeRows(docs, { requestedLimit: opts.limit }));
  }

  async write(id: string, op: MongoWriteOperation): Promise<Record<string, unknown>> {
    const conn = this.registry.resolve(id);
    assertNoServerSideJs(op.payload.filter);
    assertNoServerSideJs(op.payload.update);
    assertWritable(
      conn,
      "This connection is read-only; mongo_write is not allowed",
      "Re-open the connection with read_only=false to allow writes.",
    );
    return conn.run((d) => mongoOps(d).mongoWrite(op));
  }

  async listCollections(
    id: string,
    database?: string,
  ): Promise<{ collections: string[] } & ListShaped> {
    const conn = this.registry.resolve(id);
    const collections = await conn.run((d) => mongoOps(d).listCollections(database));
    return listEnvelope("collections", shapeList(collections));
  }

  async describeCollection(
    id: string,
    collection: string,
    database?: string,
  ): Promise<MongoCollectionDescription & { collection: string; truncated: boolean }> {
    const conn = this.registry.resolve(id);
    const desc = await conn.run((d) => mongoOps(d).describeCollection(collection, database));
    const indexes = shapeList(desc.indexes);
    guardBytes(desc.sample_document, "Sample document exceeds the result byte limit");
    return {
      collection,
      sample_document: desc.sample_document,
      indexes: indexes.items,
      inferred_fields: desc.inferred_fields,
      truncated: indexes.truncated,
    };
  }
}
