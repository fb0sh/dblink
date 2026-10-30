# 0002. 凭据模型：DSN 直传，不做凭据托管

- Date: 2026-10-30
- Status: Accepted

## Context

凭据可以来自两处：① agent 在 `open_connection` 时直接传 DSN；② server 端预设 `profiles`（名字 → DSN），agent 只引用名字。②更安全但需要维护配置、且每换密码都要改配置。用户明确表示"怎么方便怎么来、不需要防泄漏"。

## Decision

DSN 由 agent 每次在 `open_connection` 中直接传入。不实现 profile 存储、凭据托管或白名单。

server **自身**不得把 DSN 或密码写入自己的日志/错误输出——输出前必须对连接串中的口令打码（对齐 `rules/KEEPSECURED.md` 的要求）。"接受的泄漏面"仅指模型上下文与会话转录，不包括服务端持久化产物。

## Consequences

- 无配置负担，可连任意可达数据库。
- DSN（含密码）会进入模型上下文与会话转录——**这是已知并接受的泄漏面**，文档必须声明。
- 这使 `read_only` 只能防手滑，不构成安全边界（见 ADR-0003）。
- 由于 agent 已持有完整 DSN，任何"写操作开关"都不构成真实安全边界（agent 可绕过 MCP 直连）。
