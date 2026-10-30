import { DatabaseSync, type StatementSync } from "node:sqlite";
import { DblinkError } from "../errors.js";
import type {
  Driver,
  EngineKind,
  ExecuteResult,
  QueryOptions,
  QueryResult,
  TableDescription,
} from "./types.js";

export function sqlitePathFromDsn(dsn: string): string {
  if (!dsn.startsWith("sqlite:")) {
    throw new DblinkError("INVALID_ARGUMENT", `Not a sqlite DSN: ${dsn}`);
  }
  let rest = dsn.slice("sqlite:".length);
  if (rest.startsWith("//")) rest = rest.slice(2);
  if (rest === "" || rest === ":memory:" || rest === "/:memory:") return ":memory:";
  return rest;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export class SqliteDriver implements Driver {
  readonly kind: EngineKind = "sqlite";
  private db?: DatabaseSync;

  constructor(
    private readonly path: string,
    private readonly readOnly: boolean,
  ) {}

  async connect(): Promise<void> {
    this.db = new DatabaseSync(this.path);
    if (this.readOnly) this.db.exec("PRAGMA query_only = ON");
  }

  private requireDb(): DatabaseSync {
    if (!this.db) throw new DblinkError("CONN_CLOSED", "SQLite connection is not open");
    return this.db;
  }

  async serverVersion(): Promise<string | undefined> {
    const row = this.requireDb().prepare("select sqlite_version() as v").get() as { v: string };
    return `sqlite ${row.v}`;
  }

  async query(sql: string, params?: unknown[], opts?: QueryOptions): Promise<QueryResult> {
    const stmt: StatementSync = this.requireDb().prepare(sql);
    const maxRows = opts?.maxRows ?? 1000;
    const rows: Record<string, unknown>[] = [];
    const iterator = stmt.iterate(...((params ?? []) as never[]));
    for (const row of iterator) {
      rows.push(row as Record<string, unknown>);
      if (rows.length >= maxRows + 1) break;
    }
    const columns = stmt.columns().map((c) => c.name);
    return { columns, rows };
  }

  async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
    const info = this.requireDb().prepare(sql).run(...((params ?? []) as never[]));
    return { affectedRows: Number(info.changes) };
  }

  async listTables(): Promise<string[]> {
    const rows = this.requireDb()
      .prepare(
        "select name from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name",
      )
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  async describeTable(table: string): Promise<TableDescription> {
    const db = this.requireDb();
    const info = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];
    if (info.length === 0) {
      throw new DblinkError("SQL_ERROR", `Table not found: ${table}`, "Run db_list_tables to see available tables.");
    }
    const columns = info.map((c) => ({
      name: c.name,
      type: c.type || undefined,
      nullable: c.notnull === 0,
      default: c.dflt_value,
      primaryKey: c.pk > 0,
    }));
    const indexes = db.prepare(`PRAGMA index_list(${quoteIdent(table)})`).all() as {
      name: string;
      unique: number;
    }[];
    const indexMeta = indexes.map((idx) => {
      const cols = db.prepare(`PRAGMA index_info(${quoteIdent(idx.name)})`).all() as { name: string }[];
      return { name: idx.name, unique: idx.unique === 1, columns: cols.map((c) => c.name) };
    });
    return { columns, indexes: indexMeta };
  }

  async ping(): Promise<boolean> {
    try {
      this.requireDb().prepare("select 1").get();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }
}
