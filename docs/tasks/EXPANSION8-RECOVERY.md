# EXPANSION8-RECOVERY — IN_PROGRESS / LOCAL_ONLY

2026-10-31 Asia/Shanghai。唯一负责人 /root/expansion_recovery。基线6459422f8e2a0bc134aeca3f7acefae1be94e824，worktree /workspace/scratch/6da762100066/scb-expansion-recovery，分支 work/expansion-recovery，开工干净；origin xyq-dev/small-city-basketball。已读AGENTS/CURRENT_STATUS/TASKS/EXPANSION8/COLLABORATION。沿用父卡授权；不执行DB、迁移、外部服务或生产动作。

独占 scripts/expansion-recovery-check.mjs 和新专属测试/声明、scripts/check-database-restart.mjs仅新模块接线；E03/E08 owner分别独占 scripts/expansion-e03-recovery.mjs / scripts/expansion-e08-recovery.mjs，root已批准。其他旧验收、ops/quarantine、manifest、业务代码不修改。

设计：独立新增业务source/users，不触碰旧C23 partial固定revision等样本。调用真实服务/受控synthetic provider生成直播generation/停止UNKNOWN/媒体作业、保险预审/保单历史、真实收费/退款/分账/回退、微信授权/消息outbox、注销请求/墓碑、青年预同意/用途双确认。新表全部非空（配置扫描单例注明migration-seeded），captured只保留ID和SQL摘要。restart/原样dump restore先全表精确fingerprint，再读业务证明；quarantine比较不可变identity/hash，明确授权撤回而观测和资金claims保留，重启永久marker禁止外发。不以mock外部响应称真实投保/微信/推流成功。

检查点0：读恢复脚本接口与新DDL，建立独立worktree；尚未新增验收代码或执行数据库。发现E05默认scheduler可能改变fingerprint，已告root配置验收时关闭后台worker；本地check实例显式autoDispatch=false，专项controlled drain仍执行。E04预告新增trade_settlement_returns，最终新增表将按实际DDL自动核对，不写死数量。

检查点1（2026-10-31 Asia/Shanghai）：已写严格隔离目标检查、按实际036—041 DDL的48表精确库存/非空bigint-safe摘要，以及E01真实服务开播/录像/转码/未知停流和E07真实六域hooks注销/取消/延期样本源码。E03专属helper已由owner交root；E08/E05协作helper与E04恢复链尚待，主restart尚未接线，不能执行完整capture。新增MP4本地字节hash验证仅临时合成文件，DB归档不含媒体卷，root已另写运维边界。未执行任何数据库。
