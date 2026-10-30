# 03: mongo_aggregate + 只读管道门禁

**What to build:** 执行 aggregate pipeline；只读连接上拒绝写阶段与 JS 执行；pipeline 必须是数组；结果受上限约束。

**Blocked by:** 02 (Mongo 连通 + mongo_find)

**Status:** resolved

- [x] `mongo_aggregate` 执行 `$match/$group/$lookup` 等只读阶段并返回文档
- [x] 只读连接上含 `$out`/`$merge` 的 pipeline 返回 `READ_ONLY_VIOLATION`
- [x] 任意连接上含 `$where`/`$function`/`$accumulator` 返回 `UNSUPPORTED`
- [x] pipeline 非数组返回 `SQL_ERROR`
- [x] 结果超限返回 `truncated:true`

## Comments
- 2026-10-30: resolved on `feature/mongodb`. Verified by test/mongo.integration.test.ts: aggregate + $out READ_ONLY_VIOLATION + $where UNSUPPORTED; test/mongo-guard.test.ts.
