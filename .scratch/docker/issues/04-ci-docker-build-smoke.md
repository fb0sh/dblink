# 04: CI Docker 构建与冒烟

**What to build:** 在 CI 中新增独立的 `docker` job，保证 Dockerfile 不会静默腐坏：构建镜像 → `--version` → 启动 `serve` 容器（注入测试 token、映射端口）→ 轮询 `/healthz` 直到 200 → 断言 `/mcp` 无 token 返回 401 → 断言容器进入 `healthy` → 清理容器。可选附带一次 stdio 冒烟，覆盖两种 transport 至少各一次。

**Blocked by:** 01, 02, 03

**Status:** ready-for-agent

- [ ] CI 在 push / PR 时构建镜像
- [ ] 容器内 `--version` 执行成功
- [ ] 启动 `serve` 容器后轮询 `/healthz` 直到返回 200
- [ ] 断言 `/mcp` 在无 token 时返回 401
- [ ] 断言容器健康状态为 `healthy`
- [ ] 可选：stdio 冒烟（`--version` 或 initialize 握手）
- [ ] job 结束清理容器，失败路径不残留
