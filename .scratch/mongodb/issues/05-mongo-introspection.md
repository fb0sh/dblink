# 05: Mongo 内省（list/describe）

**What to build:** 让 agent 结构化了解 collection：列出集合、查看采样文档/索引/字段。

**Blocked by:** 02 (Mongo 连通 + mongo_find)

**Status:** resolved

- [x] `mongo_list_collections(database?)` 返回 collection 名列表
- [x] `mongo_describe_collection(collection, database?)` 返回采样文档（EJSON）、索引、推断字段
- [x] 不存在的 collection 返回 `SQL_ERROR` 且带 hint
- [x] 结果受上限与错误契约约束

## Comments
- 2026-10-30: resolved on `feature/mongodb`. Verified by test/mongo.integration.test.ts: list/describe collections.
