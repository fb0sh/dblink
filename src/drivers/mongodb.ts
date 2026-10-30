import { EJSON } from "bson";
import { MongoClient, type Db, type Document, type FindOptions } from "mongodb";
import { DblinkError } from "../errors.js";
import type {
  Driver,
  EngineKind,
  ExecuteResult,
  MongoAggregateOptions,
  MongoCollectionDescription,
  MongoFindOptions,
  MongoWriteOperation,
  QueryResult,
  TableDescription,
} from "./types.js";

function defaultDatabaseFromDsn(dsn: string): string {
  // new URL() rejects multi-host DSNs like mongodb://h1,h2/db, so fall back to
  // a scheme-aware regex that still extracts the database path.
  try {
    const parsed = new URL(dsn);
    return decodeURIComponent((parsed.pathname || "").replace(/^\//, "")) || "test";
  } catch {
    const match = /^mongodb(?:\+srv)?:\/\/[^/]*\/([^?]*)/i.exec(dsn);
    if (!match) {
      throw new DblinkError("SQL_ERROR", "Invalid MongoDB DSN", "Expected mongodb:// or mongodb+srv:// URL.");
    }
    return decodeURIComponent(match[1] || "") || "test";
  }
}

function toRelaxedEjson(value: unknown): Record<string, unknown> {
  return EJSON.serialize(value, { relaxed: true }) as Record<string, unknown>;
}

function deserializeEjson(value: unknown): Document {
  return EJSON.deserialize(value as never) as Document;
}

function deserializeEjsonArray(value: unknown): Document[] {
  return EJSON.deserialize(value as never) as Document[];
}

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

  async query(): Promise<QueryResult> {
    throw new DblinkError("UNSUPPORTED", "MongoDB does not support SQL queries", "Use mongo_* tools.");
  }

  async execute(): Promise<ExecuteResult> {
    throw new DblinkError("UNSUPPORTED", "MongoDB does not support SQL execution", "Use mongo_write.");
  }

  async listTables(): Promise<string[]> {
    throw new DblinkError("UNSUPPORTED", "MongoDB has collections, not tables", "Use mongo_list_collections.");
  }

  async describeTable(): Promise<TableDescription> {
    throw new DblinkError("UNSUPPORTED", "MongoDB has no table schema", "Use mongo_describe_collection.");
  }

  async find(collection: string, opts: MongoFindOptions): Promise<Record<string, unknown>[]> {
    const filter: Document = opts.filter !== undefined ? deserializeEjson(opts.filter) : {};
    const options: FindOptions = {};
    if (opts.projection !== undefined) options.projection = deserializeEjson(opts.projection);
    if (opts.sort !== undefined) options.sort = deserializeEjson(opts.sort) as FindOptions["sort"];
    let cursor = this.db(opts.database).collection(collection).find(filter, options);
    if (opts.limit) cursor = cursor.limit(opts.limit);
    const docs = await cursor.toArray();
    return docs.map(toRelaxedEjson);
  }

  async aggregate(
    collection: string,
    pipeline: unknown[],
    opts: MongoAggregateOptions,
  ): Promise<Record<string, unknown>[]> {
    const stages = deserializeEjsonArray(pipeline);
    let cursor = this.db(opts.database).collection(collection).aggregate(stages);
    if (opts.limit) cursor = cursor.limit(opts.limit);
    const docs = await cursor.toArray();
    return docs.map(toRelaxedEjson);
  }

  async mongoWrite(op: MongoWriteOperation): Promise<Record<string, unknown>> {
    const collection = this.db(op.database).collection(op.collection);
    const payload = op.payload ?? {};
    if (op.action === "insert") {
      const documents = (payload.documents as unknown[]) ?? [];
      if (!Array.isArray(documents) || documents.length === 0) {
        throw new DblinkError("SQL_ERROR", "insert requires a non-empty documents array");
      }
      const res = await collection.insertMany(documents.map((d) => deserializeEjson(d)));
      return { inserted_count: res.insertedCount, inserted_ids: EJSON.serialize(res.insertedIds, { relaxed: true }) };
    }
    if (op.action === "update") {
      const filter = deserializeEjson(payload.filter ?? {});
      const update = deserializeEjson(payload.update ?? {});
      const options = { upsert: Boolean(payload.upsert) };
      const res = payload.multi
        ? await collection.updateMany(filter, update, options)
        : await collection.updateOne(filter, update, options);
      return {
        matched_count: res.matchedCount,
        modified_count: res.modifiedCount,
        upserted_id: res.upsertedId ? EJSON.serialize(res.upsertedId, { relaxed: true }) : null,
      };
    }
    if (op.action === "delete") {
      const filter = deserializeEjson(payload.filter ?? {});
      const res = payload.multi ? await collection.deleteMany(filter) : await collection.deleteOne(filter);
      return { deleted_count: res.deletedCount };
    }
    throw new DblinkError("SQL_ERROR", `Unknown write action: ${String(op.action)}`);
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
