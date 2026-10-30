# 06: PostgreSQL Driver（完整接口 + docker smoke）

**What to build:** 把 `Driver` 接口落到真实 PostgreSQL，并建立可复用的 driver conformance 测试骨架（供 07/08 复用）。

**Blocked by:** 03 (只读/写路径)、04 (内省)、05 (注册表池化)

**Status:** ready-for-agent

- [ ] `postgres://` DSN 可连接，`kind:"postgres"`，返回 `server_version`
- [ ] 通过对外工具可完成 query / execute / introspect / close 全链路
- [ ] 建立共享的 driver conformance 测试骨架，PG 全部通过
- [ ] docker-compose 起 PG，`open→query→close` 冒烟通过
- [ ] 只读连接与错误码契约在 PG 上同样成立
