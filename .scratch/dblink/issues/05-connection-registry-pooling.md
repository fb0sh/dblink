# 05: 连接注册表——指纹去重、幂等、池化与惰性重连

**What to build:** 连接生命周期行为：同一 DSN 复用同一句柄与连接池，重复 open 幂等；连接状态可见；死连接自动恢复。

**Blocked by:** 01 (SQLite 端到端只读查询)

**Status:** ready-for-agent

- [ ] 同一 DSN（经规范化指纹）重复 `open_connection` 返回同一个 `connection_id`
- [ ] 不同 DSN 返回不同 `connection_id`
- [ ] `list_connections` 报告每个连接的 `alive`/`dead` 状态
- [ ] 池大小默认 5、空闲 15 分钟回收、单进程最多 20 池（可配置且被遵守）
- [ ] 连接被判定为 dead 时，下一次查询惰性重建并重试一次
- [ ] `connection_id` 为不透明串，不含库名/密码，任何返回体不回显 DSN
