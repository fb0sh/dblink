export type EngineKind = "postgres" | "mysql" | "redis" | "sqlite";

export interface ColumnMeta {
  name: string;
  type?: string;
  nullable?: boolean;
  default?: string | null;
  primaryKey?: boolean;
}

export interface IndexMeta {
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface TableDescription {
  columns: ColumnMeta[];
  indexes: IndexMeta[];
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ExecuteResult {
  affectedRows: number;
}

export interface QueryOptions {
  maxRows?: number;
  timeoutMs?: number;
}

export interface Driver {
  readonly kind: EngineKind;
  connect(): Promise<void>;
  serverVersion(): Promise<string | undefined>;
  query(sql: string, params?: unknown[], opts?: QueryOptions): Promise<QueryResult>;
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>;
  listTables(schema?: string): Promise<string[]>;
  describeTable(table: string, schema?: string): Promise<TableDescription>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
  /** Redis-only: run a raw command. Other drivers throw UNSUPPORTED. */
  command?(command: string, args: string[]): Promise<unknown>;
}
