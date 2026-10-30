# dblink — MongoDB 支持

- Status: ready-for-agent
- Date: 2026-10-30
- 关联 ADR：[0010 MongoDB 驱动与非 SQL 工具形状](../../docs/adr/0010-mongodb-driver-and-tool-surface.md)、[0003 只读边界](../../docs/adr/0003-read-only-boundary.md)、[0008 引擎范围](../../docs/adr/0008-engine-scope-and-driver-seam.md)

## Problem Statement

dblink 现在能访问 PostgreSQL、MySQL、Redis、SQLite，但**不支持 MongoDB**。需要 Mongo 的用户（文档型数据、灵活 schema）无法通过统一的 `connection_id` 模型访问它；SQL 工具（`db_query` 等）对 Mongo 不适用，直接调用只会得到 `UNSUPPORTED`（这是 engine capability 的边界，不是故障）。用户希望在同一个 MCP server 里，用与其它引擎一致的连接/只读/结果上限语义来查询和修改 Mongo 的 document。

## Solution

新增第五个引擎 **MongoDB**：DSN 以 `mongodb://` / `mongodb+srv://` 识别，接入现有 `ConnectionRegistry` 与 `read_only`/结果上限/错误契约。因为 Mongo 不是 SQL，提供 5 个 `mongo_*` 专用工具（find / aggregate / write / list_collections / describe_collection），返回 relaxed EJSON 以保留 `ObjectId`/`Date`/`Decimal128` 类型。只读连接禁止 `mongo_write`，并在只读时拦截写聚合阶段与 JS 执行。

## User Stories

1. 作为 agent，我想用 `mongodb://` DSN 调 `open_connection` 并获得 `connection_id`，这样我能像其它引擎一样复用连接。
2. 作为 agent，我想 `open_connection` 返回 `kind: "mongodb"` 与 `server_version`，这样我能确认连上的是 Mongo。
3. 作为 agent，我想支持 `mongodb+srv://`，这样我能连接 Atlas 等托管集群。
4. 作为 agent，我想 DSN 里的库作为默认 `database`，这样常用场景不必每次传库名。
5. 作为 agent，我想在调用时用 `database?` 覆盖默认库，这样我能跨库操作。
6. 作为 agent，我想用 `mongo_find` 按 filter 查询 collection，这样我能读取 document。
7. 作为 agent，我想给 `mongo_find` 传 `projection`，这样我只取需要的字段。
8. 作为 agent，我想给 `mongo_find` 传 `sort`，这样我能控制返回顺序。
9. 作为 agent，我想给 `mongo_find` 传 `limit`，这样我能控制返回文档数。
10. 作为 agent，我想用 `mongo_aggregate` 执行 pipeline，这样我能做分组、连接、统计。
11. 作为 agent，我想 `mongo_aggregate` 支持 `$match`/`$group`/`$lookup` 等只读阶段，这样我能完成常规分析。
12. 作为 agent，我想在只读连接上使用 `$out`/`$merge` 时被拒，这样我不会误写库。
13. 作为 agent，我想在只读连接上使用 `$where`/`$function`/`$accumulator` 时被拒，这样我不会在数据库里执行任意 JS。
14. 作为 agent，我想用 `mongo_write` 的 `insert` 插入一个或多个 document，这样我能新增数据（仅可写连接）。
15. 作为 agent，我想用 `mongo_write` 的 `update`（含 `multi`/`upsert`）更新 document，这样我能改数据。
16. 作为 agent，我想用 `mongo_write` 的 `delete`（含 `multi`）删除 document，这样我能清理数据。
17. 作为 agent，我想在只读连接上调用 `mongo_write` 得到 `READ_ONLY_VIOLATION`，这样我能立刻纠正。
18. 作为 agent，我想用 `mongo_list_collections` 列出 collection，这样我不必猜名字。
19. 作为 agent，我想用 `mongo_describe_collection` 拿到采样文档与索引，这样我能理解无 schema 的数据形态。
20. 作为 agent，我想结果被限制在 100 条 / 256KB / 30s，这样上下文不会被单次查询打爆。
21. 作为 agent，我想超限时返回 `truncated: true`，这样我知道结果被截断。
22. 作为 agent，我想返回值是 relaxed EJSON（`$oid`/`$date`/`$numberDecimal`），这样类型不丢、能安全写回。
23. 作为 agent，我想输入 filter/update 里的 EJSON（如 `{"_id":{"$oid":"…"}}`）能被正确解析，这样我能按 `_id` 精确操作。
24. 作为 agent，我想 Mongo 错误（重复键/校验失败/写冲突）以 `SQL_ERROR` + 原始消息返回，这样我能判断原因。
25. 作为 agent，我想 `connection_id` 不存在/已关闭分别返回 `CONN_NOT_FOUND`/`CONN_CLOSED`，行为与其它引擎一致。
26. 作为 agent，我想对同一 Mongo DSN 重复 `open_connection` 幂等返回同一 `connection_id`，这样不会堆连接。
27. 作为 agent，我想 `list_connections` 对 Mongo 连接显示 `alive/dead`，这样我能判断健康度。
28. 作为 agent，我想 `db_query`/`db_execute` 对 Mongo 连接返回 `UNSUPPORTED`，这样语义清晰（请改用 `mongo_*`）。
29. 作为运维者，我想 `DBLINK_POOL_SIZE` 控制 Mongo 连接池大小，这样我能调资源。
30. 作为运维者，我想 Mongo 连接默认只读时可安全用于只读账号，这样符合 ADR-0003 的安全模型。

## Implementation Decisions

**模块（不列路径）**

- `detectKind` 增加 `mongodb://`、`mongodb+srv://` → `kind: "mongodb"`。
- 新增 Mongo driver：实现 `Driver` 的 `connect / close / ping / serverVersion`；`query/execute/listTables/describeTable` 抛 `UNSUPPORTED`；额外提供 find / aggregate / write / listCollections / describeCollection 能力。
- `ConnectionRegistry`：复用现有指纹去重、幂等 open、池化（`poolSize` → `MongoClient.maxPoolSize`）、惰性重连、`alive`（`admin().ping()`）。新增 `mongo*` 方法，执行前做 `read_only` 与管道阶段校验。
- 新增 5 个 `mongo_*` 工具注册；`db_query`/`db_execute`/`db_list_tables`/`db_describe_table` 对 Mongo 直接 `UNSUPPORTED`。
- EJSON 编解码：输入 filter/update/pipeline 用 `EJSON.deserialize`；输出用 `EJSON.serialize(..., { relaxed: true })`。
- 只读校验：拒绝聚合阶段 `$out`/`$merge`（作为 pipeline 顶层阶段键），拒绝任意位置出现 `$where`/`$function`/`$accumulator`。
- 结果整形：复用 `shapeRows`/`shapeList`（100 / 1000 / 256KB）。
- 超时：复用 registry 的 30s Promise 竞速。

**工具契约（决策要点）**

- `mongo_find(connection_id, collection, filter?, projection?, sort?, limit?, database?)` → `{ ok, documents, count, truncated?, truncation_reason? }`
- `mongo_aggregate(connection_id, collection, pipeline, limit?, database?)` → `{ ok, documents, count, truncated? }`；pipeline 必须是数组
- `mongo_write(connection_id, collection, action, payload, database?)`，`action ∈ insert|update|delete`：
  - insert：`payload = { documents: object[] }` → `{ inserted_count, inserted_ids }`
  - update：`payload = { filter, update, multi?, upsert? }` → `{ matched_count, modified_count, upserted_id? }`
  - delete：`payload = { filter, multi? }` → `{ deleted_count }`
- `mongo_list_collections(connection_id, database?)` → `{ collections, count }`
- `mongo_describe_collection(connection_id, collection, database?)` → `{ sample_document?, indexes, inferred_fields? }`

**关键约束**

- `read_only` 默认 `true`；`mongo_write` 仅在 `read_only:false` 连接可用。真实边界是只读 DB 账号（ADR-0003）。
- 只读 Mongo 连接的 `find/aggregate/count/list/describe` 放行；写聚合阶段与 JS 执行被拒（`READ_ONLY_VIOLATION` 或 `UNSUPPORTED`）。
- 错误码复用 7 个枚举；Mongo 原始错误进 `message`。
- 新增依赖 `mongodb@^7`。

## Testing Decisions

**什么算好测试**：只测外部可观察行为（工具边界 JSON 入/出），不 mock 私有方法，不测 driver 内部实现。

**Seams（已与用户确认：复用 S1+S2，无新 seam）**

- **S1 — MCP 工具边界（主 seam）**：在 `mongodb-memory`/`mongo:7` 上通过 `(tool, args) → JSON` 覆盖 find/aggregate/write/list/describe、只读拦截（`$out`/`$merge`/`$where`）、`READ_ONLY_VIOLATION`、`UNSUPPORTED`、EJSON 形状（`$oid`/`$date`）、截断。
- **S2 — Driver conformance**：Mongo 与 pg/mysql/redis 跑同一套 `open → 操作 → close` smoke，`docker-compose` 增加 `mongo:7`，用 `DBLINK_TEST_MONGO_DSN` gated。

**Prior art**：沿用 `test/01..05` 的 harness（InMemoryTransport）与 `test/drivers.conformance.test.ts` 的 gated 模式。

## Out of Scope

- GridFS、Change Streams、事务/会话（session）、副本集/分片配置。
- MongoDB Atlas 特有的网络/认证配置（由 DSN 决定）。
- Mongo 上的 SQL 工具（`db_query` 等）——仍返回 `UNSUPPORTED`。
- 只读连接上的任何写能力。
- 从 SQL 引擎自动推断/迁移 schema 到 Mongo。
- Redis 的改动（Redis 维持现状）。

## Further Notes

- 依赖：`mongodb@^7`；测试 `docker-compose` 增加 `mongo:7`（可选 `mongodb-memory-server` 免 docker）。
- 工具总数 8 → 13；`mongo_*` 用 `database?` 覆盖 DSN 默认库。
- 设计依据见 ADR-0010；`engine capability` 术语见 `GLOSSARY.md`（"工具不适用 ≠ 引擎不可用"）。
- 本轮仅产出 spec，未开始实现。
