# R6PLAYER交接

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（源码与约定隔离验收）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](../tasks/REMAINING6.md)。

## 历史实施与验证记录

以下保留各切片当时的 `LOCAL_ONLY`、`IN_PROGRESS`、测试结果、失败及修复；“当前”“待接线”等字样仅指该记录时点，不代表上方候选状态。

2026-11-01（Asia/Shanghai）；`IMPLEMENTED / LOCAL_ONLY`，代码在work/r6-insurance、基线620589d。本切片仅本地提交，由root同步。

接线：从 `matching-player-source.ts` 导入 `createMatchingPlayerSource`，传入已经接好SourceTradeHooks的现有PlayerBookingService实例；组合到MatchingSourceHooks.prepare的 `input.kind==='ADULT_PLAYER'` 分支。必须在MatchingService锁need/slot/intent之前调用prepare，之后才execute；勿另开事务、HTTP请求或提交。execute异常必须传出以回滚撮合与原单所有效果。`inspectEnded`未在此分支实现，统一财务终态适配需root组合。

接口：PLAYER sourceInput只允许 `{eligibilityConfirmed:true,reviewedSettingsVersion:number,acceptedTermsId?:string,chargeConsent?:true}`。settingsVersion须从候选不可变snapshot传入MatchingConversionInput.candidate.settingsVersion并与用户审阅值相等；matching agent已负责相应契约/UI。收费条款预览继续走现有trade preview，不能默认同意收费。profile版本与本人身份来自candidate，所有场次和球队/地址来自need；没有任意订单参数透传。

验证证据与范围见[任务卡](../tasks/R6PLAYER.md)：3组定向单测24/24、API typecheck、diff check通过；`player-booking.integration.test.ts`新增真实事务回滚/重试用例尚未运行。已有普通HTTP创建的durable 4xx、lost response、SQL/COMMIT失败、并发配额PG回归保留，root应一并执行。

没有修改trade/app/shared配置/旧迁移；没有生产调用或资金操作。本地拷贝的matching-source-adapter.ts与contracts/matching.d.ts只供校验，不属于本提交，不能将其替换掉matching agent的新实现。
