# 0008. v1 引擎范围与 Driver 扩展位

- Date: 2026-10-30
- Status: Accepted

## Context

用户要求"越多越好"，但每个引擎的认证、TLS、方言、参数绑定、类型映射都不同；Redis/MongoDB 不走 SQL，工具形状也不同。范围失控会拖垮 v1。

## Decision

- **v1 引擎**：PostgreSQL、MySQL、Redis、SQLite（SQLite 作为第 4 个引擎，主要做测试载体，使用 Node 内置 `node:sqlite`）。
- **v2**：MongoDB。
- 第一天就定义 `Driver` 接口：`connect / query / execute / introspect / close`；MongoDB 将来实现同一接口。
- 引擎类型（`kind`）由 DSN scheme 自动识别：`postgres://`、`mysql://`、`redis://`、`sqlite:`。

## Consequences

- 先用 SQL 家族 + Redis 验证连接/权限模型，再扩 Mongo。
- 非 SQL 引擎使用独立工具（见 ADR-0005），不硬塞进 `sql` 参数。
- 新增引擎只需实现 `Driver` 接口并注册，不影响既有工具。
