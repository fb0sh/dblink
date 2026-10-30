# dblink — 多数据库 MCP 访问服务

- Status: ready-for-agent
- Date: 2026-10-30
- 关联 ADR：0001–0009

## Problem Statement

Agent（LLM 驱动的编码/运维助手）需要读取与操作多种数据库（PostgreSQL、MySQL、Redis、SQLite，未来 MongoDB），但每个引擎的连接方式、查询语言、认证与结果形态都不同。逐个引擎手写连接代码既慢又不可复用；同时如果不加约束，agent 容易拉回海量数据撑爆上下文、或在只读场景误执行写操作。

## Solution

提供一个 Node.js MCP server（`dblink`），暴露统一的**连接句柄 + 工具**模型：agent 调用 `open_connection(dsn)` 拿到不透明 `connection_id`，随后用该 ID 执行只读查询、受控写操作、schema 内省与 Redis 只读命令，最后 `close_connection`。服务端负责连接池化、结果截断、错误码规范化、只读护栏与传输鉴权（HTTP）。

## User Stories

1. 作为 agent，我想用一条 DSN 调用 `open_connection` 建立连接并获得 `connection_id`，这样后续调用不必重复传 DSN。
2. 作为 agent，我想在 `open_connection` 时看到返回的 `kind` 与 `server_version`，这样我能确认连上的是哪个引擎、哪个版本。
3. 作为 agent，我想按 DSN scheme 自动识别引擎（`postgres://` / `mysql://` / `redis://` / `sqlite:`），这样我不必额外声明类型。
4. 作为 agent，我想对只读连接执行 `db_query`，这样我能安全地 SELECT 数据。
5. 作为 agent，我想给查询传 `params` 做参数绑定，这样我能复用查询并避免拼接错误。
6. 作为 agent，我想给 `db_query` 传 `limit`，这样我能控制返回行数。
7. 作为 agent，我想让结果在超限时返回 `truncated: true` 与真实行数，这样我知道结果被截断了。
8. 作为 agent，我想在只读连接上误发写语句时收到 `READ_ONLY_VIOLATION`，这样我能立刻纠正而不是悄悄写库。
9. 作为 agent，我想在 `read_only:false` 的连接上用 `db_execute` 执行写操作并拿到 `affected_rows`，这样我能确认写入影响行数。
10. 作为 agent，我想用 `db_list_tables` 列出表/集合，这样我不必手写 `information_schema` 查询。
11. 作为 agent，我想用 `db_describe_table` 拿到列名、类型与索引，这样我能理解表结构后再生成查询。
12. 作为 agent，我想用 `redis_command` 执行只读命令（GET/SCAN/HGETALL/LRANGE…），这样我能查询 Redis。
13. 作为 agent，我想在向 Redis 发送非白名单命令时收到 `UNSUPPORTED`，这样我知道该命令被禁用。
14. 作为 agent，我想用 `list_connections` 查看当前活跃连接及其 `alive/dead` 状态，这样我能判断是否需要重连。
15. 作为 agent，我想用 `close_connection` 释放连接，这样我能主动回收资源。
16. 作为 agent，我想对同一 DSN 重复 `open_connection` 时拿到同一个 `connection_id`，这样我不会堆出重复连接。
17. 作为 agent，我想在连接掉线后由服务端惰性重连并重试一次，这样我的查询不会因瞬时断连失败。
18. 作为 agent，我想在连接不存在时收到 `CONN_NOT_FOUND`，这样我能程序化地重新 open。
19. 作为 agent，我想在语句超时时收到 `TIMEOUT`，这样我能判断是慢查询而非语法错误。
20. 作为 agent，我想在 SQL 出错时收到 `SQL_ERROR` 且带可读 `message`，这样我能改写语句。
21. 作为 agent，我想所有失败都以 `{ok:false, error:{code,message,hint}}` 返回，这样我能按 `code` 分支处理。
22. 作为本地用户，我想用 stdio 直接启动 `npx @fb0sh/dblink` 且无需鉴权，这样本地开发零配置。
23. 作为远程用户，我想用 `--http 7331` 开启 HTTP 且必须携带 Bearer Token，这样我能远程访问而不裸奔。
24. 作为运维者，我想在启用 HTTP 但未配置 token 时服务拒绝启动，这样不会误开无鉴权端口。
25. 作为运维者，我想默认只 bind `127.0.0.1`，要对外必须显式 `DBLINK_BIND=0.0.0.0`，这样默认不暴露内网。
26. 作为运维者，我想服务端日志对 DSN 中的口令打码，这样不会把明文凭据持久化。
27. 作为开发者，我想 SQLite 用内置 `node:sqlite` 且能文件/内存模式，这样测试无需起容器。
28. 作为开发者，我想所有引擎实现同一 `Driver` 接口，这样新增引擎（如 MongoDB）不改既有工具。
29. 作为 agent，我想一次查询最多返回 100 行、256KB、30 秒，这样上下文不会被单条查询打爆。
30. 作为 agent，我想 `db_query` 只接受只读 SQL（SELECT/SHOW/EXPLAIN/只读 WITH），这样读路径语义明确。

## Implementation Decisions

**模块（不列路径）**

- 传输层：stdio 与 MCP Streamable HTTP 两个入口，共享同一工具注册表。
- 配置层：读取 `DBLINK_HTTP_TOKEN`、`DBLINK_BIND`、端口；缺失时 fail-closed。
- 鉴权中间件：HTTP 校验 `Authorization: Bearer <token>`，失败 401；stdio 直通。
- 工具注册表：8 个工具，参数用 `zod` 校验，统一返回契约。
- 连接注册表：`connection_id → {kind, dsn, pool, read_only, status}`；DSN 指纹去重、幂等 open；池大小 5、空闲 15 分钟、上限 20 池；惰性重连一次。
- Driver 接口：`connect / query / execute / introspect / close`；实现 PostgreSQL、MySQL、Redis、SQLite。
- 查询护栏（best-effort）：单语句、禁多语句、DML/DDL 词法快速失败；定位为防手滑，非安全边界。
- 结果整形：行数/字节/超时上限，超限 `truncated: true`，无游标。
- 错误映射：内部异常 → 固定 `code` 枚举。

**工具契约（决策要点）**

`open_connection` 返回：
```json
{ "ok": true, "connection_id": "conn_xxx", "kind": "postgres", "status": "connected", "read_only": true, "server_version": "16.3" }
```

错误契约：
```json
{ "ok": false, "error": { "code": "SQL_ERROR", "message": "...", "hint": "..." } }
```
`code` ∈ `CONN_NOT_FOUND | CONN_CLOSED | READ_ONLY_VIOLATION | SQL_ERROR | TIMEOUT | LIMIT_EXCEEDED | UNSUPPORTED`；失败时 MCP `isError=true`。

**关键约束**

- `read_only` 只在 `open_connection` 决定，默认 `true`，无环境变量开关；安全边界是数据库只读账号（见 ADR-0002、ADR-0003）。
- `connection_id` 不含库名/密码，永不回显 DSN；服务端日志必须打码口令。
- 引擎范围 v1 = PostgreSQL / MySQL / Redis / SQLite；MongoDB 为 v2，仅预留 `Driver` 扩展位（ADR-0008）。
- 传输与鉴权细节见 ADR-0006；结果/错误契约见 ADR-0007；技术栈见 ADR-0009。

## Testing Decisions

**什么算好测试**：只测外部可观察行为，不测内部实现。首选最高 seam，用 `(toolName, args) → JSON` 断言，不 mock 私有函数。

**Seam 与覆盖（已与用户确认：S1 + S2 + 轻量 S3）**

- **S1 — MCP 工具边界（主 seam）**：覆盖注册表幂等、只读门禁、`db_execute` 写路径、截断、全部错误码、Redis 命令白名单、内省工具。载体：SQLite 内存库（真 driver）+ 一个 fake driver（构造错误/超时/死连接）。
- **S2 — `Driver` 接口契约**：同一套 conformance 跑每个 driver 的 `connect/query/execute/introspect/close`。SQLite 进 CI；PostgreSQL / MySQL / Redis 走 docker-compose smoke（`open→query→close`）。
- **S3 — 传输/鉴权（轻量）**：HTTP 缺 token 拒启、错 token 401、stdio 冒烟各一条。

**Prior art**：仓库为 greenfield，无既有测试；采用表驱动（table-driven）用例风格组织 S1/S2。

## Out of Scope

- MongoDB 及其他引擎实现（v2，仅留扩展位）。
- profile / 凭据托管 / 密钥轮换。
- stdio 鉴权、多租户隔离、按客户端隔离的连接注册表。
- 游标分页、结果流式传输。
- 主动心跳保活、连接健康探测线程。
- 事务/会话级别的显式控制（BEGIN/COMMIT 管理）。
- 把 SQL 解析当作安全边界（仅 best-effort 护栏）。
- TLS 终止、反向代理、限流等网关职责。
- schema 变更 / 迁移工具。

## Further Notes

- 包名 `@fb0sh/dblink`（scoped，`dblink` 已被占用），bin `dblink`，`npx @fb0sh/dblink` 启动；Node ≥ 22；TypeScript → `tsc` → `dist/`。
- 默认参数：池 5 / 空闲 15min / 上限 20 池 / 100 行 / 256KB / 30s / 端口 7331。
- 对齐 `rules/KEEPSECURED.md`：不持久化明文凭据，服务端日志打码。
- 本轮仅产出 spec，未开始实现（遵循 KEEPTRACK：实现需另行授权）。
