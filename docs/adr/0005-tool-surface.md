# 0005. 工具面：8 个工具、读写分离、非 SQL 引擎独立工具

- Date: 2026-10-30
- Status: Accepted

## Context

"越多越好"的数据库种类与"模型上下文有限"相冲突。套用单一 `sql` 参数无法覆盖 Redis（命令）与 MongoDB（聚合管道）。需要明确工具粒度。

## Decision

暴露以下 8 个工具，读写分离，非 SQL 引擎使用独立工具形状：

| 工具 | 签名 | 说明 |
| --- | --- | --- |
| `open_connection` | `(dsn, read_only=true, name?)` | 返回 `{connection_id, kind, status, read_only, server_version}` |
| `close_connection` | `(connection_id)` | 关闭并释放池 |
| `list_connections` | `()` | 活跃连接与 `alive/dead` |
| `db_query` | `(connection_id, sql, params?, limit?)` | 仅只读 SQL（SELECT/SHOW/EXPLAIN/只读 WITH） |
| `db_execute` | `(connection_id, sql, params?)` | 仅对 `read_only:false` 连接，返回 `affected_rows` |
| `db_list_tables` | `(connection_id, schema?)` | 列出表/集合 |
| `db_describe_table` | `(connection_id, table, schema?)` | 列名/类型/索引 |
| `redis_command` | `(connection_id, command, args?)` | 仅只读命令白名单 |

## Consequences

- 工具总数受控在 8 个，避免挤占上下文。
- 写操作独立成 `db_execute`，权限与审计边界清晰，模型不易把 UPDATE 当查询误执行。
- 让模型走结构化内省工具，而不是手写 `information_schema` 查询。
