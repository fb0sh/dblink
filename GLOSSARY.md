# GLOSSARY

本仓库的领域词汇。输出命名（issue 标题、重构提案、测试名）应使用这里的术语，不要漂移到同义词。

| 术语 | 定义 |
| --- | --- |
| **engine / kind** | 数据库类型，由 DSN scheme 识别（`postgres` / `mysql` / `redis` / `sqlite` / 未来 `mongodb`）。 |
| **DSN** | 数据源连接串，含主机、库名与凭据；由 agent 在 `open_connection` 时直接传入。 |
| **connection_id** | 不透明连接句柄，标识注册表中的一条连接；不含库名或凭据。 |
| **connection registry** | 进程内的 `connection_id → 连接状态` 表。 |
| **pool** | 底层数据库连接池，按 DSN 指纹复用。 |
| **fingerprint** | DSN 的规范化指纹，用于去重与幂等 open。 |
| **read_only** | 连接级只读意图；默认 `true`，仅由 `open_connection` 决定。真实边界是数据库只读账号。 |
| **driver** | 引擎适配接口：`connect / query / execute / introspect / close`。 |
| **tool** | 通过 MCP 暴露给 agent 的操作（见 ADR-0005 的 8 个工具）。 |
| **truncation** | 结果超过行数/字节上限时的截断，返回 `truncated: true`，无游标。 |
| **bearer token** | HTTP 传输的鉴权凭据，来自 `DBLINK_HTTP_TOKEN`。 |
| **best-effort guard** | 代码层的 SQL 词法/单语句拦截，仅减少手滑，可被绕过。 |
