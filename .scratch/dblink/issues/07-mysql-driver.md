# 07: MySQL Driver

**What to build:** 复用 06 的 conformance 骨架实现 MySQL，使 MySQL 具备与 PG 同等能力。

**Blocked by:** 06 (PostgreSQL Driver + conformance 骨架)

**Status:** ready-for-agent

- [ ] `mysql://` DSN 可连接，`kind:"mysql"`，返回 `server_version`
- [ ] 通过对外工具完成 query / execute / introspect / close 全链路
- [ ] 跑通共享 conformance 骨架
- [ ] docker-compose 起 MySQL，`open→query→close` 冒烟通过
