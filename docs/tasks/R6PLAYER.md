# R6PLAYER：全国撮合转原球员预约

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（源码与约定隔离验收）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](REMAINING6.md)。

## 历史实施与验证记录

以下保留各切片当时的 `LOCAL_ONLY`、`IN_PROGRESS`、测试结果、失败及修复；“当前”“待接线”等字样仅指该记录时点，不代表上方候选状态。

2026-11-01（Asia/Shanghai）。root追加委派；实现者implement_insurance。工作目录 `/workspace/scratch/aad368826b09/scb-six-insurance`，分支 `work/r6-insurance`，本切片基线620589d。范围为PlayerBookingService同事务复用、独立PLAYER源桥、对应测试；不改共享trade/app/迁移和matching主服务。

状态 `IMPLEMENTED / LOCAL_ONLY`。`prepareCreateOrder` 使用调用方事务/actor，先取得原组织日历、球队权限、买方配额、booking command、profile与settings锁并核对原可约条件，再返回execute。MatchingService可在prepare之后取得need/slot/intent锁，execute复用原订单/appearance/收费捕获代码并返回原单实际金额；失败由外层整体回滚，不留下订单、源操作收据或席位/预算效果。内部origin哈希区分普通预约命令，防止把任意预建订单认领为撮合结果。

原HTTP createOrder保留配额/命令锁在savepoint前、业务效果在savepoint内、4xx rejection收据提交后才抛 `bookingCreateOutcome:REJECTED` 的既有行为。SQL排他冲突继续转换BOOKING_TIME_CONFLICT。execute时重验当前时间，避免等待撮合行锁后创建已过期预约。

`matching-player-source.ts` 使用原候选固定profile/user/version、需求org/team/windows/address；客户端只可传明确资格确认、审阅settings版本、当前profile的收费terms ID和收费同意。settings必须等于不可变候选快照，实际金额由原订单DTO返回，不能用客户端或候选金额伪造成功。

验证：PLAYER源桥/原球员domain/service单测24/24，API typecheck与diff check通过。新增真实PG测试验证prepare不建订单、execute建原单、后续撮合失败一起回滚原单与源命令、同command可在外层回滚后安全重试、组织/球队/profile/user/时段/金额绑定。保留全部既有durable rejection PG测试。PG本地未运行，待root/CI。

依赖：matching agent的MatchingConversionInput.candidate.settingsVersion?:number及matching主服务、契约；本地仅复制该agent的接口文件用于typecheck，未纳入本切片提交。root需组合createMatchingPlayerSource(playerBookings).prepare到ADULT_PLAYER分支。财务终态inspectEnded由root统一组合；此桥没有伪造退费/完成/重开判断。

2026-11-01 root整合检查点：本卡源码已纳入feat/remaining-six及PR #35。CI152已完成该次候选的新域真实PG阶段；后续补课/广告真实退款/runtime等增量纳入下一轮，当前HEAD整套验收仍待完成。子任务上文“LOCAL_ONLY/尚未执行”保留为历史时点，当前统一依据为REMAINING6验收文档。保险真实供应商、真实商户及真机边界不因此变更。
