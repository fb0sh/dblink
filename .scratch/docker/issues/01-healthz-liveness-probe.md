# 01: /healthz 免鉴权存活探针

**What to build:** HTTP transport 在鉴权之前提供一个最小存活探针：`GET /healthz` 与 `HEAD /healthz` 无需 token 即返回 `200` 与 `{"ok":true}`；除它之外的所有路径与其它方法仍强制 Bearer token。以 S1 处理器单测（fake req/res）与 S2 端到端测试（真服务器 + fetch）覆盖。完成后可 `curl` 直接验证：`/healthz` 200、`/mcp` 无 token 401。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `GET /healthz` 无 `Authorization` 返回 `200`，body 为 `{"ok":true}`，不泄露版本/配置/连接数
- [x] `HEAD /healthz` 返回 `200` 且无正文
- [x] `POST /healthz`（以及其它非 GET/HEAD 方法）无 token 时返回 `401`
- [x] 其它路径（如 `/mcp`）无 token 仍返回 `401`
- [x] 带正确 token 的既有 MCP 工具调用不受影响（回归）
- [x] S1 单测与 S2 e2e 覆盖上述行为并通过

## Comments
- 2026-11-05: resolved on `feature/docker-packaging` (feature commit d676e61, merged 17e5348). `isLivenessRequest` checks exact `/healthz` path before auth; S1 + S2 tests added; `npm test` 65 passed / 18 skipped. Verified live: GET/HEAD `/healthz` 200 without token, POST `/healthz` & `/mcp` 401.
