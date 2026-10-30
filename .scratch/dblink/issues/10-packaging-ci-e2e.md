# 10: 打包、CI 与端到端验证

**What to build:** 可发布、可验证的最终形态：npm 包与 bin 可用，单测与多引擎冒烟进 CI，S1/S2/S3 测试 seam 全绿。

**Blocked by:** 02、03、04、05、06、07、08、09

**Status:** ready-for-agent

- [ ] `package.json` 含 bin，`npx dblink` 可启动（stdio）
- [ ] vitest 单测覆盖工具边界（SQLite 真库 + fake driver）
- [ ] docker-compose 提供 pg/mysql/redis，smoke 测试可跑
- [ ] CI 跑通单元测试与（可选）集成冒烟
- [ ] S1/S2/S3 三层测试全部通过，文档含只读账号的安全声明
