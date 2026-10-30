# 03: 只读门禁与写路径（read_only + db_execute）

**What to build:** 连接级只读语义与受控写路径：默认只读，只读连接拒绝写；可写连接通过 `db_execute` 执行写入并回 `affected_rows`。

**Blocked by:** 01 (SQLite 端到端只读查询)

**Status:** ready-for-agent

- [ ] `open_connection` 默认 `read_only:true`；对只读连接调用 `db_execute` 返回 `READ_ONLY_VIOLATION`
- [ ] `open_connection(read_only:false)` 后可 `db_execute` 写入并返回 `affected_rows`
- [ ] `db_query` 仅接受只读语句（SELECT/SHOW/EXPLAIN/只读 WITH），写入语句被拒
- [ ] best-effort 护栏：拒绝多语句与 DDL/DML（文档注明可被绕过，非安全边界）
