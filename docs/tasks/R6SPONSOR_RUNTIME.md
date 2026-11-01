# R6SPONSOR_RUNTIME：广告运行配置入口

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（源码与约定隔离验收）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](REMAINING6.md)。

## 历史实施与验证记录

以下保留各切片当时的 `LOCAL_ONLY`、`IN_PROGRESS`、测试结果、失败及修复；“当前”“待接线”等字样仅指该记录时点，不代表上方候选状态。

2026-11-01（Asia/Shanghai），implement_insurance；root追加有界委派。分支work/r6-insurance，目录`/workspace/scratch/aad368826b09/scb-six-insurance`，基线15cb738；对照根118cf1c的最新SponsorCommerceOptions/TradeWechatMultiClient。状态IMPLEMENTED / LOCAL_ONLY。仅拥有trade-runtime.ts、trade-runtime.test.ts、trade-provider.ts及本任务/交接；root负责app装配、运行说明与compose开关。

TradeRuntime增加仅type import的可选sponsorCommerce。SCB_TRADE_MERCHANTS_JSON每个current/historical商户可增加sponsor对象，严格白名单：maximumSplitBps（整数0–10000）、financeActorIds（2–100个不重复规范UUID）、receivers（机构UUID到merchantId/displayName/authorizationVersion/expiresAt/returnsEnabled，最多100条）、可选encryptionSerial。禁止受益机构=本机构、商户=自身、重复机构/收款商户；收款授权时间须有效带时区ISO，过期配置保留历史可读，新业务仍由service校验期限。注册表上限不改变每合同外部收款人最多10个的业务约束。

同一商户config/key/merchantId/appId/私钥/平台key构造multi client；父merchant的returnsEnabled控制通道，receiver的returnsEnabled控制授权。只有一个平台key时可省略encryptionSerial；轮换多key必须明确选择已存在key。财务UUID只是配置允许名单，不能代替数据库机构权限及独立审批检查。

SCB_R6_SPONSOR_ENABLED严格true/false，默认false。true而trade关闭或无current sponsor映射时启动失败；双关闭不读密钥。没有sponsor映射时旧TradeRuntime返回形状不变。关闭新广告开关仍返回已配current/historical维护client，历史索引仍orgId:merchantKey；资金维护需要保留当前有效财务人员配置。未提供reserveAdvanceCoverage、ownFundsRefundSupported或外部URL覆盖。

验证：原6项runtime与新增29项共35/35通过，连同旧settlement8项合计43/43；API typecheck、diff check通过。测试使用进程内生成合成RSA材料，所有运行配置装配断言无fetch；未配置真实凭据、未发渠道请求。首次新增key轮换测试使用7位serial被原WechatPayClient正确拒绝，夹具改为合法长度后全通过，未弱化生产校验。

依赖来自根的广告service/domain/source、多方provider、contracts在自有工作树只读复制为未跟踪文件用于验证，不提交这些依赖。root下一步接input.trade.sponsorCommerce到app默认SponsorCommerceOptions，恢复隔离仍须先清空trade/sponsor且不得读取环境keys，再跑集成CI。本切片无Migration、生产、付费或外部凭据操作。

2026-11-01 root整合检查点：本卡源码已纳入feat/remaining-six及PR #35。CI152已完成该次候选的新域真实PG阶段；后续补课/广告真实退款/runtime等增量纳入下一轮，当前HEAD整套验收仍待完成。子任务上文“LOCAL_ONLY/尚未执行”保留为历史时点，当前统一依据为REMAINING6验收文档。保险真实供应商、真实商户及真机边界不因此变更。
