# 0006. 传输与鉴权：stdio 无鉴权，HTTP 必须 Bearer Token

- Date: 2026-10-30
- Status: Accepted

## Context

需要同时支持 stdio（本地、单用户）与 HTTP（可能被远程访问）。HTTP 若无鉴权，任何能连端口的人都可让 server 用任意 DSN 连内网，等同开放代理 / SSRF 跳板。

## Decision

- **stdio**：不鉴权。
- **HTTP**：必须 Bearer Token，来自环境变量 `DBLINK_HTTP_TOKEN`；请求带 `Authorization: Bearer <token>`，不匹配返回 401；**HTTP 已启用但未配置 token 时拒绝启动（fail-closed）**。
- 默认 bind `127.0.0.1:7331`；`DBLINK_BIND=0.0.0.0` 需显式设置，且启动日志打印警告。
- 采用**单一全局注册表**：持有同一 token 的多个 HTTP 客户端共享 `connection_id` 空间。

## Consequences

- 本地开发零配置（stdio 直接可用）；对外部暴露需显式开启并带 token。
- 共享注册表意味着同一 token 的任何客户端可复用彼此的 `connection_id`；若未来需要隔离，应改为 per-token 注册表。
- token 为静态值，轮换需重启进程。
