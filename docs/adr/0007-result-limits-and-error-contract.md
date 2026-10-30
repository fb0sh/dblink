# 0007. 结果上限与错误契约

- Date: 2026-10-30
- Status: Accepted

## Context

agent 上下文昂贵，`SELECT *` 可能返回数万行；同时错误若只是自然语言，agent 无法程序化处理。

## Decision

- 硬上限：默认返回 **100 行**（`limit` 可调，上限 **1000**）、**256KB** 字节闸、语句超时 **30s**。
- 超限时返回 `truncated: true` 与实际返回行数，**不提供分页游标**；提示调用方用 `WHERE` / `LIMIT` 缩小范围。
- 成功：`{ ok: true, ... }`。
- 失败：`{ ok: false, error: { code, message, hint? } }`，`code` 为固定枚举：
  `CONN_NOT_FOUND` / `CONN_CLOSED` / `READ_ONLY_VIOLATION` / `SQL_ERROR` / `TIMEOUT` / `LIMIT_EXCEEDED` / `UNSUPPORTED`。
- 失败同时把 MCP `isError` 置为 `true`。

## Consequences

- 上下文消耗可控；agent 可基于 `code` 决定重试或重新 open。
- 无游标意味着大结果集只能靠 agent 改写查询来分页，简化了服务端状态管理。
