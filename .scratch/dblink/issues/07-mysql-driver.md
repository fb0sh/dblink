# 07: MySQL Driver

**What to build:** 复用 06 的 conformance 骨架实现 MySQL，使 MySQL 具备与 PG 同等能力。

**Blocked by:** 06 (PostgreSQL Driver + conformance 骨架)

**Status:** resolved

- [x] `mysql://` DSN 可连接，`kind:"mysql"`，返回 `server_version`
- [x] 通过对外工具完成 query / execute / introspect / close 全链路
- [x] 跑通共享 conformance 骨架
- [x] docker-compose 起 MySQL，`open→query→close` 冒烟通过

## Comments
- 2026-10-30: resolved on `feature/dblink`. Verified by docker smoke: open->query->introspect->close against mysql:8.4.
