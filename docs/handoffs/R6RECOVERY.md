# R6RECOVERY接续

2026-11-01；IN_PROGRESS/LOCAL_ONLY。范围与证据见[任务卡](../tasks/R6RECOVERY.md)。

root须先整合模块fixture：matching `1c31da9`、training `9bb17b4`、dispatch `15a2622`、sponsor `53639cf`（以root最终SHA为准）。各脚本导出captureR6X(context)/verifyR6X({readPool,saved,quarantined})；主脚本提供registerSynthetic与createLocalSource(label,{book})；后者真实LocalServicesService.book+ACCEPT生成CONFIRMED源，book=false只建明确合成审核供给和slot。buyer独立org，provider新合成用户，源org为state.orgId；所有写入用runtimePool。

capture依次matching→training→sponsor→dispatch（真实10分钟暂占最后建立），保险UNKNOWN在原expansion保险fixture内先建立。captureR6需要context.expansion；返回snapshot及明确新增courtIds并进入旧court白名单。check-database-restart在R6完成后刷新expansion全表snapshot，保留旧scope证明。quarantine时新counts验证允许合理追加保险reconciliation，不放宽旧036–042/其他completion规则。

quarantine新增R6撤权字段与主脚本R6_QUARANTINE_FIELDS一致；matching/dispatch/training/商业fixture分别验证业务状态。现有资金隔离继续处理统一账本，不重复记账；sponsor自己的SENDING/finish SENDING/return SENDING改UNKNOWN并失效fence，其他金额/编号/审批不动。

待root真实CI验证：保险第二次实际quote/purchase和12次故障注入触发器、所有新表runtime ACL、复杂source/付款退款绑定、quarantine约束与完整pg_dump/restore。仅离线11项通过，未宣称PG/完整恢复通过。若schema新增表，inventory必须显式补齐，不得改成宽松扫描。
