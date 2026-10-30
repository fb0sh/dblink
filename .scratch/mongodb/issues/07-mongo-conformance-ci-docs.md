# 07: Mongo conformance + CI + 文档收尾

**What to build:** Mongo 走与 pg/mysql/redis 一致的 conformance（open→操作→close）；CI 增加 mongo service；README/ADR-0010 与实现对齐；全量测试绿。

**Blocked by:** 02、03、04、05、06

**Status:** resolved

- [x] Mongo conformance 集成测试通过（gated by `DBLINK_TEST_MONGO_DSN`）
- [x] CI workflow 增加 `mongo:7` service 与 DSN 环境变量
- [x] README 增加 Mongo 工具表与用法
- [x] `npm run build` + `npm test` 绿，集成（pg/mysql/redis/mongo）全部通过

## Comments
- 2026-10-30: resolved on `feature/mongodb`. Verified by docker mongo:7 integration green; CI service added; README updated.
