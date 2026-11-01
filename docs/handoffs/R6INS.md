# R6INS交接

2026-11-01（Asia/Shanghai）；代码切片 `IMPLEMENTED / LOCAL_ONLY`，真实供应商接入 `BLOCKED_EXTERNAL`。

目录 `/workspace/scratch/aad368826b09/scb-six-insurance`，分支 `work/r6-insurance`，基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`。仅本地提交，root负责同步/集成；无生产操作。

完成范围见[任务卡](../tasks/R6INS.md)。关键文件：`insurance-admission.ts` 为显式准入域；`insurance-service.ts` 接原订单编排；Migration043为不可变审核证据、报价双字段外键及UNKNOWN预算工单；原生保险页加入外购/自营入口与核对态。

集成配置：现有 `createExpansionServices` 的 `...input.insurance` 已透传新增 `InsuranceOptions.admission?: InsuranceAdmission` 及 `newPurchasesEnabled?: boolean`，无需改共享文件。部署仅注入已经审批的服务端清单，不能由HTTP用户传入；清单 `sourceHash` 使用规范化 `checkInsuranceProduct` 输出的 `insuranceHash`；赛事hash使用 `insuranceEventHash({orgId,eventId,startDate,endDate,timezone,venueName})`。日期为本地整日保障，供应商小时级产品不适用，必须另行补精确时间协议后接入。修改审核内容必须使用新release ID；原release及报价快照不可改写。首次创建订单的旧release报价与新release不兼容，应重新报价。滚动发布需统一所有服务实例的准入配置/停止旧worker后再启新发布；本次没有全局热更新配置控制面。

默认未配置真实provider/审核清单时在线投保关闭并保留外购入口。`newPurchasesEnabled:false` 停止新报价、购买、首次APPLY、付款入口，但已有原单查询、退保、文档及资格核对继续。不要卸载原provider或更换加密key来停销售。`PROVIDER_HOSTED` 仅展示审核后的服务方入口，不使用API代销。敏感身份仍只在原加密报价/事实中，不写入审核manifest或核对工单。

测试：`npm exec --workspace @small-city-basketball/api -- vitest run src/insurance-admission.test.ts src/insurance-domain.test.ts src/insurance-worker.test.ts` 29/29；`node --test apps/wechat/test/e03-insurance.test.cjs` 9/9；`npm run typecheck --workspace @small-city-basketball/api`、`git diff --check`通过。真实PG测试 `apps/api/test/e03-insurance.integration.test.ts` 已补准入/证据/范围变化/工单状态，尚未执行；root/CI必须以合成隔离PG跑完整e03及迁移。SQL写入Migration043，没有改001–042或生产库。

真实接入仍缺供应商签约/销售审批/正式协议与凭据、具体HTTP签名/证书/防DNS重绑定/禁止redirect/响应与超时上限、真实回调认证、正式产品排除项与等待期核对、供应商沙箱及小额闭环。当前HTTPS公开域名准入只是配置边界，不能宣称完成上述真实驱动。既有provider-notices仍是内部HMAC唤醒契约，不可直接当成供应商验签回调。现有 `InsuranceProvider` 端口及旧编排保留，没有新造订单体系或假成功adapter。
