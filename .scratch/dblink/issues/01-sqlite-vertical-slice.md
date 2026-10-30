# 01: SQLite 端到端只读查询（stdio 骨架）

**What to build:** 一条最小但完整的垂直链路：以 stdio 启动服务，`open_connection` 接收 SQLite DSN 返回 `connection_id`，`db_query` 执行 SELECT 返回行集，`close_connection` 释放。对外已能演示"连库→查询→断开"。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 服务以 stdio 启动，暴露 `open_connection` / `close_connection` / `db_query` 三个工具
- [ ] `open_connection` 接受 SQLite DSN（文件或内存），返回 `{ok:true, connection_id, kind:"sqlite", status:"connected", read_only:true}`
- [ ] `db_query` 用该 `connection_id` 执行 SELECT，返回对象数组行集
- [ ] 不存在的 `connection_id` 返回 `{ok:false, error:{code:"CONN_NOT_FOUND"}}` 且 MCP `isError=true`
- [ ] `close_connection` 后再次查询返回 `CONN_CLOSED`
- [ ] 工具入参经 schema 校验，非法入参返回结构化错误
