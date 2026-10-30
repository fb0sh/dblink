# 0004. 连接注册表与池化：按 DSN 指纹去重、幂等

- Date: 2026-10-30
- Status: Accepted

## Context

agent 每次都可传 DSN，同一个 DSN 可能被重复 `open_connection`。若无脑每次新建池，会堆出僵尸连接。

## Decision

- 进程内注册表 `connection_id → { kind, dsn, pool, read_only, status }`。
- 对 DSN 计算**规范化指纹**；同一指纹重复 open **幂等返回同一个 `connection_id`**，共享底层池。
- 池大小默认 5，空闲 15 分钟回收，单进程最多 20 个池。
- **惰性重连**：查询时若池检测到连接已死，重建并重试一次，调用方无感；不做主动心跳。
- `list_connections` 报告 `alive` / `dead`。
- 进程退出时统一 `close` 所有池。

## Consequences

- 连接复用带来真实性能收益，避免重复握手与僵尸连接。
- 需实现线程/异步安全的注册表与指纹算法。
- 幂等语义要求文档说明：同一 DSN 的多次 open 返回同一 ID，`close` 会关闭共享池。
