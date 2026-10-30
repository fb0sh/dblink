# 0010. MongoDB 驱动与非 SQL 工具形状

- Date: 2026-10-30
- Status: Accepted

## Context

需要把 MongoDB 接入 dblink。它不是 SQL 引擎：数据单元是 **document**、容器是 **collection**、查询是 JSON filter / **aggregate pipeline**，类型系统含 `ObjectId`/`Date`/`Decimal128` 等 BSON 类型。套用 `db_query(sql)` 不成立，也不能像 PG 那样用会话级只读开关。

## Decision

- **DSN**：`mongodb://` 与 `mongodb+srv://`；DSN 末尾的库为默认 `database`，工具可传 `database?` 覆盖；`collection` 必填。
- **工具（5 个，`mongo_` 前缀）**：
  - `mongo_find(connection_id, collection, filter?, projection?, sort?, limit?, database?)`
  - `mongo_aggregate(connection_id, collection, pipeline, limit?, database?)`
  - `mongo_write(connection_id, collection, action, payload, database?)`，`action ∈ insert|update|delete`，仅可写连接
  - `mongo_list_collections(connection_id, database?)`
  - `mongo_describe_collection(connection_id, collection, database?)`（采样文档 + 索引）
- **读写门禁**：`read_only:true` 时只放行 find/aggregate/count/list/describe；`mongo_write` 直接 `READ_ONLY_VIOLATION`。真实安全边界仍是**只读数据库账号**（沿用 ADR-0003）。
- **只读时额外拦截**：聚合阶段 `$out`、`$merge`；JS 执行 `$where`、`$function`、`$accumulator`。
- **序列化**：返回 relaxed **EJSON**，保留 `ObjectId`/`Date`/`Decimal128` 类型。
- **结果上限**：沿用 100 条 / 256KB / 30s，超限 `truncated:true`。
- **错误码**：复用既有 7 个 code；Mongo 的重复键/校验/写冲突映射为 `SQL_ERROR`（原始信息进 `message`）。
- **连接管理**：复用 `ConnectionRegistry`；`DBLINK_POOL_SIZE` 映射为 `MongoClient.maxPoolSize`；DSN 指纹去重、幂等 open；`alive` 用 `admin().ping()`；惰性重连由 MongoClient + 一次重试兜底。
- **测试**：`docker-compose` 增加 `mongo:7`，与 pg/mysql/redis 一致的 gated 集成测试；`mongodb-memory-server` 作为后续免 docker 选项。

## Consequences

- 工具总数由 8 增至 13；agent 需要按引擎选择正确工具（SQL 工具对 Mongo/Redis 返回 `UNSUPPORTED`）。
- 只读在 Mongo 上只能是应用层 best-effort；必须依赖只读账号兜底。
- EJSON 让往返保真，但 agent 需要理解 `$oid`/`$date` 形状。
- 新增 `mongodb` 依赖；测试新增一个 docker 服务。
