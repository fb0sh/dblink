# 04: mongo_write（insert/update/delete）+ 只读门禁

**What to build:** 在可写连接上通过 `mongo_write` 的 `action` 增/改/删 document；只读连接拒绝写入；返回影响计数。

**Blocked by:** 02 (Mongo 连通 + mongo_find)

**Status:** resolved

- [x] `action:"insert"` 插入一个或多个文档，返回 `inserted_count`/`inserted_ids`
- [x] `action:"update"` 支持 `filter/update/multi/upsert`，返回 `matched_count`/`modified_count`
- [x] `action:"delete"` 支持 `filter/multi`，返回 `deleted_count`
- [x] 只读连接调用 `mongo_write` 返回 `READ_ONLY_VIOLATION`
- [x] 非法 `action`/payload 返回 `SQL_ERROR`

## Comments
- 2026-10-30: resolved on `feature/mongodb`. Verified by test/mongo.integration.test.ts: insert/update/delete counts + read-only gate.
