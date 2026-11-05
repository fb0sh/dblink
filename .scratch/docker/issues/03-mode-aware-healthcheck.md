# 03: 模式感知 HEALTHCHECK

**What to build:** 给镜像加一个模式感知的 `HEALTHCHECK`：先探测 `127.0.0.1:${DBLINK_PORT:-7331}`——连接被拒绝（stdio 模式，无 HTTP 监听）判健康；连接成功则请求 `GET /healthz`，仅 200 判健康。这样默认 stdio 容器不会一直 unhealthy，`serve` 容器则得到真实的 HTTP 存活检查。

**Blocked by:** 01, 02

**Status:** resolved

- [x] 镜像内置 `HEALTHCHECK`，无需使用方额外配置
- [x] `stdio` 模式（无 HTTP 监听）容器健康状态为 `healthy`
- [x] `serve` 模式下通过实际请求 `GET /healthz` 判断，非 200 或异常时转为 `unhealthy`
- [x] 探针端口跟随 `DBLINK_PORT`（默认 7331）
- [x] `docker inspect` 可观察到健康状态变化

## Comments
- 2026-11-05: resolved on `feature/docker-packaging` (feature commit 42f45b2, merged 33e799c). Probe extracted to `docker/healthcheck.mjs` during review fixes; bind-aware host (`DBLINK_BIND` unless `0.0.0.0`, else `127.0.0.1`), ECONNREFUSED→0, 200→0, else 1. Verified stdio container healthy and serve healthy/unhealthy transition; stdio branch also asserted in CI.
