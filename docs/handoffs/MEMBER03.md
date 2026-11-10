# MEMBER03接续 · 文档与设计已交付，Cursor待认领

2026-11-11（Asia/Shanghai）。本轮Codex完成产品需求/暖金V4及GitHub文档同步；没有启动Cursor或修改业务代码。

## 上下文

- 远端：`xyq-dev/small-city-basketball`，发布前核验main为`9550e692a4950c3fec2b4872cfaa6bc97cccff1f`。
- 当前会话通过GitHub API写文档；scratch无业务Git checkout。本地Windows目录/分支/dirty由实施者开工核验，不引用历史记录冒充当前事实。
- 文档在main的最终提交以Git日志为准；本文件不自引用一个尚未产生的提交SHA。
- 业务任务TODO，Cursor待认领；普通业务Git发布与生产权限未由本轮扩展。

## 已完成

1. [产品PRD](../design/MEMBER03_PRODUCT_REQUIREMENTS.md)：先完整试排，再按届开通；首发建议99/149，周期推广延期；免费、正式数据与权限边界明确。
2. [Figma V4实现映射](../design/MEMBER03_FIGMA_HANDOFF.md)：保留暖金视觉，新增对应产品状态和精确节点，旧V3销售内容不再作为首发依据。
3. [Cursor完整指令](../agent-prompts/cursor/MEMBER03_IMPLEMENT.md)与[任务卡](../tasks/MEMBER03.md)。
4. 更新SYSTEM/UI文档入口与DECISIONS、任务/状态汇总，保持MEMBER01/02历史实现与验收记录。

## 已发现的真实差异

- 正式排赛需要关闭报名和冻结名单；快速试排需隔离适配，不伪造正式事实。
- 报名服务当前没有商业收费守卫；首发保持报名准备免费，不临时增加付费墙。
- 首次正式发布的原事务已负责按届/周期权益核验与激活，不能另建客户端扣额。
- 当前付款为Native/线下等原渠道，不是已具备原生requestPayment；真实商户仍需专项验证。
- 专业149只是新建议，不能覆盖旧299报价、合同或已购权益。
- 登录但无机构可保存userId隔离的设备试排；转正式再选或合法创建/加入空间。无该入口时列为转化阻塞，不静默授予OWNER。

## 验证事实

已做文档术语/优先级/链接和权限边界检查、只读独立审查，以及Figma结构/字体/离散图片与设计截图检查。这不等于微信运行或业务验收。

未运行应用测试/原生截图/真实API采购或商户付款；无本轮业务代码、生产部署、正式价格发布、Migration编写或执行。源码与既有MEMBER02验收不被本轮重新宣称通过。

## 下一位的第一条操作

核验真实checkout并fetch最新main，读AGENTS→CURRENT_STATUS→TASKS→本任务卡与完整指令，认领后从独立分支实现。重点先查试排计算可复用性、草稿恢复、转正式名单映射和现有采购渠道；可独立的UI直接推进。遇共享API/schema或金融状态机差异先形成审查切片，不顺带重构。
