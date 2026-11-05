# 02: 双传输 Docker 镜像

**What to build:** 提供自包含的官方镜像 `dblink:local`（linux/amd64），一个镜像同时支持两种 transport：默认 stdio（`docker run -i --rm` 即可作为 MCP stdio server），`serve` 子命令切到 MCP Streamable HTTP。镜像基于 `node:22-alpine` 多阶段构建，非 root `node` 用户运行，运行时只装生产依赖，预建可写 `/data` 供 SQLite 文件落盘，内置 `DBLINK_BIND=0.0.0.0` / `DBLINK_PORT=7331` 默认、暴露 7331，且不烘焙任何 token。本票不包含 HEALTHCHECK（见 03）。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `docker build` 产出 `dblink:local`（linux/amd64），基础镜像为 `node:22-alpine`
- [ ] 多阶段构建；运行阶段仅生产依赖，以非 root `node` 用户运行
- [ ] `/data` 存在且运行用户可写（用于 SQLite 文件连接）
- [ ] 镜像内 `ENV DBLINK_BIND=0.0.0.0`、`DBLINK_PORT=7331`；未内置任何 token
- [ ] 默认以 stdio 运行：`docker run -i --rm dblink:local` 可作为 stdio MCP server
- [ ] `docker run … dblink:local serve` 可启动 Streamable HTTP；镜像声明 `EXPOSE 7331`
- [ ] `docker run --rm dblink:local --version` 能打印版本
- [ ] 收到 SIGTERM 时优雅关闭；日志只走 stderr，不污染 stdout 上的 JSON-RPC
- [ ] `.dockerignore` 排除 node_modules、dist、git、测试与文档等无关内容
