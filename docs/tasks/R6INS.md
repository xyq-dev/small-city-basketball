# R6INS：保险接入准入与核对实施

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（准入与接口框架）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](REMAINING6.md)。

保险准入与接口框架已实现；真实供应商驱动、协议、凭据及真实闭环仍为 **BLOCKED_EXTERNAL**。

## 历史实施与验证记录

以下保留各切片当时的 `LOCAL_ONLY`、`IN_PROGRESS`、测试结果、失败及修复；“当前”“待接线”等字样仅指该记录时点，不代表上方候选状态。

状态：REVIEW；integration：BRANCH_ONLY。2026-11-01（Asia/Shanghai）。负责人：implement_insurance；集成人：root。

工作目录 `/workspace/scratch/aad368826b09/scb-six-insurance`，分支 `work/r6-insurance`，远端 `https://github.com/xyq-dev/small-city-basketball.git`。开工HEAD `c61ab3667c9d3f756244a28046b9ee2395ccac00`，工作区无已有修改。

依据：[供应商设计](../design/INSURANCE_PROVIDER_INTEGRATION.md)。本任务只写insurance源/契约/原生页面、Migration043、新保险测试及本任务/交接。root负责共享配置与汇总、GitHub同步；允许本地提交和定向测试，禁止生产、真实投保、外部新凭据及付费资源。

实施范围：版本化服务端供应商/产品/组织/具体赛事准入与证据快照；新投保与历史核对开关分离；UNKNOWN预算耗尽保留原操作并形成核对记录；保险页关闭/资料/核对状态及外购入口。真实供应商协议未提供，不能编写或宣称真实vendor适配完成。

计划验证：保险领域与worker单测、原生页面测试、API typecheck；编写真实PG准入/并发测试交集成人CI执行。本地未提供PostgreSQL/Docker，不声称已运行PG。Migration仅编写，生产不执行。

当前检查点：已读实际编排、provider端口、037迁移和原生保险页；正在实现准入配置与持久快照。

2026-11-01 检查点：本轮可独立实施的代码切片完成；状态 `IMPLEMENTED / LOCAL_ONLY`，真实供应商适配仍 `BLOCKED_EXTERNAL`。

- 新增严格服务端 `InsuranceAdmission`：供应商固定身份、协议版本/审核证据hash、有效期、审核后API或供应商自营模式、HTTPS公开域名清单、精确产品快照与成人年龄、当地整日保障约定、组织/具体赛事赛期场地指纹。更改任何相关范围需新审核版本，客户端不能传准入配置。
- quote出网前及保存后、purchase、首次APPLY、未付保单付款入口重验；无配置、过期、产品/赛事/组织/年龄不匹配全部关闭。未知状态仍只查询原单，12次预算耗尽保留UNKNOWN，并用数据库触发器落核对工单；原REFRESH重开同一操作，查询终态自动结案。
- 043记录不可变发布证据，报价存发布ID/hash外键；核对工单保留原单关联、限制公共数据库访问、保留争议证据。旧报价无准入来源不可新发APPLY，已发原单仍可查询、退保和取历史文件。
- 小程序保留外购保单审核入口、供应商自营入口及明确未知核对提示。新投保关闭不关闭原单维护；前端不收集保费。

已执行证据：保险3组定向Vitest 29/29；小程序保险node:test 9/9；API typecheck通过；git diff --check通过。补充真实PG集成测试覆盖准入不可改写、产品/组织/赛事拒绝且不调用driver、报价证据、报价后场地变更、未知预算工单及同操作恢复结案；本地无PostgreSQL/Docker，PG尚未运行，交root/CI。

外部剩余项：选定供应商及批准销售模式；真实签名/证书/凭据、沙箱协议、查单/退保/回调原始签名、严格DNS/redirect/响应大小和超时的实际HTTP驱动；正式条款保障证据与业务域名备案；受控小额投保/支付/出单/退保/退款验收。通用域名校验不等于真实出网隔离/供应商认证完成。此切片没有真实保单、真实付款、生产迁移或生产部署。

2026-11-01 root整合检查点：本卡源码已纳入feat/remaining-six及PR #35。CI152已完成该次候选的新域真实PG阶段；后续补课/广告真实退款/runtime等增量纳入下一轮，当前HEAD整套验收仍待完成。子任务上文“LOCAL_ONLY/尚未执行”保留为历史时点，当前统一依据为REMAINING6验收文档。保险真实供应商、真实商户及真机边界不因此变更。
