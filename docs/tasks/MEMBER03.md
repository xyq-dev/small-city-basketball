# MEMBER03 · 免费试排、按届首发与暖金原生UI

2026-11-11（Asia/Shanghai）。

| 字段 | 当前记录 |
| --- | --- |
| 产品/文档集成人 | 本轮Codex；仅本次文档与Figma交付 |
| 业务实施负责人 | Cursor，2026-11-11 已在本地独立分支认领 |
| 业务状态 | IN_PROGRESS；不能标 DONE |
| 文档integration | 本次文档提交同步main；最终SHA由Git日志核验 |
| 代码integration | 无本轮业务代码提交；实施待开始 |
| 发布前核验基线 | 开工 fetch 后 origin/main `ec69f87541d8b2825ca2ca4dce69f74aaaf1c266` |
| 执行环境 | 通过GitHub API同步文档；本会话scratch仅存文档工作副本，无业务Git checkout，不能声称本地分支/dirty已核验 |
| Figma | 原文件QpKOskViUwHFVqSG3uYR9X，同页新增暖金V4；旧V3保留 |

## 目标与第一条操作

Cursor开工先fetch并核验真实仓库/工作目录/分支/HEAD/dirty，读取AGENTS和本卡，确认无重复认领后建立独立任务分支，建议`feat/member03-trial-per-event`，名称执行前核验。

实施 [产品PRD V2](../design/MEMBER03_PRODUCT_REQUIREMENTS.md)，按 [Figma V4交接](../design/MEMBER03_FIGMA_HANDOFF.md) 原生还原，完整执行 [Cursor指令](../agent-prompts/cursor/MEMBER03_IMPLEMENT.md)。详情/验证及接续见 [handoff](../handoffs/MEMBER03.md)。

## 业务范围

免费完整试排、按用户/可选机构隔离的设备草稿、冲突与恢复、真实转正式资料核对、99/149建议按届首发、真实可售方案和原单、原首次正式发布激活、暖金原生页面与截图验收。

报名准备沿既有免费流程；正式排赛仍需关闭报名与冻结。试排不能放宽该守卫，也不能把示例队名变成真实参赛事实。周期会员延期推广但已有权益/订单/接口保留。实际金额与资格由服务器决定，不发布生产新价格。

## 允许/禁止路径与权限

允许实施路径：`apps/wechat`中本任务独立页面、局部组件/素材、必要入口、`utils/api.js`/`utils/ui.js`精确映射；直接相关测试/fixtures与文档；必要的局部纯排赛计算复用。

共享路径需核验负责人后串行：app.json、API白名单、共享排赛计算、contracts、正式排赛/商业后端。不得覆盖`pages/memberships`（球队成员关系）、他人未提交改动，或顺带重做TMX。

本轮文档上传已获授权。业务实现与本地验证可进行；业务commit/push/PR/merge/pack/部署及Migration执行没有由本轮新增授权。不能将历史AGENTS授权、文档上传或“实现”自动扩为本批业务发布。生产数据、正式改价、真实资金、外部付费资源/凭据与公网操作禁止擅自执行。

新增后端预览API、权限契约、数据结构或正式金融/激活行为若确需变更，先提供具体差异、兼容与测试计划，由Codex审查；其他独立UI继续。最终复杂排赛/金融代码必须Review。

## 实施切片

1. 核验真实能力与合同，登记“快速试排/正式冻结/转正式/支付渠道”的差异；认领。
2. 暖金V4原生UI与隔离试排、设备保存、状态与恢复。
3. 真实赛事/机构、按届方案/订单与原采购/激活复用；保持安全与旧权益。
4. 直接回归、必要真实隔离PG/HTTP、原生同尺寸截图对照与Codex Review。

发现缺自助建空间/合适可售方案/真实商户时，分别记录转化或上线阻塞，不伪造成功；不影响独立切片的继续。

## 本轮文档与设计交付事实

- 已核验main与相关源文档/正式排赛收费边界，检查无现存MEMBER03认领。
- 已完成PRD、设计映射、实施指令与任务/交接；只读独立复核无阻断，并补清无机构用户也可登录试排保存。
- 暖金V4已补免费入口、两档按届、试排输入/结果、转正式核对、两档核对和订单；可编辑图层、独立素材；已做设计截图检查。
- 应用测试、微信运行截图、真实采购/资金及生产验证均未在本轮执行。
- 本轮未编写/执行Migration、未改业务代码、未部署或发布正式价格。

## 后续验收

按PRD AC01—AC09逐项填写实际证据。至少微信测试/typecheck、试排与隔离针对性检查、真实可售/权益/原单验证；触及后端时补隔离数据库及并发/退款回归。截图主390×844及320/360/430，缺工具不得写通过。完成度按UI/隔离体验/真实API/真实商户/生产分列。

## 2026-11-11 Cursor 认领

- 目录：`D:\Projects\scb-worktrees\member03-trial`。分支 `feat/member03-trial-per-event`，HEAD `ec69f87541d8b2825ca2ca4dce69f74aaaf1c266`，跟踪 origin/main。日常目录 `D:\Projects\small-city-basketball` 仍为 `fix/login-password-compatibility` / `53ac926`，登录兼容改动未动。旧暖金 V3 工作区未切换、未覆盖。
- 首屏改为 V4 两档按届和免费试排，不再实现 VIP/SVIP 月年销售首屏。
- 未 commit、未 push、未 pack、未部署、未执行 Migration、未发布正式价格。
- 微信原生截图未完成：开发者工具启动超时。不能把设计参考图写成运行对照。

## 2026-11-11 Cursor 续作检查点

目录、分支和 HEAD 与认领时相同。日常目录仍是 `fix/login-password-compatibility` / `53ac92640e3dc1e11c5022e81ac0f6ba7f1980d3`，其未提交登录改动未动。临时干净基线工作树已删除。未 commit、push、merge、pack、部署、执行 Migration 或发布正式价格。

无机构用户：已登录账号没有自助创建或加入办赛机构的接口。`POST /v1/auth/register` 会新建账号并授予 `ORG_OWNER`，生产默认关闭，小程序也没有放行。本页不调用它，也不静默建机构。试排仍按用户保存在当前设备；已有机构时，无机构草稿可以回读。转正式只打开现有的球队邀请和机构建队入口，并写明这不会获得采购权限。若以后要让已登录用户进入办赛空间，需要由现有 `ORG_OWNER` 接受的明确申请，不能由客户端指定角色。

循环对阵只保留 `apps/wechat/utils/circle-pairing.js`。正式排赛和试排都调用它。`scheduling-domain.test.ts` 49 项通过，已知 3 队向量的 pairingHash 仍是 `92741a54…2c6b`。

验证：`@small-city-basketball/api` typecheck 通过。`event-service.test.cjs` 6 项通过。`devtools-ui.test.mjs` 17 项通过。干净 `ec69f87` 上复现两项既有失败：Node v23.9.0 win32 x64，`chevron-left-inverse.svg` 原始长度 216，期望 213；`symlinkSync` 返回 `EPERM`。没有改测试期望。

隔离 HTTP：本机 5432/55432 起初没有监听。已用现有 `D:\Projects\scb-isolated-pg\start.mjs` 在 127.0.0.1:55432 起临时库，测试自己创建并删除 `scb_test_*`。`member03-event-service.test.mjs` 1 项通过。核对页不下单；重复点击只有一笔；超时后重进复用原 commandId，仍是一笔订单；409 后重新确认使用新 command 和新版本；无机构账号和机构切换都不下单；已有订单/人工确认后的权益阻止再买。页面展示隔离目录中的 99 与 299，没有提交 8 队/16 场的 14900 方案。直接调用下单接口时，该错误规模方案返回 200，因为现有 `createOrder` 不按规模拒绝；规模仍留在正式发布激活。没有改这个状态机。

视觉：订单分段和矢量勾已回到页面。开发者工具 CLI 实际报 `APPID_ERROR`：当前 `touristappid` 不被这台工具接受，自动化端口没有打开。没有 390×844 或 320/360/430 的运行截图，不能声明 1:1。仓库里没有可替换的真实测试 AppID。

UI：本地页面与夹具已接上，原生运行图未采集。试排：本地计算与正式排赛共用一份实现。真实 API：隔离 HTTP 采购链路已跑通。真实商户：未接入，没有真实资金交易。生产：未部署，99/149 不是已发布价格。

2026-11-18 接到 `38db942`：账号页只补上 `event-service` 入口，保留 main 上已有的现有密码 1–128、新密码 12–128。没有带回月费或年费页面。`scheduling-domain.test.ts` 49 项、`event-service.test.cjs` 6 项、`devtools-ui.test.mjs` 17 项通过。隔离库 `127.0.0.1:55432` 上 `member03-event-service.test.mjs` 1 项通过，错误规模方案仍是直接下单 200，没有改正式发布状态机。
