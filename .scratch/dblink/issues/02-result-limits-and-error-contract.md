# 02: 结果上限、截断与错误码契约

**What to build:** 所有工具统一受行数/字节/超时上限约束，超限可被识别；所有失败收敛为固定错误码契约。

**Blocked by:** 01 (SQLite 端到端只读查询)

**Status:** resolved

- [x] `db_query` 默认返回 100 行；`limit` 可调，硬上限 1000
- [x] 超过行数上限时返回 `truncated:true` 与实际 `rows_returned`，不提供游标
- [x] 超过 256KB 字节上限时同样截断并标记
- [x] 语句超过 30s 返回 `code:"TIMEOUT"`
- [x] 所有失败为 `{ok:false, error:{code,message,hint?}}`，`code` ∈ `CONN_NOT_FOUND/CONN_CLOSED/READ_ONLY_VIOLATION/SQL_ERROR/TIMEOUT/LIMIT_EXCEEDED/UNSUPPORTED`，且 MCP `isError=true`
- [x] SQL 语法/执行错误映射为 `SQL_ERROR`；参数超限映射为 `LIMIT_EXCEEDED`

## Comments
- 2026-10-30: resolved on `feature/dblink`. Verified by unit tests test/02-limits-errors.test.ts (100/1000 row, 256KB byte, LIMIT_EXCEEDED, error codes).
