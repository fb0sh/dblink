# 0001. 以连接句柄为核心的 MCP 数据库访问服务

- Date: 2026-10-30
- Status: Accepted

## Context

需要一个 Node.js MCP server，让 agent 访问多种数据库。原始草案是三步：`open_connection(dsn) → connection_id`，之后用 `connection_id` 查询。替代方案是完全无状态：每次工具调用都携带 DSN。

## Decision

采用**有状态连接句柄**模型：`open_connection` 建立或复用连接池，返回不透明 `connection_id`；后续所有工具仅用 `connection_id` 操作。`connection_id` 不含库名、主机或任何凭据信息。

## Consequences

- 优点：调用方体验好，DSN 不必每次重复传输；为池化与复用提供天然抓手。
- 代价：server 必须管理连接生命周期（TTL、上限、退出时统一关闭）。
- 进程重启后 `connection_id` 全部失效，agent 需重新 `open_connection`。
