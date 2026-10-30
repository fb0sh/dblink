# 0003. 只读边界：以数据库账号为准，代码拦截仅 best-effort

- Date: 2026-10-30
- Status: Accepted

## Context

`read_only: true` 需要"真正"落地。可用手段：数据库只读账号、驱动只读标志、SQL 词法/解析拦截、事务内执行后 ROLLBACK。仅靠正则或 SQL 解析**不是安全边界**：CTE、`SELECT ... INTO OUTFILE`、`CALL proc()`、多语句、注释拼接均可绕过。

## Decision

- `read_only` **只在 `open_connection` 时决定**，默认 `true`；不引入 `DBLINK_ALLOW_WRITE` 之类环境变量。
- 真正的安全边界是**数据库只读账号**；文档必须强要求使用只读账号。
- 代码层的单语句限制、禁多语句、DML/DDL 词法快速失败，定位为 **best-effort 护栏**，明确标注"可被绕过"。
- 不采用"事务内执行后 ROLLBACK"方案（长事务、语义坑多）。

## Consequences

- 用户若用高权限账号连接，`read_only` 只是"防手滑"，不能防恶意或误用——文档必须写清。
- 换写权限无需改 MCP 配置，仅在 `open_connection` 传 `read_only: false`。
