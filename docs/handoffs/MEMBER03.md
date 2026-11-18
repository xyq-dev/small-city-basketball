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

核验真实 checkout 并读取本交接最新段。当前实现在 `D:\Projects\scb-worktrees\member03-trial` 的 `feat/member03-trial-per-event`，HEAD 仍是 `ec69f87541d8b2825ca2ca4dce69f74aaaf1c266`，改动未提交。

## 2026-11-11 实施检查点

已接上免费试排、当前设备草稿、转正式核对入口，以及按届方案读取和原 commerce 下单。正式排赛守卫、报名免费和首次发布扣额都没有改后端。无自助建机构页面；没有办赛空间时转正式停在说明，不创建机构、不授予负责人。

`node --test apps/wechat/test/*.test.cjs`：1626 通过，2 个既有环境失败（图标 CRLF 字节 216/213，Windows 不允许测试创建符号链接）。`event-service` 5 项通过。`prepare preserves` 通过。typecheck 未跑，因为这个新工作区没有安装根依赖。隔离数据库和真实商户都没有跑。微信截图命令退出 2，原因是“启动微信开发工具超时”；只生成了准备目录，没有运行图。

99/149 仍是建议价和视觉夹具。页面在没有对应可售方案时显示“暂无可售”。旧 299 方案不会被 149 替换。

## 2026-11-11 续作

工作区未变：`D:\Projects\scb-worktrees\member03-trial`，`feat/member03-trial-per-event`，HEAD `ec69f87541d8b2825ca2ca4dce69f74aaaf1c266`。未提交。

无机构路径只保留试排，并连接到现有邀请/建队页。没有新增建机构或授予 `ORG_OWNER` 的接口。最小后续方案：已登录用户提交申请，由现有负责人接受后写入成员关系；客户端不能传角色。这和 `POST /v1/auth/register` 不同，后者新建账号并直接成为负责人，而且生产默认关闭。

`circle-pairing.js` 是唯一循环对阵实现。API typecheck 通过，排赛向量测试 49 项通过。干净基线复现了 CRLF 图标长度 216/213 和符号链接 `EPERM`，测试期望未改。

隔离 HTTP 采购测试通过。错误规模方案不会出现在页面提交里；直接 POST 现有下单接口返回 200，规模拒绝仍在正式发布激活，本轮没有把这道检查提前到下单。付款核验使用两名合成平台操作者的人工确认，没有微信商户扣款。

原生截图仍缺。CLI 失败码是 `APPID_ERROR`，`touristappid` 不能打开自动化端口。没有运行图，不能写 1:1。

下一位先看任务卡同日续作段。不要改日常目录，不要用 5 项本地单测代替已经补上的 HTTP 证据，也不要在没有真实测试 AppID 时宣称截图完成。
