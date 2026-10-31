# EXPANSION8-RECOVERY恢复点

基线6459422，所有036—041尚未执行。任务与路径见../tasks/EXPANSION8-RECOVERY.md。
下一条：实现scripts/expansion-recovery-check.mjs 的严格隔离前置、DDL库存、ID/hash快照接口，复用真实服务构造新域样本；接父check脚本capture/verify/freeze/quarantine，保留旧检查与完整manifest指纹。E03/E08专属helper由对应owner编写。不能提前声称PG或恢复通过。

检查点1（2026-10-31 Asia/Shanghai）：已写严格隔离目标检查、按实际036—041 DDL的48表精确库存/非空bigint-safe摘要，以及E01真实服务开播/录像/转码/未知停流和E07真实六域hooks注销/取消/延期样本源码。E03专属helper已由owner交root；E08/E05协作helper与E04恢复链尚待，主restart尚未接线，不能执行完整capture。新增MP4本地字节hash验证仅临时合成文件，DB归档不含媒体卷，root已另写运维边界。未执行任何数据库。
