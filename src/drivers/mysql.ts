import mysql from "mysql2/promise";
import { DblinkError } from "../errors.js";
import type {
  Driver,
  EngineKind,
  ExecuteResult,
  QueryOptions,
  QueryResult,
  TableDescription,
} from "./types.js";

export class MysqlDriver implements Driver {
  readonly kind: EngineKind = "mysql";
  private pool?: mysql.Pool;

  constructor(
    private readonly dsn: string,
    private readonly readOnly: boolean,
    private readonly poolSize: number,
  ) {}

  async connect(): Promise<void> {
    this.pool = mysql.createPool({
      uri: this.dsn,
      connectionLimit: this.poolSize,
      multipleStatements: false,
      waitForConnections: true,
    });
    if (this.readOnly) {
      this.pool.on("connection", (conn) => {
        conn.query("SET SESSION TRANSACTION READ ONLY");
      });
    }
    await this.pool.query("select 1");
  }

  private requirePool(): mysql.Pool {
    if (!this.pool) throw new DblinkError("CONN_CLOSED", "MySQL connection is not open");
    return this.pool;
  }

  async serverVersion(): Promise<string | undefined> {
    const [rows] = await this.requirePool().query("select version() as v");
    return (rows as { v: string }[])[0]?.v;
  }

  async query(sql: string, params?: unknown[], opts?: QueryOptions): Promise<QueryResult> {
    const [rows, fields] = await this.requirePool().query({
      sql,
      values: params ?? [],
      timeout: opts?.timeoutMs ?? 30000,
    });
    const maxRows = opts?.maxRows ?? 1000;
    const columns = (fields ?? []).map((f) => f.name);
    const arr = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    return { columns, rows: arr.slice(0, maxRows + 1) };
  }

  async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
    const [result] = await this.requirePool().query({ sql, values: params ?? [] });
    const header = result as mysql.ResultSetHeader;
    return { affectedRows: header.affectedRows ?? 0 };
  }

  async listTables(schema?: string): Promise<string[]> {
    const [rows] = await this.requirePool().query(
      `select table_name as name from information_schema.tables
       where table_schema = coalesce(?, database()) and table_type in ('BASE TABLE','VIEW')
       order by table_name`,
      [schema ?? null],
    );
    return (rows as { name: string }[]).map((r) => String(r.name));
  }

  async describeTable(table: string, schema?: string): Promise<TableDescription> {
    const pool = this.requirePool();
    const [cols] = await pool.query(
      `select column_name, column_type, is_nullable, column_default, column_key
       from information_schema.columns
       where table_schema = coalesce(?, database()) and table_name = ?
       order by ordinal_position`,
      [schema ?? null, table],
    );
    const colRows = cols as {
      column_name: string;
      column_type: string;
      is_nullable: string;
      column_default: string | null;
      column_key: string;
    }[];
    if (colRows.length === 0) {
      throw new DblinkError("SQL_ERROR", `Table not found: ${table}`, "Run db_list_tables to see available tables.");
    }
    const [idx] = await pool.query(
      `select index_name, column_name, non_unique, seq_in_index
       from information_schema.statistics
       where table_schema = coalesce(?, database()) and table_name = ?
       order by index_name, seq_in_index`,
      [schema ?? null, table],
    );
    const byName = new Map<string, { name: string; unique: boolean; columns: string[] }>();
    for (const r of idx as { index_name: string; column_name: string; non_unique: number }[]) {
      const existing = byName.get(r.index_name) ?? {
        name: r.index_name,
        unique: r.non_unique === 0,
        columns: [],
      };
      existing.columns.push(r.column_name);
      byName.set(r.index_name, existing);
    }
    return {
      columns: colRows.map((c) => ({
        name: c.column_name,
        type: c.column_type,
        nullable: c.is_nullable === "YES",
        default: c.column_default,
        primaryKey: c.column_key === "PRI",
      })),
      indexes: [...byName.values()],
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
