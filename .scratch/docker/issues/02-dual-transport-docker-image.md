# 02: 双传输 Docker 镜像

**What to build:** 提供自包含的官方镜像 `dblink:local`（linux/amd64），一个镜像同时支持两种 transport：默认 stdio（`docker run -i --rm` 即可作为 MCP stdio server），`serve` 子命令切到 MCP Streamable HTTP。镜像基于 `node:22-alpine` 多阶段构建，非 root `node` 用户运行，运行时只装生产依赖，预建可写 `/data` 供 SQLite 文件落盘，内置 `DBLINK_BIND=0.0.0.0` / `DBLINK_PORT=7331` 默认、暴露 7331，且不烘焙任何 token。本票不包含 HEALTHCHECK（见 03）。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `docker build` 产出 `dblink:local`（linux/amd64），基础镜像为 `node:22-alpine`
- [x] 多阶段构建；运行阶段仅生产依赖，以非 root `node` 用户运行
- [x] `/data` 存在且运行用户可写（用于 SQLite 文件连接）
- [x] 镜像内 `ENV DBLINK_BIND=0.0.0.0`、`DBLINK_PORT=7331`；未内置任何 token
- [x] 默认以 stdio 运行：`docker run -i --rm dblink:local` 可作为 stdio MCP server
- [x] `docker run … dblink:local serve` 可启动 Streamable HTTP；镜像声明 `EXPOSE 7331`
- [x] `docker run --rm dblink:local --version` 能打印版本
- [x] 收到 SIGTERM 时优雅关闭；日志只走 stderr，不污染 stdout 上的 JSON-RPC
- [x] `.dockerignore` 排除 node_modules、dist、git、测试与文档等无关内容

## Comments
- 2026-11-05: resolved on `feature/docker-packaging` (feature commit 48fe256, merged 074c998). Multi-stage `node:22-alpine`, uid 1000 `node`, writable `/data`, prod deps only (~298MB), EXPOSE 7331, ENTRYPOINT `node dist/index.js` CMD `stdio`. Verified build, `--version` 2.1.0, stdio initialize handshake, serve 401/200, graceful stop. `linux/amd64` pinned in CI during review fixes.
