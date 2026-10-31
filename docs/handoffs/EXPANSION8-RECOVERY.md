# EXPANSION8-RECOVERY恢复点

基线6459422，所有036—041尚未执行。任务与路径见../tasks/EXPANSION8-RECOVERY.md。
下一条：实现scripts/expansion-recovery-check.mjs 的严格隔离前置、DDL库存、ID/hash快照接口，复用真实服务构造新域样本；接父check脚本capture/verify/freeze/quarantine，保留旧检查与完整manifest指纹。E03/E08专属helper由对应owner编写。不能提前声称PG或恢复通过。

检查点1（2026-10-31 Asia/Shanghai）：已写严格隔离目标检查、按实际036—041 DDL的48表精确库存/非空bigint-safe摘要，以及E01真实服务开播/录像/转码/未知停流和E07真实六域hooks注销/取消/延期样本源码。E03专属helper已由owner交root；E08/E05协作helper与E04恢复链尚待，主restart尚未接线，不能执行完整capture。新增MP4本地字节hash验证仅临时合成文件，DB归档不含媒体卷，root已另写运维边界。未执行任何数据库。

检查点2（2026-10-31 Asia/Shanghai）：最终接线源码已完成，覆盖E01/E02真实注册/排程/记分/确认、受控MP4录像/转码/校准自动集锦与未知停止，E03/E05/E08由对应owner专属helper交付，E04十表实际资金状态机和300分UNKNOWN退款预留，E07三种注销状态。共48张新表；normal restart/restore逐表摘要exact，quarantine逐来源身份证据/历史摘要留存并撤权，新追加青年WITHDRAW history允许增加但不得丢行，旧completion counts仍exact。

验证：API build、全部helper无副作用import、5静态/隔离目标测试、node语法、格式/空白通过；无数据库执行。父CI基础链已开始，首次有效PG发现037缺UNIQUE外键，事务整体回滚，root正按现有三列entries键修复；不要回改任何成功提交后迁移。下一：root只cherry最终源码片（中间merge00b1da5不另取），开启完整CI并逐失败修复。数据库备份不含MP4文件；本样本字节校验与metadata/fencing证明不能表述为媒体文件灾备。
