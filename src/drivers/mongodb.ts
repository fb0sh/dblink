import { EJSON } from "bson";
import { MongoClient, type Db, type Document, type FindOptions } from "mongodb";
import { DblinkError } from "../errors.js";
import { defaultDatabaseFromDsn, fromEjson, fromEjsonArray, planWrite, toRelaxedEjson } from "./mongo-codec.js";
import type {
  Driver,
  EngineKind,
  MongoAggregateOptions,
  MongoCollectionDescription,
  MongoFindOptions,
  MongoWriteOperation,
} from "./types.js";

export class MongoDriver implements Driver {
  readonly kind: EngineKind = "mongodb";
  private client?: MongoClient;
  private readonly defaultDb: string;

  constructor(
    private readonly dsn: string,
    private readonly poolSize: number,
  ) {
    this.defaultDb = defaultDatabaseFromDsn(dsn);
  }

  async connect(): Promise<void> {
    this.client = new MongoClient(this.dsn, { maxPoolSize: this.poolSize });
    await this.client.connect();
    await this.db().command({ ping: 1 });
  }

  private db(name?: string): Db {
    if (!this.client) throw new DblinkError("CONN_CLOSED", "MongoDB connection is not open");
    return this.client.db(name || this.defaultDb);
  }

  async serverVersion(): Promise<string | undefined> {
    const info = (await this.db().admin().command({ buildInfo: 1 })) as { version?: string };
    return info.version ? `mongodb ${info.version}` : "mongodb";
  }

  async find(collection: string, opts: MongoFindOptions): Promise<Record<string, unknown>[]> {
    const filter: Document = opts.filter !== undefined ? fromEjson(opts.filter) : {};
    const options: FindOptions = {};
    if (opts.projection !== undefined) options.projection = fromEjson(opts.projection);
    if (opts.sort !== undefined) options.sort = fromEjson(opts.sort) as FindOptions["sort"];
    let cursor = this.db(opts.database).collection(collection).find(filter, options);
    if (opts.limit) cursor = cursor.limit(opts.limit);
    return (await cursor.toArray()).map(toRelaxedEjson);
  }

  async aggregate(
    collection: string,
    pipeline: unknown[],
    opts: MongoAggregateOptions,
  ): Promise<Record<string, unknown>[]> {
    const stages = fromEjsonArray(pipeline);
    let cursor = this.db(opts.database).collection(collection).aggregate(stages);
    if (opts.limit) cursor = cursor.limit(opts.limit);
    return (await cursor.toArray()).map(toRelaxedEjson);
  }

  async mongoWrite(op: MongoWriteOperation): Promise<Record<string, unknown>> {
    const plan = planWrite(op);
    const collection = this.db(op.database).collection(op.collection);

    if (plan.kind === "insert") {
      const res = await collection.insertMany(plan.documents);
      return { inserted_count: res.insertedCount, inserted_ids: EJSON.serialize(res.insertedIds, { relaxed: true }) };
    }
    if (plan.kind === "update") {
      const options = { upsert: plan.upsert };
      const res = plan.multi
        ? await collection.updateMany(plan.filter, plan.update, options)
        : await collection.updateOne(plan.filter, plan.update, options);
      return {
        matched_count: res.matchedCount,
        modified_count: res.modifiedCount,
        upserted_id: res.upsertedId ? EJSON.serialize(res.upsertedId, { relaxed: true }) : null,
      };
    }
    const res = plan.multi ? await collection.deleteMany(plan.filter) : await collection.deleteOne(plan.filter);
    return { deleted_count: res.deletedCount };
  }

  async listCollections(database?: string): Promise<string[]> {
    const cols = await this.db(database).listCollections({}, { nameOnly: true }).toArray();
    return cols.map((c) => c.name);
  }

  async describeCollection(collection: string, database?: string): Promise<MongoCollectionDescription> {
    const db = this.db(database);
    const exists = await db.listCollections({ name: collection }, { nameOnly: true }).toArray();
    if (exists.length === 0) {
      throw new DblinkError(
        "SQL_ERROR",
        `Collection not found: ${collection}`,
        "Run mongo_list_collections to see available collections.",
      );
    }
    const coll = db.collection(collection);
    const sample = await coll.find({}).limit(5).toArray();
    const indexes = await coll.indexes();
    const fields = new Set<string>();
    for (const doc of sample) {
      for (const key of Object.keys(doc)) fields.add(key);
    }
    return {
      sample_document: sample[0] ? toRelaxedEjson(sample[0]) : null,
      indexes: indexes.map((i) => EJSON.serialize(i, { relaxed: true })),
      inferred_fields: [...fields],
    };
  }

  async ping(): Promise<boolean> {
    try {
      await this.db().command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
  }
}
