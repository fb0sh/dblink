# 01: [prefactor] Mongo 依赖与本地测试环境

**What to build:** 为后续所有 Mongo 票准备可运行的基础设施：安装 `mongodb@^7`；`docker-compose` 增加 `mongo:7` 并通过 healthcheck；集成测试可用 `DBLINK_TEST_MONGO_DSN` 门控。不改变用户可见行为。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `mongodb` 加入依赖并可 `import`
- [x] `docker compose up -d --wait` 后 `mongo` 服务 healthy
- [x] 集成测试通过 `DBLINK_TEST_MONGO_DSN` 门控（无 DSN 时 skip）

## Comments
- 2026-10-30: resolved on `feature/mongodb`. Verified by mongodb@7 + bson installed; docker mongo:7 healthy; DBLINK_TEST_MONGO_DSN gating works.
