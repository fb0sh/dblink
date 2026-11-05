# 05: 文档、决策记录与版本

**What to build:** 把新增的 Docker 用法与设计决策写进仓库文档，并 bump 版本：README 增加 Docker 章节（stdio / serve / `/healthz` / SQLite 挂 `/data` / MCP 客户端 docker 配置示例，并说明镜像内 `DBLINK_BIND` 默认 `0.0.0.0` 与裸机不同、`--port` 需与 `DBLINK_PORT` 对齐）；GLOSSARY 增补 `transport` 词条；新增 ADR-0011 记录「单镜像双传输、容器绑定、健康检查、非 root、不集成 compose」的取舍；版本升到 `2.1.0`，`package.json` 与版本常量保持一致。

**Blocked by:** 01, 02

**Status:** resolved

- [x] README 增加 Docker 章节：stdio、serve、`/healthz`、SQLite 挂 `/data`、MCP 客户端配置示例
- [x] README 说明镜像内 `DBLINK_BIND` 默认 `0.0.0.0`（区别于裸机 `127.0.0.1`），以及 `--port` 与 `DBLINK_PORT` 的对齐要求
- [x] GLOSSARY 增补 `transport` 词条（stdio 无鉴权 / Streamable HTTP 需 Bearer token）
- [x] 新增 ADR-0011，记录单镜像双传输、容器绑定、模式感知健康检查、非 root、不集成 compose 的决策与取舍
- [x] 版本升至 `2.1.0`，`package.json` 与版本常量一致

## Comments
- 2026-11-05: resolved on `feature/docker-packaging` (commits d4b24d0 + 4121f80, merged e3811a5). README Docker section, GLOSSARY `transport`, ADR-0011 added; version 2.0.1 → 2.1.0 in package.json/package-lock/src/version.ts (test/version.test.ts green). Review fixes also added GET/HEAD wording, amd64/CI wording, and ADR-0006 `/healthz` pointer.
