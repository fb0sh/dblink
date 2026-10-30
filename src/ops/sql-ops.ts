import { sqlOps } from "../drivers/types.js";
import { assertReadOnlySql, assertSingleStatement } from "../guard.js";
import type { ConnectionRegistry } from "../registry.js";
import { shapeList, shapeRows } from "../result.js";
import { assertWritable, checkedLimit, listEnvelope, queryEnvelope, type ListShaped, type QueryShaped } from "./shared.js";

export class SqlOperations {
  constructor(private readonly registry: ConnectionRegistry) {}

  async query(
    id: string,
    sql: string,
    params?: unknown[],
    opts: { requestedLimit?: number } = {},
  ): Promise<QueryShaped> {
    const conn = this.registry.resolve(id);
    assertReadOnlySql(sql);
    const limit = checkedLimit(opts.requestedLimit);
    const raw = await conn.run((d) => sqlOps(d).query(sql, params, { maxRows: limit + 1 }));
    return queryEnvelope(raw.columns, shapeRows(raw.rows, { requestedLimit: opts.requestedLimit }));
  }

  async execute(id: string, sql: string, params?: unknown[]): Promise<{ affected_rows: number }> {
    const conn = this.registry.resolve(id);
    assertWritable(
      conn,
      "This connection is read-only; db_execute is not allowed",
      "Re-open the connection with read_only=false to allow writes.",
    );
    assertSingleStatement(sql);
    const res = await conn.run((d) => sqlOps(d).execute(sql, params));
    return { affected_rows: res.affectedRows };
  }

  async listTables(
    id: string,
    schema?: string,
  ): Promise<{ tables: string[] } & ListShaped> {
    const conn = this.registry.resolve(id);
    const tables = await conn.run((d) => sqlOps(d).listTables(schema));
    return listEnvelope("tables", shapeList(tables));
  }

  async describeTable(
    id: string,
    table: string,
    schema?: string,
  ): Promise<{ columns: unknown[]; indexes: unknown[]; truncated: boolean }> {
    const conn = this.registry.resolve(id);
    const desc = await conn.run((d) => sqlOps(d).describeTable(table, schema));
    const columns = shapeList(desc.columns);
    const indexes = shapeList(desc.indexes);
    return { columns: columns.items, indexes: indexes.items, truncated: columns.truncated || indexes.truncated };
  }
}
