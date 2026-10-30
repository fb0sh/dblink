# 02: Mongo 连通 + mongo_find（端到端，EJSON 输出）

**What to build:** 通过 `open_connection` 连上 MongoDB 并拿到 `connection_id`，用 `mongo_find` 按 filter/projection/sort/limit 查询 collection，返回 relaxed EJSON（`$oid`/`$date`）。SQL 工具对 Mongo 返回 `UNSUPPORTED`。可演示：连 Mongo、查一个 collection、看到 `$oid` 类型。

**Blocked by:** 01 (Mongo 依赖与测试环境)

**Status:** resolved

- [x] `mongodb://` / `mongodb+srv://` 识别为 `kind:"mongodb"`
- [x] `open_connection` 返回 `connection_id` 与 `server_version`
- [x] `mongo_find` 支持 `filter/projection/sort/limit/database`
- [x] 返回 relaxed EJSON，`ObjectId` 显示为 `{"$oid":"…"}`、日期为 `{"$date":…}`
- [x] `db_query`/`db_execute` 对 Mongo 连接返回 `UNSUPPORTED`
- [x] 未知/已关闭 `connection_id` 返回 `CONN_NOT_FOUND`/`CONN_CLOSED`

## Comments
- 2026-10-30: resolved on `feature/mongodb`. Verified by test/mongo.integration.test.ts: open/find/EJSON $oid/$date, SQL tools UNSUPPORTED.
