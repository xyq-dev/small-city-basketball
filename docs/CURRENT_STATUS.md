# 当前状态

## 2026-11-06 INT01 最终入口复核（REVIEW / BRANCH_ONLY，尚未合并）

本节是当前最新整合状态；下方 UI005/UI006 的旧本地或草稿记录保留为历史。[PR #46](https://github.com/xyq-dev/small-city-basketball/pull/46) 保留所有来源提交，账号安全与 COS 已在 main；UI 两分支当前仍待本 PR 合并。旧候选 `cc3c944` 的 [Application checks #214](https://github.com/xyq-dev/small-city-basketball/actions/runs/42199398486) 四作业及 Windows 工具均成功，但自动审查发现撮合回复/转预约、教练本人确认、模板分组数四条真实遗漏，因此没有据此合并。

后续跨页入口复核补充恢复撮合原预约查看/重开席位/返回、监护人本人显式查看证明及青年审核工作台规则配置。修复仅涉及五页 WXML、36 项新增回归和七份新增合成布局夹具；原 JS、后端、API、权限、Migration 与生产配置不变。root 已执行完整微信源码 1333 项：1332 通过、0 失败、1 既有平台跳过，全仓格式与类型通过；新增布局控件将由新 head 完整 CI 验证。本地 Chromium 下载返回损坏归档，未执行本轮浏览器几何；不能把旧 #214 或旧本地矩阵冒充修复后的结果。详见 [任务](tasks/INT01-ALL-BRANCHES.md)、[交接](handoffs/INT01-ALL-BRANCHES.md)及[证据](evidence/INT01/README.md)。本轮无生产部署、生产 Migration、真实 COS/微信真机联调。

## 2026-11-06 COS01 腾讯云对象存储（DONE / MAIN：源码与隔离验收）

[PR #45](https://github.com/xyq-dev/small-city-basketball/pull/45)已于`2026-11-06T07:15:29Z`合入main，代码合并SHA`98f171f6135b88f7a26ec49f8d63de9fe8dcba10`，tree `1d8e93fbf6cfac64dd88c3a93828f973ccca5eec`与最终候选`a4dff06eedb5815e1cfedc48fe57361b1a527a1a`及CI测试merge-ref精确一致。私有COS可选配置、普通/幂等/分片上传、旧DB文件兼容读取、权限与Range、持久化登记和后台/CLI清理已完成。失败清理记录尝试时间并轮转，防止持续失败对象阻塞其他机构；唯一自动审查P2已修复并解决，独立复审通过。

[CI211](https://github.com/xyq-dev/small-city-basketball/actions/runs/42175621742)的admin/api/production/account-security四作业全部SUCCESS，attempt 1，已核验四份完成日志。原生PG新域143/既有620（含COS9）、原生页面→真实API21、真实API浏览器24、最小权限21、HTTPS4、实际PG重启及完整备份恢复/隔离/自有资源清理通过。API源码1374、管理端598、微信源码1196通过/1既有平台跳过、初始化CLI12通过；兼容浏览器1349通过/1335配置跳过，1335份布局/PNG已核验，不代表微信真机。合并后自动重复CI另计，不替代也不冒充上述候选验收。

当前50项Migration、223表、128函数；001—049保持main既有原文，050已编写并仅在隔离环境执行。真实COS/CAM未配置联调，生产未迁移或部署。现有8MiB/文件、128MiB/机构限额保留，直播大文件和加密本人材料不在本轮迁移范围；COS测试使用受控字节传输与合成恢复元数据，不等于云对象真实恢复。下一步按[运行手册](operations/tencent-cos.md)准备私有测试桶与受限凭据做真实联调，详见[任务](tasks/COS01.md)、[交接](handoffs/COS01.md)、[证据](evidence/COS01/README.md)。下方旧阶段数量与状态保留为历史记录。

## 2026-11-06 账号安全（DONE / MAIN：源码与隔离验收，生产未部署）

[PR #43](https://github.com/xyq-dev/small-city-basketball/pull/43)已合入main，合并SHA`becf8d38e3bc8e2c12059780ed57f52aa35f0bf0`，tree `505aaac19cf734e7c2623a4223242d726c503d60`与候选`89241947fb180ce8e857d1aee5cb94ca303a79c3`及CI测试merge-ref精确一致。首次部署自行设置OWNER密码、Web登录后本人改密及全部旧会话撤销已完成源码、独立安全复核与隔离验收。

[CI207](https://github.com/xyq-dev/small-city-basketball/actions/runs/42168301902)的account-security/admin/api/production四作业全部SUCCESS，已读取四份完成日志。新增真实HTTPS浏览器桌面/手机各1完整密码流程通过；既有真实API浏览器24项、PG新域143/旧业务611、最小权限21、原生页面→真实API21、HTTPS4、实际PG重启与完整归档恢复通过。管理端598、API源码1345、原生1196通过/1平台跳过；兼容布局1349通过/1335配置跳过，1335份布局/PNG已核验，不代表微信真机。GitHub自动Code Review于同一候选完成且无finding；独立安全审查另行完成，未冒称自动Security Review执行。

生产未由本轮部署，Migration049仅临时/CI执行。当前会话无直接Hermes/SSH执行通道；公开health/ready返回200只证明既有服务正常。服务器侧固定版本、备份恢复、升级和账号保留步骤已写入[交接](handoffs/ACCOUNT-SECURITY.md)。详见[任务](tasks/ACCOUNT-SECURITY.md)和[操作说明](operations/account-security.md)。

## 2026-11-05 UI006 微信原生前端 Figma 重建（REVIEW / LOCAL_ONLY）

用户已取消 UI005“保留旧模板并叠加样式”的路线，当前由 Codex 在本地分支 `feat/wechat-figma-rebuild` 从 `origin/main` `ef62cb1d47b3b63d9c854043f07cb5f8d6503b52` 重新实现微信原生前端。视觉唯一依据是 Figma 文件 `QpKOskViUwHFVqSG3uYR9X` 的交接、73 页面＋17 状态索引、交互组件和首页三宽画板；业务行为仍以现有需求、API 和权限契约为准。旧 UI005 分支、Draft PR #42 及 47 个本地归档文件均保留，归档已另备份到 `D:\Projects\scb-backups\wechat-figma-rebuild-baseline-20261105-202715`。

本任务从零重新计数，旧 UI005 的 73/73、17/17 或隔离矩阵结果未作为 UI006 证据。当前 73/73 注册路由已采用新原生模板和共享视觉组件并接回现有数据、导航、权限与提交语义，17/17 补充状态仍为原路由条件分支；最终源码的 73 路由与 17 状态均已在 320/390/430 逻辑宽隔离渲染，分别为 219 与 51 个视口，均无横向溢出，但这不等于逐像素微信签收。首页与“我的”已在当前微信工程取得逻辑 `390×844` 的真实状态截图，SDK 原始 PNG 为 `360×779`；其余 71 页尚未计为微信实测。最终直接回归 242/242；`npm run test:wechat` 为 1238 项、1237 通过，唯一失败是当前 Windows 权限下安全软链测试的 `symlinkSync EPERM`；`git diff --check` 通过。当前仍未 commit、push、pack、上传、部署、执行 Migration 或生产写入。详见 [UI006 任务](tasks/UI006-WECHAT-FIGMA-REBUILD.md)、[交接](handoffs/UI006-WECHAT-FIGMA-REBUILD.md)、[证据说明](evidence/ui006/README.md) 与 [覆盖矩阵](evidence/ui006/COVERAGE.md)。

## 2026-11-05 UI005 最终整合审查（DRAFT PR 候选，未合入 main）

UI005 候选分支为 `feat/ui005-figma-complete`，基线 `origin/main` / `ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`，评审入口为 [Draft PR #42](https://github.com/xyq-dev/small-city-basketball/pull/42)。73/73 注册路由与 17/17 条件状态完成原生模板的 320/390/430 隔离矩阵，1386/1386 通过；该数字现明确只作模板、布局约束与夹具状态证据，不表示 73 页全部通过逐像素或本轮高保真复审。2026-11-05 的运行差异复核已定向修复首页与“我的”，两页重新取得 390 微信首屏/底部证据和 21/21 三宽隔离结果；未重审的 71 页不外推新增视觉结论。逐项范围和证据见 [UI005 任务](tasks/UI005-REDESIGN.md)、[交接](handoffs/UI005-REDESIGN.md)、[可共享证据](evidence/ui005/README.md)及[两页修复前后](evidence/ui005/home-account-fix/README.md)。

定向修复后 Windows `npm run test:wechat` 为 1207/1208，唯一失败仍是测试搭建临时项目外 symlink 时的 `EPERM`；直接回归 141/141。旧实现 head `aa05715f41d148a872f2c82b48b8f2a79b9842a9` 的 [Application checks 42001388020](https://github.com/xyq-dev/small-city-basketball/actions/runs/42001388020) 曾三作业成功，但不能替代本次定向修复 head 的 CI；实际结果只以 PR 最新检查为准。生产地区目录与公开赛事目录 404、真实身份/业务记录、原生键盘画面继续阻塞相应运行成功态。此节只描述待评审候选，不表示已合入、可部署或生产验收；没有 pack、上传、部署、Migration 或生产写入。

## 2026-11-03 四页导航与账号双态整合（待合入 main）

本地 `ui/v3-main-nav` 的未提交界面已放到 `integrate/ui-v4-consolidate`，基线是当时的 `origin/main` `ef25846857bb0431a4f71ad8dbe6fac87f945ae0`（该提交已包含首页还原 #39 和包体 #38）。合入的是账号未登录/已登录、赛事、同城、球队，以及 `components/v3-chrome`。首页产品文件没有用旧分支覆盖。`fix/ui002-ci` 的 `fc8c2eb` 已在 main 历史上，没有重复应用。设计说明在 `docs/design/ui-v4/`；参考截图包和未引用素材包不进入仓库。正式支付、投保、分账、推流和真机仍未验收。合并提交以 GitHub 上的最终 SHA 为准，本节在合并前只记录候选。

## 2026-11-03 合并与仍开放的草稿（文档更正：#38 已合并、#39 仍 Draft）

核验时间 `2026-11-03T03:51:16Z`。当时 main 为 `9d4ccba7e3b68b720d890524d3d67cbfc071a2a1`。本节依据 GitHub API 与 Actions 日志，只更正文档里的合并和草稿事实。下方「2026-11-01 UI002 修复分支」整节，以及任务看板里同日的两节，保留为当时记录；其中「Draft 待审，不是 MAIN」「保持 Draft，不合并」不再表示当前合并状态。[UI002 交接](handoffs/UI002.md)检查点 16–20 和 [派单交接](handoffs/R6DISPATCH.md) 2026-11-02 段末的「保持 Draft」同样是合并前记录。

[PR #37](https://github.com/xyq-dev/small-city-basketball/pull/37)（`fix/ui002-ci`）已合并。`merged_at` 为 `2026-11-01T23:39:25Z`，合并提交 `717a3a7a9fbb91aa93370d6dc594c10b58bdf4c9`，双亲是 `c22fde9b82454232082716271d5a09968d3c9616` 与头提交 `fc8c2ebdefce3f61ebba77132a1880c76bffb63c`。该合并提交在 main 历史上。合入的是当时分支上的源码；真机、200 张画板逐像素，以及正式支付、投保、分账和推流，仍按下方原记录视为未启用、未验收。

[PR #36](https://github.com/xyq-dev/small-city-basketball/pull/36)（`feat/ui002-integration`）在 GitHub 上为已合并，`merged_at` 为 `2026-11-01T23:39:27Z`。它的 `merge_commit_sha` 与头提交 `813ed61f49cdf461afa9a659a365934c2308ec81` 相同。该提交是 #37 头 `fc8c2eb` 的祖先，随 #37 进入 main，GitHub 没有另给 #36 一条独立合并提交。任务卡检查点 14 里的「PR #36 仍 OPEN」不再是当前事实。

[Draft PR #39](https://github.com/xyq-dev/small-city-basketball/pull/39)（`fix/wechat-homepage`，「微信首页按素材包参考图还原」）仍是开放的 Draft，`merged_at` 为空。头提交 `205ea41e761e89457d11d3930124a27a577fd1ff`。该提交的 [Application checks](https://github.com/xyq-dev/small-city-basketball/actions/runs/41570969693) 三个作业都是 SUCCESS。admin 的 `npm test` 通过，其中 `test:wechat` 为 1193 通过、0 失败，另有 1 项 Windows 批处理桥测试跳过；`npm run test:e2e` 为 1142 通过、1128 跳过。同作业随后记录原生兼容证据 1128 份布局和 PNG，并写明不是微信运行时。api 与 production 同次通过。同提交的 [Local WeChat UI tooling](https://github.com/xyq-dev/small-city-basketball/actions/runs/41570970063) 为 SUCCESS，作业名称写明这不是微信运行时。这些结果只属于该 Draft 提交，不是 main，也不是官方微信或真机验收。空列表「同城篮球服务」碰底栏仍留在该分支的既定范围内，本文不把它记成已修复。

[PR #38](https://github.com/xyq-dev/small-city-basketball/pull/38)（`fix/wechat-preview-size`，「预览包超限及分包依赖处理」）已合并进 main。`merged_at` 为 `2026-11-03T05:26:16Z`（2026-11-03 13:26:16 Asia/Shanghai），合并提交 `e770803b1197852f4da3a66b7382a3352f49b5c1`，合并时头提交 `69d19ffd4f288ab8f0a69e37ad82a74cfc203cc1`。上文 `2026-11-03T03:51:16Z` 的核验早于这次合并，当时把 #38 写成开放 Draft 的句子由本段替换。合并前草稿提交 `59c017cb7d417ad03fb2e4f6acdfef27ff1a1e33` 的 [Application checks](https://github.com/xyq-dev/small-city-basketball/actions/runs/41379255659) 里 admin 与 production 通过，api 失败：公开观赛浏览器用例在重开步骤没有看到「尚无已确认赛果」（`tests/api-e2e/viewing.spec.ts:182`，断言在该文件第 474 行，1 failed）。同提交的 [Local WeChat UI tooling](https://github.com/xyq-dev/small-city-basketball/actions/runs/41379255669) 为 SUCCESS。这些是该草稿提交的当时记录。本文不把那次失败记成已修复。

本次只改文档。没有合并 #39，没有部署，没有生产 Migration。

## 2026-11-01 UI002 修复分支（当时记录：Draft 待审）

本节是 2026-11-01 的当时记录，当前合并状态以上一节为准。工作树 `D:\Projects\small-city-basketball-ui002-ci`、分支 `fix/ui002-ci`、审查基线 `4b83a4d`。Draft [PR #37](https://github.com/xyq-dev/small-city-basketball/pull/37) 仍指向 `main`，保持 Draft，不合并。PR #36 仍是 `feat/ui002-integration`，本记录不修改它。

2026-11-01 审查修复（本地已验证，远端 CI 尚未覆盖本修复提交）：

- 培训建班期必须由用户选择资质覆盖课次的已审教练，并提交整数课次权重；请求体能通过既有 `parseTrainingCohort`。无教练或权重不合法时不提交。
- 跨城确认前同时展示需求预算和当前报价、行程、凭据、条款。同意绑定当前账号、需求和报价；未勾选、重新打开或切到其他详情后不能沿用。写请求返回时只刷新用户仍停留的那条需求或邀请。
- 广告审核和签署前展示冻结合同的主体、金额、手续费上限、条款、时段和分成。未核对或版本变化后不能签署；签署携带当前看到的合同哈希。不展示商户内部配置，不新增出款。
- 培训签到、消费和退费成功后刷新当前课次或报名。签退使用刷新后的版本；批准后不再保留旧的待审核按钮，批准仍不等于到账。
- 比赛媒体发布在确认框返回后再次核对同意、页面、身份、版本和权限。页面隐藏或版本变化后的迟到确认不发送。撤销流程未改。

`03cdf32` 的 [Application checks](https://github.com/xyq-dev/small-city-basketball/actions/runs/41300581091) 里，admin 因培训刷新把整页卸掉而失败，api 因两条真实媒体发布没有先勾选草稿而失败。`0629009` 把调度刷新绑到打开详情时的代次，并让真实媒体测试先勾选草稿。[该次 Application checks](https://github.com/xyq-dev/small-city-basketball/actions/runs/41323996136) 中 api 与 production 通过，admin 的 `npm test` 通过，但 `test:e2e` 有 96 项原生静态布局失败：页面文案和按钮几何已改，夹具仍要求旧句子、旧照片和 12px 底栏。随后把这些夹具和几何断言改到当前页面，并让失败的旧打开请求不能整页刷新盖住后打开的需求。本机只重跑了先前失败的布局名称和调度回归，没有重跑完整 e2e 或 PostgreSQL。`a2f4592` 的四项远端检查已经通过；该结果只属于该提交。2026-11-02 继续修调度：重新打开同一需求不再取消写后刷新，接单偏好和建立需求不再因切换详情而沿用旧版本。本机调度页测试 27/27，管理端类型检查通过。完整 e2e、真实 PostgreSQL 未因这次重跑。正式支付、投保、分账发送、推流未启用。下方 REMAINING6 仍是 main 上已验收的源码事实。新提交的远端 CI 另记，不沿用 `a2f4592`。

## 2026-11-01 REMAINING6：六项功能实现（DONE / MAIN：源码与隔离验收）

2026-11-01 14:08 Asia/Shanghai（核验时间 `2026-11-01T06:08:12Z`），[PR #35](https://github.com/xyq-dev/small-city-basketball/pull/35) 已合入main，代码合并SHA `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree `e38a40da165a92f1eddc5696dcd41e7dc0e2a55a` 与CI160测试候选 `7a3f958c0440eca67d1d67e372a6e2d4c9d92440` 精确一致；双亲为 `911564f0` 和该测试候选。12条外部审查全部已解决，无新增线程。

当前73条原生路由、48项Migration、221表（新增45表）、126函数。地图视野搜索、三类撮合、跨城派单、成人短课培训及商业广告分成的源码和约定隔离验收为DONE / MAIN；保险准入与接口框架也已整合，真实供应商adapter因协议、产品、证书和凭据未提供仍为 `BLOCKED_EXTERNAL`。001—042冻结，043—048仅在隔离CI执行；未更新生产，未进行真实投保、资金、消息或正式外部渠道操作。 逐项范围见[代码与验收映射](audits/REMAINING6_ACCEPTANCE.md)、[任务](tasks/REMAINING6.md)、[接续](handoffs/REMAINING6.md)及[运行配置](operations/remaining-six-runtime.md)。

[CI160](https://github.com/xyq-dev/small-city-basketball/actions/runs/41277450597) 三个作业完整SUCCESS，root已读取全部原始日志：新域真实PG143（含培训19）、旧业务PG586、原生页面→真实HTTP21、真实API浏览器24（12+12）；admin561、API源码单测1339、原生1076通过，1项既有Windows跳过；布局1082通过，1068项按配置跳过。runtime PG21、HTTPS4、221表精确重启与完整归档恢复、业务快照/fencing、quarantine及旧私有/公开/overlay凭证失效均通过；仅清理自有资源，control卷保留。

CI149—159各阶段失败、修复与证据保留在任务和交接；旧候选的成功不替代本次最终验收。UI001的200张Figma设计稿与功能代码分别记录，现有页面不代表全部视觉稿已逐像素实现。下方旧设计卡的待开发项是交付时事实，当前进度以上述main代码基线为准；正式保险/商户/微信与真机条件仍须专项验证。文档收口基于该代码基线，不改应用、迁移或生产。

## 2026-11-01 UI001：200张可编辑UI初稿与原型（历史设计交付）

[最新版Figma](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=48-7)、[设计交付与代码差异](design/WECHAT_UI_V2.md)、[全部画板/角色/状态/68路由索引](design/UI001_SCREEN_INDEX.md)、[任务](tasks/UI001.md)、[交接](handoffs/UI001.md)。保留原127张核心稿，补充DOC006六项73张（62业务/状态、11适配），共200张；17个原型起点、765个导航，19条关键正常/失败路径逐段连线核对。设计交付时六项新增实现尚待开发，后续实现见上方 REMAINING6；正式保险/微信/商户/直播及真机未因设计完成。

本次只有Figma与Markdown，没有业务代码、合同/API、数据库、权限、Migration或生产变更。代码基线c61ab36；原ebc391e至该基线仅19份Markdown差异。预设原型未在演示浏览器逐条回放，未重跑应用CI；详细检查及未覆盖项见交付记录。

## 2026-11-01 DOC006（DONE / MAIN：历史设计交付，实现另见 REMAINING6）

已补齐真实保险适配、地图“搜索此区域”、全国撮合、跨城派单、培训招生、广告收入分成的业务与页面交互、状态、数据/API提案、实施拆包和验收标准。见[六项总设计](design/REMAINING_SIX_FEATURES.md)、[UI交接与Codex提示词](design/SUPPLEMENTAL_UI_HANDOFF.md)、[任务](tasks/DOC006.md)和[交接](handoffs/DOC006.md)。

DOC006 当时只更新 Markdown；新增代码、真实供应商/商户联调、Figma 画板、可点击原型及真机验收不在该次交付内。设计交付时基线为 68 条原生路由、42 项迁移、176 表；这些历史数量不代表本轮实现后的数量，生产未更新。UI可按新设计开始，正式外部能力仍按各专项门槛开放。

## EXPANSION8（DONE / MAIN：业务源码与隔离验收，正式外部未验）

2026-10-31 Asia/Shanghai；[PR34](https://github.com/xyq-dev/small-city-basketball/pull/34)已以merge commit `9bfc54d12188846fa6a63605606dff89b783d025`合入main，tree `73f20bdfa65192382ce8e03112ac6f08ec9a3661`与最终候选及测试merge-ref精确相同。八项持久服务、控制器、原生入口和旧业务门槛已接线：直播/云媒体、保险编排、收退款/对账/分账、订阅消息、统一搜索、注销、青年监护。[逐项代码与外部待办](audits/EXPANSION8_ACCEPTANCE.md)、[总任务](tasks/EXPANSION8.md)、[恢复入口](handoffs/EXPANSION8.md)、[使用指南](EXPANSION8_USAGE.md)、[运行边界](EXPANSION8_OPERATIONS.md)。当前68条原生路由、42项Migration、176张表（本轮49张）；001—042冻结，后续DDL从043追加，生产未执行。

最终候选120802fd2729db972020df5309100c25af11f545的[CI41189029140](https://github.com/xyq-dev/small-city-basketball/actions/runs/41189029140)三job完整SUCCESS（attempt1），root已读取全部原始日志：1158 API、561 admin、1008原生源码测试通过，1项既有Windows平台跳过；584真实业务PG＋21最小权限PG、21原生页面→真实HTTP、1067兼容浏览器/1053布局PNG、24真实API浏览器、4隔离HTTPS全部通过。176表精确指纹重启、第二PG/卷完整备份恢复、业务快照/fencing/quarantine和仅自有资源清理通过，新增49表全部有非空业务样本。此前失败及真实修复保留在检查点；合并后的自动重复CI不混作本次已通过的候选证据。

真实保险供应商未选定、实际adapter未接，购买编排默认关闭；微信支付/订阅及腾讯直播/多平台已实现受控驱动，但正式AppID、商户、模板、直播类目、外站权限和真实联调未验。没有生产更新、真实资金、真实投保、真实推流或发信。兼容浏览器不代表官方微信运行时或真机；数据库备份不含MP4字节，正式媒体卷仍须独立归档恢复。这里的DONE仅指业务源码与约定隔离验收，下方各阶段保留历史范围。

## COMPLETION22（DONE / MAIN：源码与隔离验收，生产未更新）

2026-10-31 Asia/Shanghai；本会话root集成。[PR33](https://github.com/xyq-dev/small-city-basketball/pull/33)已以merge commit `29179c0f047dde92c50d4dd7cb360d4f36eb77f5` 合入main。全部F01—F22的有界源码与消费者已整合，包括季军/双循环/异常裁定、排程/模板、招募/导入邀请/海报、专业统计/阵容/离线队列/档案、全国界面与同城预约约赛、工作人员及运营治理、赞助/经费公示和账号找回；[逐项验收](tasks/COMPLETION22.md)、[恢复入口](handoffs/COMPLETION22.md)、[使用指南](COMMERCIAL_USAGE.md)。

[CI41173913872](https://github.com/xyq-dev/small-city-basketball/actions/runs/41173913872)三job完整SUCCESS（attempt1），root已读取全部原始日志：920 API／561 admin／925小程序源码测试通过、1项既有平台跳过；520真实PG＋20最小权限PG、16页面HTTP、24真实API浏览器、4HTTPS、995兼容浏览器及981布局PNG通过。127表重启、44新增表非空业务capture、第二数据库完整恢复、业务快照/fencing/quarantine和自有清理全部通过。

本次追加修复READY裁定读取真实scoring state；新增弃权/取消→读取→独立撤回两项PG及6单测通过。账号新码取消旧unknown已有业务不变，新增过期/撤销两PG及页面VM通过。自动审查的规范finding已修并resolved：API/DATA_MODEL同步第四EventFormat及双循环/季军和新增数据契约。最终跟进58cad85仅4份Markdown，应用/迁移/测试/依赖/工作流与已检186026d完全相同；合并tree51ccf5e8323824eb5b41793def9ad32bddbc2f0d与最终PR头精确一致。规范枚举与运行时一致、70个相对文档目标及空白检查通过。

当前56条小程序源码路由、35项Migration、127表。新迁移025—035已编写并仅在隔离CI执行，生产未执行；正式微信工具/AppID/域名/隐私与真机、正式地图/邮件、真实支付/在线投保、生产部署仍待验，DOC005多平台直播仍仅设计。完整商业平台不据此称全量上线。

合并后[main自动CI41175391742](https://github.com/xyq-dev/small-city-basketball/actions/runs/41175391742)已启动，读取时in_progress；此为自动重复验收，尚无最终结果，不混作上述候选成功。下方各C/D阶段保留各自历史范围，当前事实以本节为准。

## DOC005 小程序直接开播与多平台分发（设计文档）

2026-10-31 Asia/Shanghai；负责人及集成人Codex root。用户要求手机直接在小程序采集开播，由云端合成权威比分并分发至多个已授权外站；首版单手机横屏、一场比赛、两目标验证，OBS为后续输入扩展。[专项设计](design/MINI_PROGRAM_MULTIPLATFORM_LIVE.md)、[任务](tasks/DOC005.md)、[交接](handoffs/DOC005.md)。

本轮仅11份Markdown设计与入口同步，基线main3ccb4ff；L01—L08交互、状态／权限／异常／凭据与出网／费用／录像、候选数据及API方向、分期和V01—V20待实施验收。没有直播业务代码、真实推流、付费资源、外部密钥、数据库或生产变更；现有40路由／24迁移／83表不变。官方资料检索失败，微信及外部平台账号／同播权限、供应商和费用未核实，不承诺所有平台可用；新直播不算已开发或已上线，既有C23完成状态保持。

## C23 本人报名资料与人工审核（DONE / MAIN，源码与隔离验收）

2026-10-31 Asia/Shanghai，Codex root集成。[PR32](https://github.com/xyq-dev/small-city-basketball/pull/32)已合入main `09348e39687489239ade33219dcd1cb86c742052`，完整tree与已检91fa687/实际CI merge-ref完全一致。本人资料、私有照片、已有外部保单人工审核及小程序入口已交付；独立审核与提交/批准/冻结统一复检，宣传拒绝或撤回不单独阻止参赛。旧规则不自动启用新要求。

[CI41096252199](https://github.com/xyq-dev/small-city-basketball/actions/runs/41096252199)三job全部SUCCESS且原始日志已核验：1965单测/1原平台skip，集成396（含C23的13项和旧源校验）＋隔离运行PG19，原生页面API15，兼容浏览器947、933组三宽布局及PNG，真实API浏览器24、HTTPS4，83表重启与非空密文完整归档恢复、授权隔离及自有清理通过。Migration024已在隔离CI执行，生产未执行；001–023未改。[任务](tasks/C23.md)与[交接](handoffs/C23.md)保留每段代码依据、失败与修复及接续操作。

当前40条小程序路由、24迁移、83表。专用密钥缺失/失配时新流程关闭；官方微信工具/真机、生产部署/生产Migration未执行。在线投保/真实支付、海报、邀请招募新体系、季军赛和GPS/附近服务仍待办，完整商业平台和DOC003均未全量完成。用户本轮要求先测试合并分支；2026-10-31 02:01 Asia/Shanghai最终核验[main自动CI41099428902](https://github.com/xyq-dev/small-city-basketball/actions/runs/41099428902)整体completed/SUCCESS、attempt1，admin/api/production三job全部SUCCESS。已读本次main全部三套完整日志：1965单测/1平台跳过、396集成＋PG19、页面API15、947兼容浏览器/933布局PNG、真实API浏览器24/HTTPS4、83表重启/非空密文恢复和自有清理全部通过；执行SHA09348e39687489239ade33219dcd1cb86c742052，tree与已验收候选完全相同。此前日志可下载但状态更新延迟的检查点保留在任务G.1/G.2，当前恢复点为G.3，不再待测或重复合并。没有待合并业务代码，本轮仅4份Markdown，应用/测试/依赖/ops/工作流和Migration未变。后续按实际通道做微信/真机及发布前演练；本次未操作生产。分段代码与文档同步规则见COLLABORATION，运行中最迟15分钟留检查点。

## C22 标准地区目录（DONE / MAIN，源码与隔离验收）

[PR #31](https://github.com/xyq-dev/small-city-basketball/pull/31) 已合入 `83ae15a64bce2a29566d22e3885ebb44a0772bdd`。候选 cc69330 的 [CI 41015563263](https://github.com/xyq-dev/small-city-basketball/actions/runs/41015563263) 和合并后 [CI 41017763877](https://github.com/xyq-dev/small-city-basketball/actions/runs/41017763877) 均成功。PR 最终记录：1864 单测／1 平台跳过、真实 PG 382＋19、页面 API 14、浏览器935、三宽布局921、真实 API 浏览器24及 HTTPS4；81表／23迁移重启与恢复通过。本次纠正文档滞后；详细测试数字来自 PR 验收记录，本会话已核验两次 CI 结果，未重新执行历史测试。生产、官方微信和真机仍未验收。[任务](tasks/C22.md)、[交接](handoffs/C22.md)。

## C20 手动选城与公开赛事发现（DONE / MAIN）

2026-10-30 Asia/Shanghai；Codex集成。最终代码候选 `695cac3e212cc2a4fbbcffa185dbf105fdd55aef` 的 [CI 40983327795](https://github.com/xyq-dev/small-city-basketball/actions/runs/40983327795) 三job全部SUCCESS（attempt 1），已读原始日志。[PR #29](https://github.com/xyq-dev/small-city-basketball/pull/29) 已以merge commit `9b5ce36dd907fbffab36431e7df54487ba062dc2` 合入main；合并tree `8441a65f3c5119b9a88433effe3904fe9959b00f` 与已检候选完全一致。

首页匿名公开列表、独立选城、全国切换、最多6个最近选择、设备级恢复及分页／迟到响应保护已实现，当前39条路由。后端、数据库和依赖不变。实际验收：新增23/23、目录相关48/48；源码单测1774通过／1个Windows专属跳过（Web512、API577、小程序685）。格式、类型、构建通过；真实PG365项＋隔离恢复包17项；原生页面→API14/14（含本轮选城主线）；浏览器908通过、894组兼容布局和PNG守卫通过，另一浏览器项目的重复布局按既有配置跳过；真实API浏览器24/24、隔离HTTPS4/4、78表重启和完整恢复及自有测试资源清理通过。

这仅完成DOC004的手动城市文字标签筛选及公开发现切片；行政区目录、地区ID兼容、GPS、地图与附近供给未实现。官方微信开发者工具和真机未执行；没有正式pack、部署或生产数据／权限／凭据操作。没有新增Migration，CI只在隔离数据库执行已有迁移。 合并后main自动复跑不混入上述候选结果；后续纯文档整合不改变已检业务源码。[任务](tasks/C20.md)、[交接](handoffs/C20.md)。

## DOC004 定位选城与服务发现（文档交付）

2026-10-30 Asia/Shanghai；唯一负责人及集成人：本次Codex会话。[专项要求](design/LOCATION_SERVICE_REQUIREMENTS.md)、[任务](tasks/DOC004.md)、[交接](handoffs/DOC004.md)。

- 基于远端main `601f92b33000b7a08d3db6a0bc4d9a1ccdebcb01` 补充8份Markdown：三种选城入口、按需定位、异地与分享行为、附近起点／距离、地图POI与平台库存、实际服务地点及覆盖、异常恢复与位置生命周期；含L01—L08和G01—G15待实施验收。
- 来源为实际读取的腾讯位置服务维护资料与百度地图官方文档；微信开发者原始页面等本次抓取失败的范围已单列，未宣称项目权限已开通。
- 本次是需求与文档检查，应用功能、图片、API／DATA_MODEL、Migration、凭据和生产不变；未运行应用测试、真实地图调用、官方微信或真机，也不以历史测试代表新增流程已通过。
- 后续先核对现有实现差异，交付手动选城／全国和真实公开内容，再按准入与供给条件接入定位、附近服务及预约复核。DOC003照片、保险与资格要求和既有待办保持有效。

## DOC003 办赛、球员报名与必传照片（文档交付）

2026-10-29 Asia/Shanghai；负责人及集成人：本次Codex会话。用户明确要求记录管理员8队办赛、球员本人报名与保险办理，并要求本人照片必传，用于相貌核对及宣传海报。[专项要求](design/EVENT_REGISTRATION_PHOTO_REQUIREMENTS.md)、[任务](tasks/DOC003.md)、[交接](handoffs/DOC003.md)。

- 本次同步8份Markdown：本人照片必填、私有人工核对与单独宣传授权、照片版本、海报可用素材、外部保单和在线投保、付款／出单／资格分离，及8队16场完整模板和12项待实施验收。
- 基于远端main `516a2f6752b73f6fa8d47f3ad91219ed26615a0b`；本次仅文档，新增功能未实现。身份／保险要求仍阻止当前报名开放；现有淘汰流程仍无季军赛，原有隔离测试不代表新增目标通过。
- 文档需求覆盖、173个相对文件链接、空白和冲突标记检查通过；本次只同步文档，应用、测试、依赖、API／DATA_MODEL合同、Migration、AGENTS.md和生产均未修改。官方微信、真机、真实保险、付款及部署未执行。

## DOC002 全国平台与同城服务需求同步 DONE 文档范围

更新：2026-10-29 Asia/Shanghai；负责人及集成人：本次Codex会话。范围为**文档交付**；[完整需求](NATIONWIDE_LOCAL_REQUIREMENTS.md)、[任务](tasks/DOC002.md)、[交接](handoffs/DOC002.md)。

- 将用户已提供的全国平台与同城服务方案整理为24章Markdown，更新产品、UI、商业规划、开发入口与决策；保留既有业务合同及历史证据。
- 目标导航：首页／赛事／同城／球队／我的；全国可浏览与受理机构，实际交易服务按城市供给开放。此处是新目标，不将全国化标为已实现。
- 本次基于远端 `main@a57e2e6247938dd20706dcdf08d45797b9de5313`，无本地Git checkout，通过GitHub API整合。只变更README和docs；应用子树 `766aa4b3967220d7c401fabe91be2634bc16b330` 及数据库、依赖、脚本、工作流与部署配置不变。
- 文档检查包括24章、15项验收、相对路径、空白与改动范围。没有重跑应用测试、PG、官方微信或真机；应用CI对本次文档路径不触发，不记作测试通过。
- C13—C19及其他已合并状态仍按下文记录；生产、支付、资质、定位与媒体服务的既有待办不因本次同步解除。

## C13—C19 已整合（DONE：源码与隔离验收 / MAIN）

2026-10-29 Asia/Shanghai，集成人 Codex。用户明确授权测试通过后合并。#28 → #27 → #26 → #25 → #24 → #23 → #22 已依次使用 merge commit 合入；最终业务合并为 [PR #22](https://github.com/xyq-dev/small-city-basketball/pull/22)，main 提交 `f97bb4b07e1313cd389dcb6c5ec40451f7e2cbac`。每一步完整 tree 均与已检候选 `a384896228bba35e665da22178b23a02eaf5c2bb` 相同：`6e6bc53d3d6bda71c3a684345df85206481f46ca`。所有业务分支已包含；2026-10-29 经用户授权已删除 34 条已合并分支，仅保留 main 和三条 evidence/* 历史证据分支。[清理及恢复依据](audits/MERGED_BRANCH_CLEANUP_2026-10-29.md)。

精确候选的 [CI 40673829836](https://github.com/xyq-dev/small-city-basketball/actions/runs/40673829836) 三个 job 全部 SUCCESS，attempt 1，原始日志与测试 merge ref tree 已独立核对：1750 单测通过/1 平台跳过，365+17 真实 PG、14/14 真实页面 API、887 兼容浏览器、24 真实 API 浏览器、4 HTTPS 浏览器、873 布局、78 表重启/真实归档恢复及授权隔离通过。本轮另跑小程序单测 661 通过/1 平台跳过/0 失败。合并后的 [main CI 40724292830](https://github.com/xyq-dev/small-city-basketball/actions/runs/40724292830) 现已结束，admin、api、production 三项全部 SUCCESS；执行 SHA 为 26220b8，后续只有文档变化。完整范围见 [C19 交接](handoffs/C19.md)。

38 条小程序路由、22 个 Migration、78 张表已整合到 main。官方微信工具、真机及当前 Windows 验收仍待办；生产未部署、生产 Migration/数据/权限/凭据未操作，截图交付继续暂缓。正式微信与外部服务、内部后续规划见 [交付清单](audits/MINI_PROGRAM_DELIVERY_SCOPE.md)。此前 BRANCH_ONLY、Draft 和禁止合并说明属于各历史时点，本次明确授权及实际合并结果取代其当前状态。

## 历史交付记录

## C19 阶段交付（REVIEW / BRANCH_ONLY）

2026-10-28 18:37 Asia/Shanghai，集成人 Codex。媒体原编号恢复与有界分片、机构审批建队/加入/历史认领、独立 PRIVATE_SEASON 私有赛季、赛事关注收藏已完成本轮源码与隔离验收，集中在 [Draft PR #28](https://github.com/xyq-dev/small-city-basketball/pull/28)，基于 #27。当前 22 个 Migration、78 张表、38 条小程序路由；新迁移 019–022 只在自有隔离库执行，001–018 与 AGENTS.md 未改。

业务候选 `cd506ec2b7933e5cb824f4d552acec6dbf59d4a8` 的 [CI 40670536098](https://github.com/xyq-dev/small-city-basketball/actions/runs/40670536098) 三个 job 全部 SUCCESS，attempt 1：源码单测 1750 通过/1 平台跳过，真实 PG 365+17，真实原生页面→API 14/14，兼容浏览器 887、真实 API 浏览器 24、HTTPS 浏览器 4；873 组布局（新增 39）、78 表重启/完整归档恢复、旧与新增授权隔离及自有资源清理通过。失败轮次与修复保留在交接，不拼接为一次成功。

#22—#28 仍为 Draft，未合并、未正式 pack/部署、未操作生产数据库。官方微信工具/真机与 Windows 本轮复验未执行，截图交付继续暂缓；外部支付、消息发送等及内部后续规划见 [总交付清单](audits/MINI_PROGRAM_DELIVERY_SCOPE.md)。[任务](tasks/C19.md)、[交接](handoffs/C19.md) 记录来源和接续方式。后续仅同步交付文档，业务与测试源码不变；最终文档 HEAD 与自动复跑状态以 PR 为准。以下保留历史 main / 分支记录。

当前C12：`DONE（本地验收入口） / MAIN`；原生微信截图阶段`BLOCKED`（缺少本机执行通道）。[PR20](https://github.com/xyq-dev/small-city-basketball/pull/20)已合并ace2403，最终source d74b30b4/合并tree4117a963实际核验一致，apps ca1a2328保持不变。Windows CI40222050802的14项工具检查全过；应用CI40222050821的admin/隔离production通过，API重复回归仍运行，未记作最终全绿。入口生成隔离六屏副本、原始PNG/错误与对照报告，真实业务/真机/用户签收仍待。[本机执行](WECHAT_NATIVE_UI_ACCEPTANCE.md)、[任务](tasks/C12.md)、[交接](handoffs/C12.md)。

当前C11：`DONE（六页实现/21页兼容图集） / MAIN`。用户确认的新六屏图已实现并由[PR18](https://github.com/xyq-dev/small-city-basketball/pull/18)合并ee359af；最终source1d038743与合并完整tree0bbe4984/apps ca1a2328已实际核验一致。CI40170353262三job全部SUCCESS（attempt1）：1046源码/289原生、678三宽布局+14 Web浏览器、24真实API浏览器与隔离恢复/TLS/清理通过。448实际PNG/678JSON及六屏原稿对照已整理，独立视觉/证据复核CLEAR。官方微信/真机与用户视觉签收待办；合并后重复CI不计入候选结果。[实际截图/证据](evidence/C11/README.md)、[任务](tasks/C11.md)、[交接](handoffs/C11.md)。

当前C10：`DONE（21页源码/兼容图集） / MAIN`。PR16已合并7607c28；最终候选CI40156690255三job全部SUCCESS，271原生、654三宽布局、668浏览器及完整PG/恢复检查通过；460实际界面PNG+21原稿整包已交付。合并tree与已检候选一致；合并后独立CI尚未完成，后续仅文档同步。官方微信/真机与用户视觉签收待办。[图集/来源](evidence/C10/README.md)、[任务](tasks/C10.md)、[交接](handoffs/C10.md)。

## C09 小程序视觉修正（REVIEW / BRANCH_ONLY）

2026-10-25 Asia/Shanghai；用户指出C08展示与原Figma稿不一致，视觉签收未通过。[PR16](https://github.com/xyq-dev/small-city-basketball/pull/16) source21994add（本地09d0780，同tree7bae5137）已修正首页、球员列表、比较、预约与共享排版；232VM、96新兼容布局+14Web/实际PNG/JSON守卫及定向独立复核通过。6张新截图及原稿对照见[C09证据](evidence/C09/README.md)，单独保存在证据分支evidence/c09-mini-ui-fidelity，应用代码与候选相同。完整CI40117324334最后读取仍in_progress（admin及隔离production成功、api未结束）；未合并、未发布。C08功能/几何检查不代表视觉签收，本轮也不代表微信工具/真机或全部21页/99状态逐像素验收；[任务](tasks/C09.md)、[交接](handoffs/C09.md)继续记录。

## C08 原生小程序页面实现（DONE / MAIN；微信环境验收待办）

2026-10-24 Asia/Shanghai；[PR15](https://github.com/xyq-dev/small-city-basketball/pull/15)已合并main `0d35d4608c59015a14a60926769c162cbeb5c362`。最终source `96aa0af6192202b2b381c58f718c6dd10c69cbab`与合并tree均`49b17f4d47306df7abe1c687fee75b60fa71645d`，已实际读取核验；本地业务源09a4898同tree、保留分工历史。D01/D02整合为21条原生JS/WXML/WXSS路由，覆盖球员数据与同价含费比较、5类预约/原ID恢复/逐场履约、入驻档期/双边授权、球队/本届报名/私密材料及首页/观赛/账号/平台处理。规划资金、消息和长期档案明确未启用。

[最终CI40094090818](https://github.com/xyq-dev/small-city-basketball/actions/runs/40094090818)三个job全部SUCCESS，attempt1，无重试，原始日志已核对：1046源码（Web512/API534）、225原生VM、90原生兼容布局＋14Web Mock、289真实PG＋16隔离包PG、桌面12/手机模拟12真实API，以及65表实际重启/完整恢复、TLS/旧授权隔离、正常与故意失败owned清理。真实文件守卫与下载核验90组PNG/JSON，三宽各30、PNG高844；8张代表图/哈希与全部尺寸记录已保存。独立竞态复核通过，最新source自动CodeReview completed无finding/未解决finding，3条旧线程均修复resolved；security未运行。失败轮/工具修复如实保留，不拼接为全绿。

没有后端业务、新Migration或依赖源文件变更；既有Migration仅在隔离CI测试库执行，没有生产部署/生产Migration或正式账号维护。官方微信编译、真实AppID/合法域名、Cookie/Origin、安全随机、文件/媒体和真机均未验收，不能把VM或兼容截图当作微信已运行或上线。合并后自动检查与已通过候选分开记录，最终文档HEAD按实际Git读取。详见[使用](../apps/wechat/README.md)、[任务](tasks/C08.md)、[交接](handoffs/C08.md)、[验收与预览](evidence/C08/README.md)。

## D02小程序预约UI补全（设计DONE；接续实现见C08）

2026-10-24 Asia/Shanghai；用户要求先补齐小程序前端设计，全部设计好后统一测试。已在[原Figma文件的D02导览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2400)新增10–13四个分区：99张业务/状态＋2辅助画板，另三屏预览和组件审阅板；状态数量不是独立模块数量。保留D01观赛/报名原稿。补齐选人/同价与含费比较、五种预约及各模式费用核对、领队/球员分别履约、条件激活、恢复异常、入驻档期与双边数据授权/完整历史。声明默认未选中；未来真实资金、消息与长期档案7张P稿明确标记。

新增4组件组11变体，复用既有53变量/12文本样式。101源画板3893原生节点，IMAGE填充0；最终414原型反应/11起点。字体/固定文字行高/横向越界自查无所列问题，代表性视觉复核并修复组件共享默认状态、文字高度和角色分支；未逐条回放全部原型，未全部画板逐像素签收。详见[设计及逐画板索引](design/MINI_PROGRAM_BOOKING_UI.md)、[任务](tasks/D02.md)、[交接](handoffs/D02.md)、[证据](evidence/D02/README.md)。

D02设计任务仅Figma与docs文件，无应用代码/依赖/Migration/生产变化；该阶段未运行应用测试、构建、PG、微信开发工具/真机或支付联调。其后用户已要求原生实现，进展以C08新记录为准；不将设计稿或旧CI当作本次小程序实现证据。

更新时间：2026-10-24（Asia/Shanghai）；集成人root。

## C06 / C07 球员预约、授权数据及同价比较（DONE / MAIN，未部署生产）

[PR14](https://github.com/xyq-dev/small-city-basketball/pull/14)已合并main `7d23203c2bfd57f3fd99622f286d30cd2c5d9356`，最终source `1722333d50c077cbf11efc388381c68440873dfe`；source与合并tree均为`24c7ad11055fcc0464babeba2b63aa2b3a230a05`，合并后已实际fetch核验。交付五类/多人逐场/条件意向预约、报价与履约/变更/争议、同价同位置与最多3人含费比较、当前有效独立确认的授权个人记录/近期5条/样本完整度，以及主办方精确提名/本人同意/撤销和完整授权历史分页。

[最终CI40065953550](https://github.com/xyq-dev/small-city-basketball/actions/runs/40065953550)三个job全部SUCCESS（attempt1，无重试），原始日志已核对：1046源码（admin512/API534）、微信VM11、289真实PG含预约32/数据19＋隔离runtime16、14Mock＋桌面12/手机模拟12真实API＋4可信HTTPS浏览器；17迁移/checksum、65表实际重启、完整dump恢复/旧授权隔离、正常/故意失败owned清理通过。六项P2均修复并在真实验证后resolved：原买方128配额、旧授权完整可达、原ID跨页面/刷新恢复、COMMIT后持久拒绝、裁定者排除球队关联、未接单不转争议而保持到期。独立静态联读CLEAR，最新source自动review completed无finding/未解决finding；security未运行。

016/017在隔离CI执行，生产未执行。助攻/篮板/时间/命中率未采集，不补0或能力总分；统计场次是冻结名单样本，不代表实际出场。实收/退款到账/分账全部0，真实个人撮合支付、通知与实名/资格自动核验未配置；没有生产部署、正式账号维护或新外部凭据。合并后自动检查尚无最终结论，不把候选CI当成合并后重复执行；合并代码tree与已验证候选相同。后续仅验收文档同步，最终文档HEAD按实际Git读取。详见[C06使用](PLAYER_BOOKING_USAGE.md)、[数据使用](PLAYER_PERFORMANCE_USAGE.md)、[C07任务](tasks/C07.md)、[交接](handoffs/C07.md)、[证据](evidence/C07/README.md)。

## D01商业版UI设计交付（DONE，设计及文档范围）

2026-10-24用户最新要求先做整套Figma商业版UI。root已在[原生Figma文件](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=18-2)保存10页、94张业务/状态画板（75业务含阶段/尺寸变体＋19异常/权限），另4张导览/规范/交接板；12组件组41变体、53变量12文本样式。业务页555条原型反应/18起点，封面9链接/1起点，为设计配置，未逐条浏览器演示回放。全文件结构检查、最后5页增量检查、抽样视觉及独立R02/B06/A02复核通过所列范围；8张规划界面明确P标注，E仅对齐既有Web/API能力。用户尚未视觉签收；新UI尚未写入前端或部署，应用代码与C05边界保持。详见[设计及逐画板索引](design/COMMERCIAL_UI_FIGMA.md)、[任务](tasks/D01.md)、[交接](handoffs/D01.md)。本记录进入main仅代表文档整合，不代表新UI上线。

本轮纯设计/六份文档，无代码、依赖、Migration或正式环境修改；未重跑应用类型检查/构建/单测/PG/浏览器，不将既有CI充作新稿实现证据。接续先审阅设计，再按既有架构分批实现；C05旧库隔离升级、外部微信/支付联调、原生OBS暂缓及生产版本差异均未解除。同步前main本地/远端一致`97100fd2fb6b3e40ffcd87320b03e5ae91fcff5b`，最终文档HEAD实时读取。

## C05 已整合（DONE / MAIN，未部署生产）

2026-10-24（Asia/Shanghai），[PR13](https://github.com/xyq-dev/small-city-basketball/pull/13)已合并main `d4f6500453f293499dcc0d189c084156026db4f1`，最终source`9abeb5c8aeaf294c1df75320d0c7bf4592fc1d23`；候选与合并的tree均为`23c4620a42b0399976876fd23404fa6c8773b54f`。沿用原比赛、权限、服务器计时和独立确认，交付固定分组接淘汰、按届软件服务费/人工双人收退款/默认关闭的微信支付适配、已有账号微信绑定登录及原生小程序源码、受控文件和小视频/显式发布/人工媒体定位。[最终候选CI40001590258](https://github.com/xyq-dev/small-city-basketball/actions/runs/40001590258)三个job全部SUCCESS、无重试，完整原始日志已核对；914源码（admin410/API504）、11小程序VM、254真实PG（238+16）、12Mock＋桌面12/手机模拟12真实API＋4可信HTTPS浏览器通过。15Migration/checksum、58表实际PG重启、完整dump→第二实例/卷恢复及旧授权隔离、媒体实际字节/Range复核、正常和故意失败owned清理均通过。必要独立审查通过；原分组加时P2已修复并resolved/outdated。最新source自动CodeReview仍RUNNING，不能记为通过，security未运行。合并后[CI40003519494](https://github.com/xyq-dev/small-city-basketball/actions/runs/40003519494)三个job同范围全部SUCCESS（run_attempt=1，无重试），完整原始日志已核对。没有生产部署、正式数据库/账号维护、真实资金请求或外部新凭据。任务、失败轮及证据见[C05](tasks/C05.md)、[交接](handoffs/C05.md)、[验收](evidence/C05/README.md)；操作入口见[使用指南](COMMERCIAL_USAGE.md)。

## main已整合

仓库`xyq-dev/small-city-basketball`，最新业务合并为[PR15](https://github.com/xyq-dev/small-city-basketball/pull/15)的`0d35d4608c59015a14a60926769c162cbeb5c362`。后续纯文档HEAD从实际Git读取。

C04已由[PR12](https://github.com/xyq-dev/small-city-basketball/pull/12)合并main `7ef18c915ffa51712077e6668e60ec6fbb0219b6`，最终source`bc6516dc0068812c8075f9a88effa89c4183190f`与合并tree同为`5446bdacb6c5fc08fab245cecad74b91b1028a5d`。2–32队单淘汰、首轮轮空、原独立确认晋级/加时、逐轮显式发布、来源赛果锁定、最终共同名次、公开签位及闭赛/统计/恢复已整合。[CI39975284464](https://github.com/xyq-dev/small-city-basketball/actions/runs/39975284464)三个job全部SUCCESS且日志已核对：749源码（admin363/API386）、217真实PG（201+16，新增15项）、12Mock＋桌面9/手机模拟9真实API＋4可信HTTPS浏览器；11Migration/checksum、41表实际PG重启、完整dump→第二实例恢复及旧授权隔离、正常及负向owned清理均通过，无重试。最新source自动CodeReview completed无finding/未解决线程，独立静态人员维护版本P1修复已复核，security未运行。合并后CI39976904075三个job也全部SUCCESS，完整日志已核对、无重试。没有生产部署/正式DB或账号维护；详见[C04任务](tasks/C04.md)、[交接](handoffs/C04.md)和[证据](evidence/C04/README.md)。

C03已由[PR11](https://github.com/xyq-dev/small-city-basketball/pull/11)合并main `01f8ea426950b865303fd680480e507969adce20`，最终source`71451d65ae73604690057a0232e486f42796c1ac`与合并tree同为`d9ba1e527e2fc59988c518fdb9355c8bd2f49a70`。整届完赛/归档/重新开放、显式独立历史观赛、私有本届球员基础数据榜已整合；复用原比分/计时/确认/排名，闭赛业务写守卫与安全撤权例外均验收。最终[CI39941294620](https://github.com/xyq-dev/small-city-basketball/actions/runs/39941294620)三个job全部SUCCESS且完整日志已核对：660源码（admin347/API313）、202真实PG（186+16，新增17项）、12Mock＋桌面8/手机模拟8真实API＋4可信HTTPS浏览器；010/checksum、40表实际重启、完整备份恢复/旧授权隔离、正常及负向owned清理全部通过。最新source自动CodeReview completed无finding/未解决线程，独立静态及必要delta复核CLEAR，security未运行。首轮兼容错误顺序与次轮隐藏桌面表头/CI超时修复均保留[证据](evidence/C03/README.md)和[交接](handoffs/C03.md)，最终成功不拼接局部结果。合并后CI39942415842三个job亦全部SUCCESS，完整日志已核对，无重试。没有生产部署/正式DB或账号维护。

C02首批四组能力为 **DONE / MAIN**：私有逐人得分/犯规及更正确认、自动排时建议、用户名兼容登录/安全离线维护、公开SVG/CSV/打印。最终source`ec74c47`与合并tree同为`34b755e77dbcf20156b673505ee38e3b5697172f`；[CI39919192641](https://github.com/xyq-dev/small-city-basketball/actions/runs/39919192641)三job全部SUCCESS：573源码、185真实PG、12Mock＋16真实API＋4可信HTTPS桌面/手机模拟浏览器，008/009隔离执行、两种采集模式40表实际重启、完整备份恢复/隔离及owned清理通过。最终自动CodeReview无新finding/未解决线程，必要独立静态复核通过；security未运行。注册夹具429及恢复计数P1均已修复并完整重跑，详见[C02交接](handoffs/C02.md)与[证据](evidence/C02/README.md)。[合并后CI39920273639](https://github.com/xyq-dev/small-city-basketball/actions/runs/39920273639)三个job也全部SUCCESS，同范围573源码/185真实PG/12Mock＋20真实浏览器、两模式重启/完整恢复及清理均通过，无重试；没有生产部署/正式DB或账号变更。

以下PR9及更早记录保留各自历史验收范围。

P01、P02、P03-A、P04-A/B、P05-A/B、P06-A及P07-A均为 **DONE / MAIN**：多机构身份/权限、球队报名/独立审核/冻结、单循环排赛/受控正式单场改期、单端在线计分/权威时钟/独立确认、正式排名/可撤销公开观赛、独立透明比分网页，以及非root同源HTTPS包/最小DB身份/完整隔离恢复。

[PR9](https://github.com/xyq-dev/small-city-basketball/pull/9)合并`e3102e4`，source`cc10b3d54e3a8c86cf94c4c1e7cff014534b6a98`／tree`2950e03f2af0a5238b8f8844d8717f504241b231`，与本地`d566623`一致。最终[CI39871485940](https://github.com/xyq-dev/small-city-basketball/actions/runs/39871485940)三job全部SUCCESS且完整日志已读：497源码（admin237/API260）、165真实PG（149＋16）、12Mock＋14真实API＋4可信HTTPS桌面/手机模拟浏览器；完整strict/格式/build、007及checksum、40表实际重启、两次改期的完整隔离恢复/原发布不变/旧授权隔离、正常及负向owned清理均通过。最新source自动CodeReview completed无finding/未解决线程，security未运行；必要独立静态审查CLEAR。首两轮失败及最小测试修复保留于[P04-B交接](handoffs/P04-B.md)。[合并后CI39875354051](https://github.com/xyq-dev/small-city-basketball/actions/runs/39875354051)三job也全部SUCCESS，完整日志已读，同验收代码tree和上述检查范围，无重试。

[PR8](https://github.com/xyq-dev/small-city-basketball/pull/8) source`8809d67a568b86d3ef530ec92785877c29fab80a`、tree`fcb777848e666aac9f81097bca1ddffc3130e543`与本地`dde4c27`一致；[CI39827535301](https://github.com/xyq-dev/small-city-basketball/actions/runs/39827535301)三个job全部SUCCESS，完整日志已读：432源码（admin202/API230）、140独立真实PG（124＋16）、12Mock＋14真实API＋4HTTPS浏览器、完整strict/格式/两端build、001–006/checksum/39表实际重启，以及三非root镜像/可信TLS/完整业务链/API真实换IP且Web不变/同卷重建/完整dump→第二实例恢复精确一致→旧授权隔离/正常及负向清理均通过。

最新source自动CodeReview completed无finding/未解决线程，security未运行；API/恢复和必要delta独立静态复核通过。前五轮失败与修复完整保留于[P07-A交接](handoffs/P07-A.md)，摘要见[证据](evidence/P07-A/README.md)。合并提交同验收tree，[合并后CI39829137241](https://github.com/xyq-dev/small-city-basketball/actions/runs/39829137241)也全部SUCCESS：首次production/admin成功，api因依赖安装耗时触及job限时取消后，仅重试该任务120008473545成功；首次取消不计完整通过，没有改代码或放宽检查。

PR2四项已按最新代码核验并完成：scrypt单槽/有限队列、过期限流清理、赛事版本冲突显式刷新恢复、独立注册能力入口；不是依据线程resolved或仅CI状态判断。

## 下一步与边界

C06/C07已完成完整候选验收及PR14合并；下一步按实际执行通道及恢复条件处理旧库隔离升级和部署，外部微信/支付/通知/身份核验联调仍需实际资质与凭据。D01设计与以下C05外部环境待办保留，隔离验收不等于生产发布。

C05为DONE / MAIN，最终候选的三job完整验收通过；合并后[CI40003519494](https://github.com/xyq-dev/small-city-basketball/actions/runs/40003519494)三个job同范围全部SUCCESS（无重试），完整日志已核对。四域已落实上述有界范围，下一步为真实微信开发工具/域名/真机、真实商户沙箱与支付退款对账联调，以及旧001–007完整FINAL赛事的隔离升级演练。依赖实际账号/资质/凭据或服务器通道的工作不能在本轮虚构完成。开发代码仍有长期球员/赛季/专业统计、观众关注提醒、可靠离线、云直播/大视频/转码等后续范围，详见[商业规划](COMMERCIAL_PRODUCT_PLAN.md)及[C05使用指南](COMMERCIAL_USAGE.md)。

用户已明确授权本批开发、测试、commit/普通同步/PR、隔离CI与审查后合并；PR10/PR11/PR12/PR13/PR14已按范围执行。保留C02/C03/C04/C05及旧工作树和本地作者历史，没有reset、清理他人修改或force push。C05历史会话当时本地main；本轮集成工作树保留在feat/player-reservations，远端main已PR14合并。后续文档HEAD以实际Git读取为准。

完整商业版尚未完成。原生OBS/CEF依用户要求暂缓；手机模拟不等于Safari/微信真机。旧schema升级夹具仅旧用户/凭据，不含原007已落库FINAL完整赛事，部署前须用旧库隔离恢复副本补验，不能把本卡新schema恢复当旧库升级。

本轮没有服务器执行通道，没有生产部署、正式Migration/账号维护、付费资源、外部凭据或公网端口变更。账号维护工具已验收不等于管理员已改名或改密。C02至C05本机检查、隔离CI、以下服务器执行方旧版报告分别记录，不能混成一种证据。readiness严格核验Migration集合，不得把新DDL后直接切旧镜像当作已验回退方案。

## 服务器阶段（用户回传报告，非本会话独立实测）

2026-10-23用户回传Hermes报告：main `153421668ea74378df859a4b7c21df7da11ad77e` 已在 `https://basketball.playhubs.cn` Docker部署，项目 `scb-basketball`，服务器 `/srv/small-city-basketball`；001–007已在该项目新库执行、首owner初始化及登录通过。随后补做同镜像production模式隔离HTTPS业务/权限及桌面和手机模拟；证据据报告位于 `accept/10231320e520/`。经用户向Hermes授权后仅移除本站Basic Auth，应用登录、机构权限与观众独立授权保留，其他项目回查正常；交接在服务器 `DEPLOYMENT.md`。本会话未访问这些服务器证据，不把回传报告改记为独立复测。原生OBS、微信真机/Safari、保险凭证仍未验证；本会话未实施正式admin登录名或密码修改，也未独立复核服务器当前账号；C02只交付兼容能力，密码长度规则未降低。

## 接手入口

先核验实际目录/远端/分支/HEAD/dirty/进程，再读AGENTS、[看板](TASKS.md)、C07最终任务/交接与最新PR/CI。本轮集成目录`/workspace/scratch/608836f8d204/small-city-basketball`仍为`feat/player-reservations`；原`/workspace/scratch/dc6a786e1a31/small-city-basketball`的main工作树未被切换/reset。远端main业务已合并7d23203，最终文档HEAD另按Git读取。本地作者历史与远端聚合提交SHA不同，但各次同步tree精确核验一致；保留旧分支和工作树，无force或清理他人修改。开发/普通同步/PR/审查后合并授权已按本轮明确回复执行；生产尚未执行，未来操作仍核验实际通道、当时授权及恢复条件。文档不会在停止会话后无人值守更新。

合并后[自动CI40095117969](https://github.com/xyq-dev/small-city-basketball/actions/runs/40095117969)在本次读取时仍为in_progress；候选CI通过与合并后重复运行分列，未冒称后者已通过。其后仅同步文档和这些原图/JSON，无应用代码变化。
