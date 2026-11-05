# dblink — Docker 封装与双传输（stdio + Streamable HTTP）

- Status: ready-for-agent
- Date: 2026-11-05
- 关联 ADR：0006（传输与鉴权）、0009（技术栈与发布形态）、0011（Docker 分发，本 spec 新增）

## Problem Statement

dblink 目前只通过 npm / `npx` 分发，部署到没有 Node.js 的机器、需要进程隔离、或希望被其他项目当作固定制品复用时都不方便。运维者想要一个自包含的 Docker 镜像：既能被 MCP 客户端以 **stdio** 方式拉起（本地、单用户），又能以 **MCP Streamable HTTP** 方式对外提供（远程、需鉴权）。

直接容器化会撞上几个现实问题：容器内默认 bind `127.0.0.1` 对外不可达；HTTP 传输若没有强制的 Bearer token 就等于开放一个可连任意 DSN 的内网跳板；镜像缺少能让编排/运维判断服务是否存活的健康检查；而且默认是 stdio 的容器如果用固定 HTTP 探测会被误判为不健康。

## Solution

提供一个官方 Docker 镜像，**单镜像双传输**：

- 默认以 **stdio** 运行（`docker run -i --rm dblink:local`），供 MCP 客户端直接拉起。
- 通过 `serve` 子命令切换为 **MCP Streamable HTTP**，镜像内已把 bind 设为 `0.0.0.0`、端口设为 `7331`；HTTP 仍强制 Bearer token（`DBLINK_HTTP_TOKEN`），缺失即拒绝启动（沿用 fail-closed）。
- 新增一个**免鉴权的存活探针** `GET /healthz`（仅返回 `{"ok":true}`，不泄露版本或配置），并配合**模式感知**的 `HEALTHCHECK`：端口无监听（stdio 模式）视为健康，有监听则请求 `/healthz` 判 200。
- 以多阶段构建、非 root 用户运行、运行时只装生产依赖，并提供可写的 `/data` 便于 SQLite 文件落盘。
- 补齐 README 的 Docker 用法、新增 ADR-0011 记录本决策，并让 CI 构建镜像并跑健康检查冒烟。

## User Stories

1. 作为运维者，我想用一条 `docker build` 从仓库构建镜像，这样我无需在目标机安装 Node.js 就能运行 dblink。
2. 作为运维者，我想镜像被标记为 `dblink:local`，这样在各项目里引用时有一个稳定名字。
3. 作为运维者，我想镜像只构建 `linux/amd64`，这样构建流程简单、与当前 CI 环境一致。
4. 作为本地用户，我想用 `docker run -i --rm dblink:local` 直接以 stdio 启动，这样 MCP 客户端能通过容器标准输入输出与之通信。
5. 作为 MCP 客户端使用者，我想在客户端配置里用 `command: docker` + `run -i --rm dblink:local` 启动 dblink，这样我不需要全局安装 npm 包。
6. 作为本地用户，我想 stdio 模式不需要任何鉴权或 token，这样本地开发零配置（沿用既有设计）。
7. 作为本地用户，我想 stdio 模式下的所有日志都走 stderr，这样 stdout 只承载 JSON-RPC，不被日志污染。
8. 作为远程用户，我想用 `serve` 子命令启动 MCP Streamable HTTP，这样我能从其他机器访问同一套工具。
9. 作为远程用户，我想镜像已经把 bind 设为 `0.0.0.0`、端口设为 `7331`，这样容器端口映射后即可访问，无需额外环境变量。
10. 作为远程用户，我想在运行时通过 `-e DBLINK_HTTP_TOKEN=...` 注入 Bearer token，这样镜像里不需要内置任何凭据。
11. 作为运维者，我想在启动 `serve` 但未提供 token 时服务拒绝启动，这样不会误开无鉴权端口。
12. 作为运维者，我想 token 错误或缺失的请求返回 401，这样未授权访问被挡住。
13. 作为运维者，我想镜像内不烘焙任何默认 token，这样镜像可安全分发、不会泄密。
14. 作为运维者，我想用 `--host` / `--port` 或对应环境变量覆盖默认绑定，这样我能按部署环境调整。
15. 作为运维者，我想容器启动时对 `0.0.0.0` 的绑定仍打印安全警告，这样我意识到它已对外暴露。
16. 作为编排系统，我想 `GET /healthz` 无需 token 就返回 200 与 `{"ok":true}`，这样我能低成本探测存活。
17. 作为编排系统，我想 `/healthz` 只返回最小信息、不暴露版本号或配置，这样不增加攻击面。
18. 作为运维者，我想 `/healthz` 支持 `HEAD` 方法，这样探测工具可以只取状态码。
19. 作为运维者，我想除 `/healthz` 之外的所有路径仍需 Bearer token，这样新增探针不会放松整体鉴权。
20. 作为运维者，我想 `POST /healthz` 之类的非 GET/HEAD 请求不被当作健康检查（仍走鉴权），这样探针只做只读存活判断。
21. 作为编排系统，我想容器处于 `serve` 模式时 `HEALTHCHECK` 通过实际请求 `/healthz` 判断健康，这样服务异常能被发现。
22. 作为编排系统，我想容器处于 `stdio` 模式（无 HTTP 监听）时 `HEALTHCHECK` 判为健康，这样默认模式的容器不会一直显示 unhealthy。
23. 作为运维者，我想 `HEALTHCHECK` 探测的端口跟随 `DBLINK_PORT`，这样改端口时探针仍然正确。
24. 作为开发者，我想镜像以非 root 的 `node` 用户运行，这样降低容器内提权风险。
25. 作为开发者，我想镜像预建一个属于运行用户的可写 `/data` 目录，这样 SQLite 文件型连接可以落盘。
26. 作为开发者，我想通过挂载卷把数据持久化到 `/data`，这样容器重建后 SQLite 数据不丢。
27. 作为开发者，我想 SQLite 的 `:memory:` 模式在容器内照常可用，这样无需任何挂载即可做临时查询。
28. 作为开发者，我想运行时镜像只包含生产依赖，这样镜像更小、攻击面更小。
29. 作为开发者，我想构建阶段完成 TypeScript 编译、运行阶段只拷贝产物，这样 devDependencies 不进入最终镜像。
30. 作为开发者，我想 `docker run --rm dblink:local --version` 能打印版本，这样我能快速确认镜像内的 CLI 正常。
31. 作为开发者，我想容器内 `--help`、`--version` 不触发 SQLite 的实验性加载，这样这些轻量命令不会产生额外警告。
32. 作为运维者，我想容器收到 SIGTERM 时优雅关闭连接与 HTTP 服务器，这样 `docker stop` 能干净退出。
33. 作为运维者，我想镜像声明暴露端口 `7331`，这样 `docker run -P` 和编排工具能自动映射。
34. 作为维护者，我想 `.dockerignore` 排除 node_modules、dist、git、测试与文档等，这样构建上下文更小、镜像不含无关文件。
35. 作为维护者，我想构建使用 `package-lock.json` 做可复现安装，这样镜像依赖可确定。
36. 作为维护者，我想 CI 在 push / PR 时构建镜像，这样 Dockerfile 不会静默腐坏。
37. 作为维护者，我想 CI 构建后启动 `serve` 容器并轮询 `/healthz` 直到 200，这样验证了镜像能真正跑起来。
38. 作为维护者，我想 CI 断言 `/mcp` 在无 token 时返回 401，这样保住了鉴权回归防线。
39. 作为维护者，我想 CI 顺带验证 stdio 握手或 `--version`，这样两种传输都至少有一次冒烟。
40. 作为使用者，我想 README 提供 stdio、serve、`/healthz`、SQLite 挂载与 MCP 客户端配置的 Docker 示例，这样我照着就能用。
41. 作为使用者，我想 README 说明镜像内 `DBLINK_BIND` 默认是 `0.0.0.0`（与裸机默认 `127.0.0.1` 不同），这样我不会误以为它只监听本地。
42. 作为维护者，我想用 ADR 记录「单镜像双传输、容器绑定、健康检查、非 root、不集成 compose」的取舍，这样未来读者知道为什么这么做。
43. 作为维护者，我想 GLOSSARY 增补 `transport` 词条，这样后续 issue/测试命名不漂移。
44. 作为维护者，我想版本号升到 `2.1.0`（新增 `/healthz` 属新增能力），这样发布语义清晰。
45. 作为使用者，我想本次不改动现有 `docker-compose.yml`，这样我现有的测试库编排不受影响，我可在自己项目里集成该镜像。
46. 作为 agent，我想新增的 `/healthz` 不影响既有 MCP 工具面与 `connection_id` 语义，这样工具行为保持稳定。
47. 作为运维者，我想服务日志继续对 DSN 中的口令打码（既有能力），这样容器日志不会泄露凭据。
48. 作为运维者，我想镜像在反向代理后仍可通过 `/healthz` 做存活探测，这样我能接入现有网关。

## Implementation Decisions

**模块**

- 新增容器打包制品：多阶段 `Dockerfile` 与 `.dockerignore`；不新增任何运行时 npm 依赖。
- 修改 **HTTP transport 处理器**（`server-http` 模块）：在鉴权之前增加一个只读存活分支。
- 修改 **CI 工作流**：新增一个独立的 `docker` job。
- 修改 **README、GLOSSARY、ADR 目录**，并 bump 版本（`package.json` 与版本常量）。

**镜像与构建**

- 基础镜像 `node:22-alpine`（与 `engines >= 22` 及 CI 的 Node 22 对齐；已实测其内置 `node:sqlite` 可用，仅在 stderr 打印 experimental 警告）。
- 多阶段：构建阶段安装全部依赖并执行 TypeScript 编译；运行阶段仅安装生产依赖并拷贝编译产物。
- 运行时用户为非 root 的 `node`；预建归其所有的可写 `/data` 目录（不强制声明 `VOLUME`，由使用方按需挂载）。
- 入口为 `node dist/index.js`，默认命令为 `stdio`；`docker run image serve` 覆盖为 HTTP 模式；`--version` 等参数透传。
- 镜像内环境默认值：`DBLINK_BIND=0.0.0.0`、`DBLINK_PORT=7331`、`NODE_ENV=production`；**不**烘焙任何 token。
- 声明 `EXPOSE 7331`；镜像标签 `dblink:local`；目标平台仅 `linux/amd64`。

**健康检查端点**

- `GET /healthz` 与 `HEAD /healthz` 免鉴权，返回 `200` 与 `{"ok":true}`；`HEAD` 不返回正文。
- 路径匹配仅针对精确 `/healthz`（允许带查询串时按路径部分匹配），其它方法或其它路径一律继续走 Bearer token 校验。
- `/healthz` 不返回版本、配置、连接数等任何内部信息。
- 这与 ADR-0006 的「HTTP 必须 Bearer token」并非冲突：ADR-0006 约束的是 MCP 端点；`/healthz` 是新增的最小存活探针，不承载任何 MCP 能力或数据。

**HEALTHCHECK 语义**

- 探针先尝试连接 `127.0.0.1:${DBLINK_PORT:-7331}`：
  - 连接被拒绝（无 HTTP 监听，即 stdio 模式）→ 退出码 0（健康）。
  - 连接成功 → 请求 `GET /healthz`，仅当状态码为 `200` 时退出码 0。
- 因此默认 stdio 容器不会被误判为 unhealthy；`serve` 容器则接受真实 HTTP 存活检查。
- 若使用方用 `--port` 覆盖了非默认端口，需让 `DBLINK_PORT` 与之一致，以保证探针探测正确（README 记录此约束）。

**CI**

- 新增 `docker` job：构建镜像 → 运行 `--version` → 启动 `serve` 容器（注入测试 token、映射端口）→ 轮询 `/healthz` 直到 200 → 断言无 token 访问 `/mcp` 返回 401 → 清理容器。
- 可选附带一次 stdio 冒烟（`--version` 或 initialize 握手）以覆盖两种传输。

**其它**

- 版本 `2.0.1 → 2.1.0`。
- 新增 ADR-0011（Docker 分发：单镜像双传输、容器绑定、健康检查、非 root、不集成 compose）。
- GLOSSARY 增补 `transport` 词条：MCP 传输通道——stdio（本地、无鉴权）与 Streamable HTTP（远程、Bearer token）。
- 不修改 `docker-compose.yml`（使用方在其它项目自行集成）。

## Testing Decisions

**什么是好测试**：只验证外部可观察行为，不测内部实现。对 HTTP 探针，断言「请求方法 + 路径 + 有无 token → 状态码 / 响应体」；对镜像，断言「容器起得来、`/healthz` 通、无 token 的 `/mcp` 被拒」。不 mock 私有函数。

**采用的 seam（已与用户确认 S1 + S2 + S3）**

- **S1 — HTTP 处理器单测（最高、无 socket）**：复用现有「以 fake `req`/`res` 直接调用 HTTP 处理器」的 seam。覆盖：`GET /healthz` 无 token 返回 200 且 body 为 `{"ok":true}`；`HEAD /healthz` 返回 200；`POST /healthz` 无 token 返回 401；其它路径（如 `/mcp`）无 token 仍 401。
- **S2 — HTTP 传输端到端（真服务器 + fetch）**：复用现有「启动 `serveHttp` 真服务器、用 `fetch` 断言」的 seam。覆盖：活服务器上 `/healthz` 无 token 200；`/mcp` 无 token 401；带正确 token 的工具调用仍正常（回归）。
- **S3 — 镜像级冒烟（CI，新增）**：这是唯一验证 Dockerfile 本身的地方（单元测试无法覆盖镜像构建）。在 CI 构建镜像并起容器，断言 `--version`、`serve` 下 `/healthz` 200、`/mcp` 无 token 401；可选 stdio 冒烟。

**Prior art**：`server-http` 的处理器单测与「09 — HTTP transport auth」的端到端鉴权测试即是同类写法；本次沿用同一风格扩展，不引入新测试框架。

## Out of Scope

- 修改现有 `docker-compose.yml` 或为其新增 dblink 服务（使用方在其它项目集成）。
- 推送镜像到镜像仓库、镜像签名、SBOM、多架构（amd64 + arm64）构建。
- TLS 终止、反向代理、限流等网关职责。
- 为 stdio 增加鉴权、多租户隔离、按客户端隔离的连接注册表。
- 把 `/healthz` 扩展成 readiness / 依赖数据库连通性的深度检查。
- 改动 MCP 传输协议本身、工具面或 `connection_id` 语义。
- Kubernetes manifests / Helm chart。
- 由 alpine 迁移到 distroless 等更小基线的改造。

## Further Notes

- 已实测 `node:22-alpine`（v22.23.4）的 `node:sqlite` 无需实验开关即可用，仅向 stderr 打印 `ExperimentalWarning`；对 stdio（stdout 只走 JSON-RPC）无影响。
- `pg` / `mysql2` / `redis` / `mongodb` 均为纯 JS 驱动，alpine/musl 下无原生编译负担。
- 健康检查用 `DBLINK_PORT` 作为探测端口的来源；使用 `--port` 覆盖端口时需同步设置 `DBLINK_PORT`（README 说明）。
- 对齐仓库 KEEPLEAN / KEEPSECURED / KEEPTIDY 规则：最小改动、镜像不含明文凭据、临时构建产物留在项目内。
- 本 spec 仅描述设计与验收；实际实现需按 KEEPTRACK 另行获得授权后开始。
