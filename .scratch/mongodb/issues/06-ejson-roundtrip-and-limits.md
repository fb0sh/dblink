# 06: EJSON 类型保真往返 + 上限/错误码一致性

**What to build:** 写入带 `ObjectId`/`Date`/`Decimal128` 的文档再读回，类型精确保留；输入 filter 用 EJSON 能命中；Mongo 结果的上限/截断与错误码与 SQL 工具一致。

**Blocked by:** 03 (aggregate)、04 (mongo_write)

**Status:** resolved

- [x] insert 含 `ObjectId`/`Date`/`Decimal128` 的文档后，`mongo_find` 读回类型保真
- [x] 用 `{"_id":{"$oid":"…"}}` 作为 filter 能精确命中
- [x] 100 条 / 256KB 上限与 `truncated` 标记生效
- [x] 重复键/校验失败映射为 `SQL_ERROR`（原始信息在 message）
- [x] 30s 超时映射为 `TIMEOUT`

## Comments
- 2026-10-30: resolved on `feature/mongodb`. Verified by test/mongo.integration.test.ts: ObjectId/Date/Decimal roundtrip, EJSON filter, limits.
