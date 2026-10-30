# 08: Redis Driver + redis_command 白名单

**What to build:** 非 SQL 引擎的独立工具形状：连接 Redis 并仅允许只读命令。

**Blocked by:** 05 (连接注册表池化)

**Status:** resolved

- [x] `redis://` DSN 可连接，`kind:"redis"`
- [x] `redis_command` 支持只读白名单命令（GET/SCAN/HGETALL/LRANGE 等）
- [x] 非白名单命令（如 SET/DEL/FLUSHALL）返回 `UNSUPPORTED`
- [x] `close_connection` 正常释放 Redis 连接
- [x] docker-compose 起 Redis，`open→redis_command→close` 冒烟通过
