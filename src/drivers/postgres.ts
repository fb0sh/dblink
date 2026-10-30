import pg from "pg";
import { DblinkError } from "../errors.js";
import type {
  Driver,
  EngineKind,
  ExecuteResult,
  QueryOptions,
  QueryResult,
  TableDescription,
} from "./types.js";

export class PostgresDriver implements Driver {
  readonly kind: EngineKind = "postgres";
  private pool?: pg.Pool;

  constructor(
    private readonly dsn: string,
    private readonly readOnly: boolean,
    private readonly poolSize: number,
  ) {}

  async connect(): Promise<void> {
    const serverOptions = ["-c statement_timeout=30000"];
    if (this.readOnly) serverOptions.push("-c default_transaction_read_only=on");
    this.pool = new pg.Pool({
      connectionString: this.dsn,
      max: this.poolSize,
      options: serverOptions.join(" "),
    });
    this.pool.on("error", () => {
      /* keep the pool alive on idle client errors */
    });
    await this.pool.query("select 1");
  }

  private requirePool(): pg.Pool {
    if (!this.pool) throw new DblinkError("CONN_CLOSED", "PostgreSQL connection is not open");
    return this.pool;
  }

  async serverVersion(): Promise<string | undefined> {
    const res = await this.requirePool().query<{ v: string }>("select version() as v");
    return res.rows[0]?.v;
  }

  async query(sql: string, params?: unknown[], opts?: QueryOptions): Promise<QueryResult> {
    const res = await this.requirePool().query({
      text: sql,
      values: (params ?? []) as unknown[],
      rowMode: "array",
    });
    const columns = res.fields.map((f) => f.name);
    const maxRows = opts?.maxRows ?? 1000;
    const rows = (res.rows as unknown[][])
      .slice(0, maxRows + 1)
      .map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
    return { columns, rows };
  }

  async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
    const res = await this.requirePool().query({ text: sql, values: (params ?? []) as unknown[] });
    return { affectedRows: res.rowCount ?? 0 };
  }

  async listTables(schema?: string): Promise<string[]> {
    const res = await this.requirePool().query<{ name: string }>(
      `select table_name as name from information_schema.tables
       where table_schema = coalesce($1, current_schema())
         and table_type in ('BASE TABLE','VIEW')
       order by table_name`,
      [schema ?? null],
    );
    return res.rows.map((r) => r.name);
  }

  async describeTable(table: string, schema?: string): Promise<TableDescription> {
    const pool = this.requirePool();
    const cols = await pool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = coalesce($2, current_schema()) and table_name = $1
       order by ordinal_position`,
      [table, schema ?? null],
    );
    if (cols.rows.length === 0) {
      throw new DblinkError("SQL_ERROR", `Table not found: ${table}`, "Run db_list_tables to see available tables.");
    }
    const idx = await pool.query<{ name: string; unique: boolean; columns: string[] }>(
      `select i.relname as name, ix.indisunique as unique,
              array_agg(a.attname order by k.ord) as columns
       from pg_index ix
       join pg_class i on i.oid = ix.indexrelid
       join pg_class t on t.oid = ix.indrelid
       join pg_namespace n on n.oid = t.relnamespace
       join unnest(ix.indkey) with ordinality k(attnum, ord) on true
       join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
       where t.relname = $1 and n.nspname = coalesce($2, current_schema())
       group by i.relname, ix.indisunique`,
      [table, schema ?? null],
    );
    return {
      columns: cols.rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === "YES",
        default: c.column_default,
      })),
      indexes: idx.rows.map((r) => ({ name: r.name, unique: r.unique, columns: r.columns ?? [] })),
    };
  }

  async ping(): Promise<boolean> {
    try {
      await this.requirePool().query("select 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }
}
