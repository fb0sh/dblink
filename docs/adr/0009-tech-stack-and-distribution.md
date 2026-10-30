# 0009. 技术栈与发布形态

- Date: 2026-10-30
- Status: Accepted

## Context

需要选择一个零原生编译负担、易用 `npx` 分发的实现形态。

## Decision

- TypeScript 源码 → `tsc` 编译到 `dist/`，不使用打包器。
- npm 包名 **`@fb0sh/dblink`**（scoped，归属 fb0sh 账号，避免与已占用的 `dblink@1.4.8` 冲突），bin 名 `dblink`，通过 `npx @fb0sh/dblink` 启动。
- Node **>= 22**（本机 26；22+ 提供内置 `node:sqlite`）。
- MCP SDK：`@modelcontextprotocol/sdk`；参数校验用 `zod`。
- 传输：默认 stdio；`--http <port>`（默认 7331）开启 MCP Streamable HTTP。
- 测试：`vitest` 单元测试（SQLite 内存库覆盖 SQL 工具路径、错误码、截断、只读拦截）+ `docker-compose` 起 pg/mysql/redis 各跑一条 `open→query→close` smoke。

## Consequences

- 无原生编译依赖，安装快。
- 受限于 Node >= 22。
- CI 集成测试可选依赖 Docker。
