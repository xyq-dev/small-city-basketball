# R6SPONSOR_RUNTIME交接

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（源码与约定隔离验收）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](../tasks/REMAINING6.md)。

## 历史实施与验证记录

以下保留各切片当时的 `LOCAL_ONLY`、`IN_PROGRESS`、测试结果、失败及修复；“当前”“待接线”等字样仅指该记录时点，不代表上方候选状态。

2026-11-01（Asia/Shanghai），work/r6-insurance基线15cb738；LOCAL_ONLY，由root同步。三个源文件变更：trade-provider.ts的TradeRuntime可选sponsorCommerce仅type import；trade-runtime.ts读取SCB_R6_SPONSOR_ENABLED和原商户JSON的sponsor子字段并构造共用身份的multi client；trade-runtime.test.ts覆盖旧兼容、关闭不读keys、历史维护、严格白名单、比例/人员/收款方边界、禁止自收和重复、明确加密key轮换、禁止垫付开关。

root装配：readTradeRuntime返回的sponsorCommerce作为createApi默认广告options，显式programmatic注入仍优先；restore先抹trade/sponsor并跳过环境读取。根负责运行说明及compose开关，本提交不改app。没有sponsor字段的旧JSON继续返回旧对象形状；SCB_R6_SPONSOR_ENABLED=true要求Trade启用且有current sponsor映射。false仍保留current/historical provider，历史key沿用orgId:merchantKey。历史资金操作仍使用当前有效财务人员，保留当前sponsor允许名单，不可恢复已撤销历史财务授权。

sponsor schema：maximumSplitBps 0–10000整数；financeActorIds 2–100个不重复规范UUID；receivers最多100个机构映射，每项merchantId/displayName/authorizationVersion/expiresAt/returnsEnabled；encryptionSerial省略只允许唯一平台key，多key必须显式指定。自身机构/商户、重复收款方、非法日期、额外字段一律拒绝。parent returnsEnabled控制provider，receiver returnsEnabled控制业务授权，均不默认为true。无reserveAdvanceCoverage/ownFundsRefundSupported。

证据：runtime完整35/35（旧6+新29），连同旧settlement8项合计43/43；API typecheck、diff check通过；没有网络、真实凭据、Migration或生产操作。未跟踪复制依赖只供本地typecheck，不纳入提交。
