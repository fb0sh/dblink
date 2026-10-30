import { EJSON } from "bson";
import { MongoClient, type Db, type Document } from "mongodb";
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
  try {
    const u = new URL(dsn);
    const db = decodeURIComponent((u.pathname || "").replace(/^\//, ""));
    return db || "test";
  } catch {
    return "test";
  }
}

function toPlain(value: unknown): Record<string, unknown> {
  return EJSON.serialize(value, { relaxed: true }) as Record<string, unknown>;
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
    const filter: Document = opts.filter !== undefined ? (EJSON.deserialize(opts.filter as never) as Document) : {};
    const options: any = {};
    if (opts.projection !== undefined) options.projection = EJSON.deserialize(opts.projection as never) as Document;
    if (opts.sort !== undefined) options.sort = EJSON.deserialize(opts.sort as never) as Document;
    let cursor = this.db(opts.database).collection(collection).find(filter, options);
    if (opts.limit) cursor = cursor.limit(opts.limit);
    const docs = await cursor.toArray();
    return docs.map(toPlain);
  }

  async aggregate(
    collection: string,
    pipeline: unknown[],
    opts: MongoAggregateOptions,
  ): Promise<Record<string, unknown>[]> {
    const stages = EJSON.deserialize(pipeline as never) as Document[];
    let docs = await this.db(opts.database).collection(collection).aggregate(stages).toArray();
    if (opts.limit) docs = docs.slice(0, opts.limit);
    return docs.map(toPlain);
  }

  async mongoWrite(op: MongoWriteOperation): Promise<Record<string, unknown>> {
    const collection = this.db(op.database).collection(op.collection);
    const payload = op.payload ?? {};
    if (op.action === "insert") {
      const documents = (payload.documents as unknown[]) ?? [];
      if (!Array.isArray(documents) || documents.length === 0) {
        throw new DblinkError("SQL_ERROR", "insert requires a non-empty documents array");
      }
      const res = await collection.insertMany(documents.map((d) => EJSON.deserialize(d as never) as Document) as Document[]);
      return { inserted_count: res.insertedCount, inserted_ids: EJSON.serialize(res.insertedIds, { relaxed: true }) };
    }
    if (op.action === "update") {
      const filter = EJSON.deserialize(payload.filter ?? {} as never) as Document;
      const update = EJSON.deserialize(payload.update ?? {} as never) as Document;
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
      const filter = EJSON.deserialize(payload.filter ?? {} as never) as Document;
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
    const coll = this.db(database).collection(collection);
    const sample = await coll.find({}).limit(5).toArray();
    const indexes = await coll.indexes();
    const fields = new Set<string>();
    for (const doc of sample) {
      for (const key of Object.keys(doc)) fields.add(key);
    }
    return {
      sample_document: sample[0] ? toPlain(sample[0]) : null,
      indexes: indexes.map((i) => EJSON.serialize(i, { relaxed: true })),
      fields: [...fields],
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
