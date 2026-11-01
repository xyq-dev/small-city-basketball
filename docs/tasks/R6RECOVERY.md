# R6RECOVERY：六项功能隔离恢复验收

状态：IN_PROGRESS / LOCAL_ONLY。2026-11-01；root委派给 `/root/implement_map`。工作目录 `/workspace/scratch/aad368826b09/scb-six-map`；分支 `work/r6-map`；来源基线为root整合的043–048代码，只读核验后在独立checkout实施。运行目标仅现有隔离CI/compose恢复流程；没有生产数据库或外部供应商权限。

负责 `scripts/r6-recovery-check.mjs`、离线测试、`scripts/check-database-restart.mjs`接线、保险旧fixture准入兼容与 `ops/recovery/quarantine.mjs`。root明确授权共享文件唯一ownership，不改root正在维护的privilege manifest/CI入口/迁移；其他实施者分别提供matching/training/sponsor/dispatch新fixture脚本。

当前实现：043–048的44张新表显式inventory及非空数据断言，迁移校验值、列/约束/索引/trigger/function定义hash、全量行hash，隔离只允许明确撤权字段变更。原036–042全部非空业务验收保留；R6新增canonical trade记录后重新冻结其完整基线。接入现有capture/restart/freeze/quarantine，无新增生产命令。

保险夹具配置明确合成admission并建立第二个真实quote/order/receipt，故障注入持久UNKNOWN APPLY（12次预算边界）触发reconciliation；不发外部投保，不宣称供应商接受。其他模块用真实源预约和统一财务链，合成供应商响应仅用于恢复验收。恢复隔离撤回许可、暂停任务、释放资源，原报价、来源、UNKNOWN、退款/分成/追回事实不清零或改为成功。

已执行：new recovery/legacy expansion离线11项通过；新主脚本、restart接线、保险fixture和quarantine均语法检查通过，Prettier格式完成。本地没有Docker/psql，真实PG capture/restore/runtime ACL未执行，必须由root隔离CI运行。没有将空表或单元模拟当成完整恢复通过。
