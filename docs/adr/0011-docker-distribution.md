# 0011. Docker 分发：单镜像双传输

- Date: 2026-11-05
- Status: Accepted

## Context

npm / `npx` 分发要求目标机安装 Node.js，且难以做到进程隔离，或以固定制品形式被其他项目复用。需要一个自包含的官方镜像：既能被 MCP 客户端以 stdio 拉起（本地、单用户），又能以 MCP Streamable HTTP 对外提供（远程、需鉴权）。直接容器化会撞上几个现实问题：容器内默认 bind `127.0.0.1` 对外不可达；HTTP 若无鉴权即等于开放一个可连任意 DSN 的内网跳板；镜像缺少让编排/运维判断存活的健康检查；默认 stdio 的容器若用固定 HTTP 探测会被误判为不健康。

## Decision

- **单镜像双传输**：默认以 stdio 运行（`docker run -i --rm dblink:local`）；`docker run ... dblink:local serve` 切换为 MCP Streamable HTTP。镜像标签 `dblink:local`，仅构建 `linux/amd64`。
- **容器绑定**：镜像内置 `DBLINK_BIND=0.0.0.0`、`DBLINK_PORT=7331`，端口映射后即可访问；这与裸机默认 `127.0.0.1` 不同。对外暴露仍保持 Bearer token **强制**（`DBLINK_HTTP_TOKEN`），缺失即拒绝启动（fail-closed），且 token 由运行时注入、**不**烘焙进镜像。
- **模式感知的 HEALTHCHECK**：端口无监听（stdio 模式）视为健康；有监听则请求 `GET /healthz` 判 200。探针端口取自 `DBLINK_PORT`，用 `--port` 覆盖端口时需同步设置 `DBLINK_PORT`，以保证探测正确。
- **最小存活探针**：新增免鉴权的 `GET /healthz`（仅返回 `{"ok":true}`，不泄露版本或配置）；除 `/healthz` 外所有路径仍走 Bearer token。这与 ADR-0006 不冲突——ADR-0006 约束的是 MCP 端点，`/healthz` 是新增的最小存活探针，不承载任何 MCP 能力或数据。
- **镜像形态**：多阶段 `node:22-alpine` 构建，构建阶段完成 TypeScript 编译，运行阶段仅装生产依赖并拷贝产物；以非 root 的 `node` 用户运行，并预建归其所有的可写 `/data` 供 SQLite 文件落盘。
- **不集成 docker-compose**：不修改仓库现有 `docker-compose.yml`（其用于 pg/mysql/redis/mongo 集成测试），需要在其它项目中自行集成该镜像。
- **CI**：新增 `docker` job 构建镜像并跑冒烟（`--version`、`serve` 下 `/healthz` 200、无 token 的 `/mcp` 401），防止 Dockerfile 静默腐坏。

## Consequences

- 目标机无需安装 Node.js，镜像可作为固定制品分发与复用。
- 容器默认绑定 `0.0.0.0` 意味着端口映射后即对外可达，凭据保护完全依赖运行时注入的 Bearer token。
- stdio 容器不会被误判为 unhealthy，`serve` 容器则接受真实 HTTP 存活检查。
- 镜像仅 `amd64`；其它架构（如 arm64）、推送镜像仓库、镜像签名、SBOM、多架构构建均不在本次范围。
- 不提供 compose 集成，使用方需在其项目中自行编排 dblink 服务。
