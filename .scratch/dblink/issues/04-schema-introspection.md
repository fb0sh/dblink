# 04: Schema 内省工具

**What to build:** 让 agent 结构化了解表结构，无需手写 `information_schema`。SQL 引擎通用。

**Blocked by:** 01 (SQLite 端到端只读查询)

**Status:** resolved

- [x] `db_list_tables(connection_id, schema?)` 返回表名列表
- [x] `db_describe_table(connection_id, table, schema?)` 返回列名、类型、可空、默认值与索引
- [x] 表不存在时返回 `SQL_ERROR` 且带可读 `hint`
- [x] 两个工具同样受结果上限与错误契约约束
