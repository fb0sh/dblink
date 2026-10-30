# 09: HTTP 传输 + Bearer Token 鉴权

**What to build:** 在 stdio 之外提供安全的远程入口：Streamable HTTP，必须带 Bearer Token，缺失即拒绝启动。

**Blocked by:** 01 (SQLite 端到端只读查询)

**Status:** resolved

- [x] `--http 7331` 启动后以 MCP Streamable HTTP 提供同一套工具
- [x] 启用 HTTP 但未配置 `DBLINK_HTTP_TOKEN` 时拒绝启动（fail-closed）
- [x] 错误或缺失 token 返回 401；正确 token 可正常调用工具
- [x] 默认 bind `127.0.0.1`；仅 `DBLINK_BIND=0.0.0.0` 时对外且启动告警
- [x] stdio 模式仍无需鉴权可正常使用
