# R6PLAYER交接

2026-11-01（Asia/Shanghai）；`IMPLEMENTED / LOCAL_ONLY`，代码在work/r6-insurance、基线620589d。本切片仅本地提交，由root同步。

接线：从 `matching-player-source.ts` 导入 `createMatchingPlayerSource`，传入已经接好SourceTradeHooks的现有PlayerBookingService实例；组合到MatchingSourceHooks.prepare的 `input.kind==='ADULT_PLAYER'` 分支。必须在MatchingService锁need/slot/intent之前调用prepare，之后才execute；勿另开事务、HTTP请求或提交。execute异常必须传出以回滚撮合与原单所有效果。`inspectEnded`未在此分支实现，统一财务终态适配需root组合。

接口：PLAYER sourceInput只允许 `{eligibilityConfirmed:true,reviewedSettingsVersion:number,acceptedTermsId?:string,chargeConsent?:true}`。settingsVersion须从候选不可变snapshot传入MatchingConversionInput.candidate.settingsVersion并与用户审阅值相等；matching agent已负责相应契约/UI。收费条款预览继续走现有trade preview，不能默认同意收费。profile版本与本人身份来自candidate，所有场次和球队/地址来自need；没有任意订单参数透传。

验证证据与范围见[任务卡](../tasks/R6PLAYER.md)：3组定向单测24/24、API typecheck、diff check通过；`player-booking.integration.test.ts`新增真实事务回滚/重试用例尚未运行。已有普通HTTP创建的durable 4xx、lost response、SQL/COMMIT失败、并发配额PG回归保留，root应一并执行。

没有修改trade/app/shared配置/旧迁移；没有生产调用或资金操作。本地拷贝的matching-source-adapter.ts与contracts/matching.d.ts只供校验，不属于本提交，不能将其替换掉matching agent的新实现。
