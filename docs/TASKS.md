# 任务看板

## 2026-11-06 账号安全（DONE / MAIN：源码与隔离验收，生产未部署）

[PR #43](https://github.com/xyq-dev/small-city-basketball/pull/43)已合入main，合并SHA`becf8d38e3bc8e2c12059780ed57f52aa35f0bf0`，tree `505aaac19cf734e7c2623a4223242d726c503d60`与候选`89241947fb180ce8e857d1aee5cb94ca303a79c3`及CI测试merge-ref精确一致。首次部署自行设置OWNER密码、Web登录后本人改密及全部旧会话撤销已完成源码、独立安全复核与隔离验收。

[CI207](https://github.com/xyq-dev/small-city-basketball/actions/runs/42168301902)的account-security/admin/api/production四作业全部SUCCESS，已读取四份完成日志。新增真实HTTPS浏览器桌面/手机各1完整密码流程通过；既有真实API浏览器24项、PG新域143/旧业务611、最小权限21、原生页面→真实API21、HTTPS4、实际PG重启与完整归档恢复通过。管理端598、API源码1345、原生1196通过/1平台跳过；兼容布局1349通过/1335配置跳过，1335份布局/PNG已核验，不代表微信真机。GitHub自动Code Review于同一候选完成且无finding；独立安全审查另行完成，未冒称自动Security Review执行。

生产未由本轮部署，Migration049仅临时/CI执行。当前会话无直接Hermes/SSH执行通道；公开health/ready返回200只证明既有服务正常。服务器侧固定版本、备份恢复、升级和账号保留步骤已写入[交接](handoffs/ACCOUNT-SECURITY.md)。详见[任务](tasks/ACCOUNT-SECURITY.md)和[操作说明](operations/account-security.md)。

## 2026-11-06 COS01 腾讯云对象存储（REVIEW / BRANCH_ONLY）

`feat/tencent-cos-media` 初始提交4170765已创建[PR45](https://github.com/xyq-dev/small-city-basketball/pull/45)。发布期间main前进至f7382c3，已普通merge保留账号安全，COS迁移顺延050；静态50迁移/223表/128函数、PGlite完整升级和21项SQL约束通过，原生CI待整合候选。初始API1366项、类型/构建/格式通过，不代表新基线或真实COS已验。尚未合入main、未上线。详见[任务](tasks/COS01.md)、[接续](handoffs/COS01.md)、[证据](evidence/COS01/README.md)、[配置](operations/tencent-cos.md)。

## 2026-11-03 四页导航与账号双态（REVIEW / BRANCH_ONLY）

| 项 | 事实 |
| --- | --- |
| 日常目录 | `D:\Projects\small-city-basketball` |
| 候选分支 | `integrate/ui-v4-consolidate` |
| 基线 | `origin/main` `ef25846857bb0431a4f71ad8dbe6fac87f945ae0` |
| 来源 | `D:\Projects\small-city-basketball-v3-nav` 未提交的账号、赛事、同城、球队和 `v3-chrome` |
| 不纳入 | `ui002-ci` 已在 main；`docs/design/ui-v4/REFERENCE_V3`、`scb-homepage-assets-v1`、`scb_remaining_ui_v3` 只归档 |
| 状态 | 本地验证后创建 PR。远端 CI 通过前不是 MAIN |

详情见 [交接](handoffs/UI-V4-INTEGRATE.md)。下方 2026-11-03 文档节里“#39 仍为 Draft”是当时记录；当前 main 头已经是首页还原 #39。

## 2026-11-03 文档更正：#37/#36/#38 已合并，#39 仍为 Draft

核验时间 `2026-11-03T03:51:16Z`。SHA、双亲提交和日志范围见 [当前状态](CURRENT_STATUS.md) 同日一节。下方 2026-11-01 两节的「Draft 待审」是合并前清单，原文保留。

| 项 | 当前事实 | 依据 |
| --- | --- | --- |
| PR #37 `fix/ui002-ci` | 已合并进 main | `merged_at` `2026-11-01T23:39:25Z`，合并提交 `717a3a7a9fbb91aa93370d6dc594c10b58bdf4c9` |
| PR #36 `feat/ui002-integration` | GitHub 标为已合并；头提交随 #37 进入 main | `merged_at` `2026-11-01T23:39:27Z`。`merge_commit_sha` 就是头提交 `813ed61f49cdf461afa9a659a365934c2308ec81`，没有另一条合并提交 |
| PR #39 `fix/wechat-homepage` | 仍是开放 Draft | 头 `205ea41e761e89457d11d3930124a27a577fd1ff`。[Application checks](https://github.com/xyq-dev/small-city-basketball/actions/runs/41570969693) 三作业 SUCCESS：admin `npm test` 通过（`test:wechat` 1193 通过、0 失败，1 项 Windows 批处理桥测试跳过），`npm run test:e2e` 1142 通过、1128 跳过。同作业的原生兼容证据为 1128 份布局和 PNG，并写明不是微信运行时；[工具合同](https://github.com/xyq-dev/small-city-basketball/actions/runs/41570970063) SUCCESS。空列表「同城篮球服务」碰底栏不记为已修复 |
| PR #38 `fix/wechat-preview-size` | 已合并进 main | `merged_at` `2026-11-03T05:26:16Z`（2026-11-03 13:26:16 Asia/Shanghai），合并提交 `e770803b1197852f4da3a66b7382a3352f49b5c1`，合并时头 `69d19ffd4f288ab8f0a69e37ad82a74cfc203cc1`。合并前草稿头 `59c017cb7d417ad03fb2e4f6acdfef27ff1a1e33` 的 [Application checks](https://github.com/xyq-dev/small-city-basketball/actions/runs/41379255659) 记录 admin、production 通过，api 在公开观赛重开步骤失败；[工具合同](https://github.com/xyq-dev/small-city-basketball/actions/runs/41379255669) SUCCESS。该检查属于该草稿提交 |

正式支付、投保、分账、推流和真机仍未由这次文档更正改为已验收。#39 仍未合并。

## 2026-11-02 微信首页视觉还原（BRANCH_ONLY，未合并）

分支 `fix/wechat-homepage` 从包体提交 `148be73` 分出，不进入 Draft PR #38。首页按 `scb-homepage-assets-v1` 的参考图重排，公开赛事、招募、球员、档案、视频和同城筛选仍走现有入口。高清母版未打进小程序。间距调整当时的直接测试 84 通过。2026-11-03 账号页夹具把首页素材包的五个底栏图标视作共享底栏，不再把 `assets/home/home.svg` 等导航文件当成账号页图片；本地根目录 `npm test` 为 admin 588、api 1339、微信 1191 通过，1 项既有 Windows 跳过，0 失败。`a9d1a0d` 与 `383dcd2` 的远端 admin `npm test` 通过，当时 `test:e2e` 为 149 通过 / 993 失败 / 1128 跳过。后续提交让布局检查承认分包路由，并把首页几何改到当前首屏；本地桌面布局 1128 通过，本地 `npm test` 微信 1193 通过 / 1 项既有 Windows 跳过。该本地结果不代替下一轮远端 Application checks。2026-11-03 将本分支 rebase 到 `origin/main` `73db92c`（该提交含已合并的文档 PR #40）。冲突只在 `docs/TASKS.md`、`scripts/check-mini-layout-evidence.mjs`、`tests/e2e/mini-program.spec.ts`。上表的 #37/#36/#38 已合并和 #39 仍为 Draft 按 main 保留；上表 #39 的 Application checks 只属于 rebase 前的 `205ea41`，不代表 rebase 之后的提交。首页产品文件与 rebase 前 `c17dec3` 一致。空列表「同城篮球服务」碰底栏未改。本会话 Node v22.23.4 下微信源码测试 1194 通过 / 1 项既有 Windows 跳过 / 0 失败；没有重跑 e2e，也不把这次本地结果写成远端 Application checks。真机和开发者工具上传测量未执行。详情见[交接](handoffs/HOME-VISUAL.md)。`CURRENT_STATUS.md` 仍只记录已合并事实。

## 2026-11-01 UI002 本地续作统一清单（当时记录：Draft 待审）

工作树 `fix/ui002-ci` 在基线 `813ed61` 之上准备单独 Draft PR，目标是 `main`。不改 PR #36，不向 `feat/ui002-integration` 或 `main` 推送。下方 REMAINING6 仍是 main 已验收事实。本地管理端结果不能写成远端 CI、真机或生产验收。

| 功能 | 依据 | 页面 / 接口 / 文件 | 状态 | 缺口或验证 |
| --- | --- | --- | --- | --- |
| 开发者工具合同根选择器 | UI002 检查点 14 | `scripts/wechat-devtools-ui.mjs` | 已实现且有本地验证 | 合同 16/16。随本 Draft 推送后才由远端 CI 覆盖 |
| 旧展开文案断言改到现行披露 | UI002 检查点 15 | `apps/wechat/test`、`tests/mini-program/fixtures` | 已实现且有本地验证 | `test:wechat` 1181 通过 / 6 失败。失败是 Windows CRLF 哈希和符号链接 EPERM，不改固定哈希 |
| 比赛媒体发布须先选草稿并勾选 | V07，`UI002-MEDIAFLOW` | `apps/wechat/pages/match-media` | 审查修复已有本地验证 | 确认框返回后再次核对同意、页面、身份、版本和权限。隐藏或版本变化后的迟到确认不发送。发布命令仍是 `{type:PUBLISH, expectedVersion}`。撤销未改。真机未验 |
| 跨城调度机构工作台 | R6 派单状态机 | `/dispatch`，`GET /v1/dispatch`，`apps/admin/src/operations/DispatchPage.tsx` | 审查修复已有本地验证 | 预算和当前报价分开。同一资源写成功后读取新版本，并作废尚未返回的旧读取；另一条详情不被覆盖。接单偏好和建立需求不因打开详情失效。付款仍在原预约 |
| 成人培训排课 | R6 培训命令 | `/training`，机构培训、教练、课次、报名、退费接口 | 审查修复已有本地验证 | 建班期提交所选教练和整数权重，并通过既有 `parseTrainingCohort`。签到后签退使用新版本；退费批准后不再显示旧审批。批准不表示到账。青少年入口保持关闭 |
| 保险核对 | R6 保险，只查询和已有操作 | `/insurance`，`GET /v1/insurance` | 已实现且有本地验证 | 列表标明是当前账号保单。只刷新和申请退保。不报价、不投保 |
| 广告结算 | R6 广告金额与状态 | `/sponsor-commerce`，机构广告接口与 `statements` | 审查修复已有本地验证 | 审核和签署前展示冻结合同条款、时段、费用和分成。未核对或版本变化不签署。签署携带正在查看的哈希。不发送分账、付款或退款 |
| 学员请假、补课 | 培训权益命令只允许学员本人 | 小程序培训页已有 | 已实现于小程序 | 机构工作台不代发，避免管理员请求必然被拒绝 |
| 消费异议的平台裁决、培训主体的平台审核 | 须平台运营身份 | 小程序在 `isOperator` 时提供 | 外部条件阻塞 | 管理端会话没有平台运营标记。不放一个机构管理员必然 403 的按钮 |
| 微信支付、真实投保、订阅消息、地图 SDK、正式推流 | EXPANSION8 / REMAINING6 外部待办 | 既有受控驱动，开关默认关 | 外部条件阻塞 | 缺正式账号、证书、协议或产品参数。本轮不编造供应商接口，不打开开关 |
| 分账发送、付款、收费退款出款 | 已有统一交易命令 | 原交易页 | 高风险待审，本轮不改 | 培训页批准退费后仍须到统一交易页审核并发送。不在广告页新增出款 |

## 2026-11-01 UI002 本地续作（当时记录：Draft 待审）

上表在 `4b83a4d` 的 Draft 之上补了 PR #37 的审查修复。`0629009` 的远端 api、production 和微信工具检查通过；admin 的单元测试通过，e2e 因 96 项静态布局仍要求旧文案、照片和底栏位置而失败。后续提交把这些断言改到当前页面，并阻止失败的旧打开请求整页覆盖后打开的需求。`a2f4592` 四项远端检查通过，只代表该提交。2026-11-02 的调度修复区分资源身份和读取轮次，并把接单偏好、建立需求定为页面级操作。本机 `OperationsPages.test.tsx` 27/27，管理端类型检查通过。完整 e2e、真实 PostgreSQL 和此前 `test:wechat` 的 6 项 Windows CRLF/符号链接失败没有重跑。正式支付、投保、分账、推流未启用。远端 CI 以新提交为准。

## 2026-11-01 REMAINING6：六项功能实现（DONE / MAIN：源码与隔离验收）

2026-11-01 14:08 Asia/Shanghai（核验时间 `2026-11-01T06:08:12Z`），[PR #35](https://github.com/xyq-dev/small-city-basketball/pull/35) 已合入main，代码合并SHA `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree `e38a40da165a92f1eddc5696dcd41e7dc0e2a55a` 与CI160测试候选 `7a3f958c0440eca67d1d67e372a6e2d4c9d92440` 精确一致；双亲为 `911564f0` 和该测试候选。12条外部审查全部已解决，无新增线程。

当前73条原生路由、48项Migration、221表（新增45表）、126函数。地图视野搜索、三类撮合、跨城派单、成人短课培训及商业广告分成的源码和约定隔离验收为DONE / MAIN；保险准入与接口框架也已整合，真实供应商adapter因协议、产品、证书和凭据未提供仍为 `BLOCKED_EXTERNAL`。001—042冻结，043—048仅在隔离CI执行；未更新生产，未进行真实投保、资金、消息或正式外部渠道操作。 逐项范围见[代码与验收映射](audits/REMAINING6_ACCEPTANCE.md)、[任务](tasks/REMAINING6.md)、[接续](handoffs/REMAINING6.md)及[运行配置](operations/remaining-six-runtime.md)。

[CI160](https://github.com/xyq-dev/small-city-basketball/actions/runs/41277450597) 三个作业完整SUCCESS，root已读取全部原始日志：新域真实PG143（含培训19）、旧业务PG586、原生页面→真实HTTP21、真实API浏览器24（12+12）；admin561、API源码单测1339、原生1076通过，1项既有Windows跳过；布局1082通过，1068项按配置跳过。runtime PG21、HTTPS4、221表精确重启与完整归档恢复、业务快照/fencing、quarantine及旧私有/公开/overlay凭证失效均通过；仅清理自有资源，control卷保留。

CI149—159各阶段失败、修复与证据保留在任务和交接；旧候选的成功不替代本次最终验收。UI001的200张Figma设计稿与功能代码分别记录，现有页面不代表全部视觉稿已逐像素实现。下方旧设计卡的待开发项是交付时事实，当前进度以上述main代码基线为准；正式保险/商户/微信与真机条件仍须专项验证。文档收口基于该代码基线，不改应用、迁移或生产。

## UI001：全国平台与同城服务UI（DONE / MAIN：历史设计及文档）

[200张可编辑设计](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=48-7)、[交付/实施顺序](design/WECHAT_UI_V2.md)、[画板与68条路由索引](design/UI001_SCREEN_INDEX.md)、[任务](tasks/UI001.md)、[交接](handoffs/UI001.md)。原核心127＋新增73，涵盖五导航、四条核心流程与DOC006六模块；角色后台单列。当时完成设计检查，六项业务代码尚待开发；该次交付仅包含 UI 文档。后续代码进度见上方 REMAINING6，正式外部及真机未因设计完成。

## DOC006：六项补充设计（DONE / MAIN：历史设计交付，实现另见 REMAINING6）

2026-11-01：保险供应商适配、地图视野搜索、全国撮合、跨城派单、培训招生、广告收入分成的设计已整合；[总设计](design/REMAINING_SIX_FEATURES.md)、[UI交接](design/SUPPLEMENTAL_UI_HANDOFF.md)、[任务卡](tasks/DOC006.md)、[接续记录](handoffs/DOC006.md)。

当时的下一步是建立 UI 和业务实施卡；后续已由 UI001 与 REMAINING6 分别承接。设计交付不代替业务代码、专项验收或正式外部条件；当前实现状态见上方，生产未变更。

## EXPANSION8（DONE / MAIN：业务源码与隔离验收，正式外部未验）

2026-10-31 Asia/Shanghai；[PR34](https://github.com/xyq-dev/small-city-basketball/pull/34)已以merge commit `9bfc54d12188846fa6a63605606dff89b783d025`合入main，tree `73f20bdfa65192382ce8e03112ac6f08ec9a3661`与最终候选及测试merge-ref精确相同。八项持久服务、控制器、原生入口和旧业务门槛已接线：直播/云媒体、保险编排、收退款/对账/分账、订阅消息、统一搜索、注销、青年监护。[逐项代码与外部待办](audits/EXPANSION8_ACCEPTANCE.md)、[总任务](tasks/EXPANSION8.md)、[恢复入口](handoffs/EXPANSION8.md)、[使用指南](EXPANSION8_USAGE.md)、[运行边界](EXPANSION8_OPERATIONS.md)。当前68条原生路由、42项Migration、176张表（本轮49张）；001—042冻结，后续DDL从043追加，生产未执行。

最终候选120802fd2729db972020df5309100c25af11f545的[CI41189029140](https://github.com/xyq-dev/small-city-basketball/actions/runs/41189029140)三job完整SUCCESS（attempt1），root已读取全部原始日志：1158 API、561 admin、1008原生源码测试通过，1项既有Windows平台跳过；584真实业务PG＋21最小权限PG、21原生页面→真实HTTP、1067兼容浏览器/1053布局PNG、24真实API浏览器、4隔离HTTPS全部通过。176表精确指纹重启、第二PG/卷完整备份恢复、业务快照/fencing/quarantine和仅自有资源清理通过，新增49表全部有非空业务样本。此前失败及真实修复保留在检查点；合并后的自动重复CI不混作本次已通过的候选证据。

真实保险供应商未选定、实际adapter未接，购买编排默认关闭；微信支付/订阅及腾讯直播/多平台已实现受控驱动，但正式AppID、商户、模板、直播类目、外站权限和真实联调未验。没有生产更新、真实资金、真实投保、真实推流或发信。兼容浏览器不代表官方微信运行时或真机；数据库备份不含MP4字节，正式媒体卷仍须独立归档恢复。这里的DONE仅指业务源码与约定隔离验收，下方各阶段保留历史范围。

## COMPLETION22：22项功能实现与测试（DONE／MAIN：源码与隔离验收）

2026-10-31 Asia/Shanghai；[PR33](https://github.com/xyq-dev/small-city-basketball/pull/33)已合入main `29179c0f047dde92c50d4dd7cb360d4f36eb77f5`。F01—F22源码与消费者及约定隔离验收完成，56路由／35迁移／127表；[逐项及完整证据](tasks/COMPLETION22.md)、[恢复入口](handoffs/COMPLETION22.md)、[使用指南](COMMERCIAL_USAGE.md)。[CI41173913872](https://github.com/xyq-dev/small-city-basketball/actions/runs/41173913872)三job完整SUCCESS（attempt1），root已读取全部原始日志：920 API／561 admin／925小程序源码测试通过、1项既有平台跳过；520真实PG＋20最小权限PG、16页面HTTP、24真实API浏览器、4HTTPS、995兼容浏览器及981布局PNG通过。127表重启、44新增表非空业务capture、第二数据库完整恢复、业务快照/fencing/quarantine和自有清理全部通过。

READY裁定读页缺陷及规范矛盾已修复，唯一自动review thread resolved；账号旧码失效的新码恢复路径新增回归通过，未放宽授权。最后4份Markdown不变应用来源；main合并tree已核一致。合并后CI41175391742正在自动重复运行，未记作通过。正式微信/地图/邮件、支付/在线保险及生产仍未验；DOC005直播仅设计，不能把本批DONE当完整商业上线。

## DOC005 小程序直接开播与多平台分发

2026-10-31 Asia/Shanghai；负责人及集成人Codex root。用户已要求设计并同步GitHub；首选手机小程序采集→云端比分合成→多平台分发，OBS为后续输入扩展。

| 范围                             | 状态                             | 下一步                                                                                                 |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| DOC005方案、交互、规则与验收要求 | 文档交付；详见任务卡最终核验记录 | [专项](design/MINI_PROGRAM_MULTIPLATFORM_LIVE.md)／[任务](tasks/DOC005.md)／[交接](handoffs/DOC005.md) |
| 直播功能实现与真实双平台验收     | TODO，未开发／未开通             | 先核验微信推流准入、目标账号同播权限、云合成／停流能力及预算，再做交互与API／数据差异审查              |

本轮只有11份Markdown；L01—L08不是已建页面，V01—V20为待实施验收，未定供应商、配置账号或采购。保留原记分、媒体和P06-A合同；真实开播、正式发布、付款及生产不由设计文档自动启用。

## C23 本人报名资料与人工审核

2026-10-31 Asia/Shanghai；唯一集成人 Codex root。状态 **DONE / MAIN（源码与隔离验收）**；PR32合入09348e3，精确候选CI41096252199和合并后[main CI41099428902](https://github.com/xyq-dev/small-city-basketball/actions/runs/41099428902)均完整SUCCESS，三job全绿。本轮按用户要求测试合并分支，实际main完整日志及最终状态已核验；恢复点G.3。没有未合并业务改动，本轮只更新验证记录。

| 切片 | 交付                                           | 状态                                       |
| ---- | ---------------------------------------------- | ------------------------------------------ |
| A    | 差异设计、隐私/状态契约、开工检查点            | DONE / MAIN                                |
| B    | 本人材料、私有照片、外部保单人工审核及报名门槛 | DONE / MAIN；C23 PG13/13                   |
| C    | 小程序本人填写/审核入口、联合验证与整合        | DONE / MAIN；完整CI通过，官方微信/真机待验 |

[任务](tasks/C23.md)／[恢复入口](handoffs/C23.md)。每个可验证切片同步代码、已执行验证和下一条操作；未同步不写为已共享。在线保险、支付、季军赛、生产部署及真机不在本卡实现范围。

## C21／C22 标准地区目录

2026-10-30 Asia/Shanghai，负责人及集成人 Codex。

| ID  | 范围                                                    | 状态                     | 验收／后续                                                                                |
| --- | ------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| C21 | 地区目录与旧标签兼容设计                                | DONE / MAIN 文档；PR #30 | 原方案保留；实施交给 C22 Codex                                                            |
| C22 | 固定 CC0 数据、Migration 023、API、主办方更正与标准选地 | DONE / MAIN              | PR #31 已合并83ae15a；候选及合并后CI均成功；[任务](tasks/C22.md)、[交接](handoffs/C22.md) |

GPS、乡镇、附近服务、生产及官方微信／真机仍独立待办，不由标准地区目录覆盖。

## C20 选城与公开赛事发现

2026-10-30 Asia/Shanghai；负责人及集成人Codex。[任务](tasks/C20.md)、[交接](handoffs/C20.md)。PR #29已合并，代码候选695cac3的完整CI通过，merge tree相同。

| ID  | 闭环                                                 | 状态                          | 后续                                                                  |
| --- | ---------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| C20 | 手动城市标签／全国、首页匿名赛事、最近选择和跨页同步 | DONE / MAIN（源码与隔离验收） | 先做行政区目录及旧城市标签的兼容设计，再接GPS与附近供给；微信真机待验 |

DOC004仅部分实施，G01—G15及全部定位服务未整体验收；C20不代表行政区、地图或真实供给已接入。既有照片保险、外部服务与生产待办保持。

## DOC004 定位选城、附近发现与服务可预约性

2026-10-30 Asia/Shanghai；负责人及集成人：本次Codex会话。[专项要求](design/LOCATION_SERVICE_REQUIREMENTS.md)、[任务](tasks/DOC004.md)、[交接](handoffs/DOC004.md)。

| ID     | 任务                                                             | 交付状态                            | 下一步                                                                    |
| ------ | ---------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| DOC004 | 官方资料研究、选城与附近交互、服务地点和覆盖规则、异常与验收要求 | DONE / MAIN文档交付；新增业务未实施 | 先做地区目录和手动选城差异设计；定位准入、真实供给及G01—G15另行实现和验证 |

本轮不修改既有业务、权限、支付、照片保险或订单合同；8个逻辑交互态不代表已新增页面，15项验收为计划。地图地点、定位成功与可预约供给分别判断。

## DOC003 管理员办赛、球员本人报名与必传照片

2026-10-29 Asia/Shanghai；负责人及集成人：本次Codex会话。[专项要求](design/EVENT_REGISTRATION_PHOTO_REQUIREMENTS.md)、[任务](tasks/DOC003.md)、[交接](handoffs/DOC003.md)。

| ID     | 任务                                                          | 交付状态                                      | 下一步                                                              |
| ------ | ------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| DOC003 | 8队办赛、必传本人照片、私有相貌核对、宣传授权、保险与资格流程 | 需求文档及C23本人资料/照片/外部保单切片已合入 | 邀请招募、季军赛、海报和真实投保等剩余范围另卡，不将R01—R12全标通过 |

本轮不调整已完成C13—C19的状态，也不把需求补充算作新功能验收。照片上传为必填；宣传公开用途须单独授权。C23已补既有名单中的本人资料/外部保单人工核验，未启用该流程的旧身份/保险门槛仍保留；季军赛、真实投保等未完成。

## DOC002 全国平台与同城服务需求文档

更新：2026-10-29 Asia/Shanghai；本轮仅文档，负责人及集成人为本次Codex会话。完整内容见 [NATIONWIDE_LOCAL_REQUIREMENTS.md](NATIONWIDE_LOCAL_REQUIREMENTS.md)，执行记录见 [任务](tasks/DOC002.md) 与 [交接](handoffs/DOC002.md)。

| ID     | 任务                                     | 交付范围                                   | 负责人 | 依赖与后续                                                     |
| ------ | ---------------------------------------- | ------------------------------------------ | ------ | -------------------------------------------------------------- |
| DOC002 | 全国平台＋同城服务完整功能要求与入口同步 | DONE / MAIN 文档交付；不代表全国化功能DONE | Codex  | 已核对main基线及24页方案；后续先做现有实现差异评估，再建实施卡 |

目标顺序为A全国内容与高州办赛样板 → B1机构工具套餐验证，B2同城供给履约可并行 → C各类交易逐项验收 → D逐城复制。此顺序是新需求，不回退或重新认领已合并C06—C19能力；官方微信／真机、生产和外部服务待办继续保留。

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

当前C09：REVIEW / BRANCH_ONLY；用户未接受C08展示视觉，本轮已修正四个核心页面与共享样式，232VM/96新兼容布局及定向独立复核通过；[PR16](https://github.com/xyq-dev/small-city-basketball/pull/16) source21994add，完整CI40117324334仍运行，未合并。6张新图及原稿对照随证据分支evidence/c09-mini-ui-fidelity保存，用户视觉签收和微信工具/真机仍待办；[任务](tasks/C09.md)、[交接](handoffs/C09.md)、[证据](evidence/C09/README.md)。

当前D02：小程序预约UI补全已完成设计交付（99业务/状态+2辅助，4组件组11变体），[导览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2400)/[设计索引](design/MINI_PROGRAM_BOOKING_UI.md)/[任务](tasks/D02.md)。原生小程序实现和统一业务测试未完成；本轮只有设计/文档，无应用或生产变更。

当前C06/C07：`DONE / MAIN`，已由[PR14](https://github.com/xyq-dev/small-city-basketball/pull/14)合并`7d23203`，source1722333d/merge同tree24c7ad11。最终CI40065953550三job完整成功：1046源码/VM11、289PG＋runtime16、14Mock＋28真实浏览器、17迁移/65表重启与完整恢复/隔离/清理；六P2已修并resolved，最终独立/自动代码审查通过所列范围，security未运行。没有生产部署或真实资金。详见[C07最终任务](tasks/C07.md)、[交接](handoffs/C07.md)、[使用](PLAYER_BOOKING_USAGE.md)与[数据](PLAYER_PERFORMANCE_USAGE.md)。

当前D01：商业版Figma全景初稿已交付，设计DONE；[Figma导览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=18-2)、[任务](tasks/D01.md)、[交接](handoffs/D01.md)。10页/94张业务与状态画板，原生组件及核心浏览/阶段原型；用户视觉确认、前端新稿实现未完成。本批仅文档同步，不更新应用或生产。

当前C05：`DONE / MAIN`，PR13合并d4f6500，候选CI40001590258三job完整通过，合并后CI40003519494同范围全部SUCCESS（无重试）；root集成四域；[任务](tasks/C05.md)、[交接](handoffs/C05.md)。不把作者局部测试视为联合PG/浏览器或生产证据。

更新：2026-10-24（Asia/Shanghai）。集成人单写汇总；细节与证据见任务卡/交接。

| ID     | 任务                                                   | 状态                    | 负责人                                     | 依赖                              | 交付位置                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------ | ----------------------- | ------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C19    | 小程序媒体恢复、球队成员、私有赛季、关注与完整隔离验收 | DONE / MAIN             | Codex 集成及模块复核                       | C18 / PR #27                      | MAIN f97bb4b，[PR #22](https://github.com/xyq-dev/small-city-basketball/pull/22) 已整合 #23—#28；[任务](tasks/C19.md)、[交接](handoffs/C19.md)；源码与隔离验证完成，官方微信/真机待验，未部署                                                                                  |
| DOC000 | 私有仓库、初始说明与四组 UI                            | DONE                    | Codex / 初始化会话                         | 无                                | MAIN，源基线6911724                                                                                                                                                                                                                                                            |
| DOC001 | 开发文档及多 AI 协作规范                               | DONE                    | Codex                                      | DOC000                            | MAIN；[记录](handoffs/DOC001.md)                                                                                                                                                                                                                                               |
| P01    | 机构后台四页 Mock 原型                                 | DONE                    | Codex                                      | DOC001                            | MAIN f15adb4，PR#1；[任务卡](tasks/P01.md)                                                                                                                                                                                                                                     |
| P02    | 身份、机构与赛事基础后端                               | DONE                    | Codex                                      | P01                               | MAIN29c4ee4，PR#2，CI39730670229成功；[任务卡](tasks/P02.md)、[交接](handoffs/P02.md)                                                                                                                                                                                          |
| P03    | 球队报名、资料与审核                                   | IN_PROGRESS             | Codex集成                                  | P02                               | P03-A及C05私有文件/小程序有界入口已交付；完整自助资料/保险验证仍另卡                                                                                                                                                                                                           |
| P03-A  | Web球队、报名审核与名单冻结                            | DONE                    | Codex集成，API/UI/PG独立分工               | P02                               | MAIN1c4b352，PR3，CI39735150535全部成功；[任务卡](tasks/P03-A.md)、[交接](handoffs/P03-A.md)                                                                                                                                                                                   |
| P04    | 抽签、排赛与冲突检查                                   | IN_PROGRESS             | root集成                                   | P03-A                             | P04-A/B、C02自动排时建议、C04单淘汰及C05分组接淘汰已交付；全局优化及更多赛制另卡                                                                                                                                                                                               |
| P04-A  | 单循环对阵、手工排时与一次正式发布                     | DONE                    | Codex集成，API/UI/PG独立分工               | P03-A                             | MAIN9fc9b30，PR4，CI39737812114成功；[任务卡](tasks/P04-A.md)、[交接](handoffs/P04-A.md)                                                                                                                                                                                       |
| P04-B  | 正式单场改期与冲突复检                                 | DONE                    | root/API/UI/PG                             | P04-A、P05-A/B、P07-A             | MAINe3102e4，PR9，CI39871485940的497源码/165真实PG/12Mock＋18真实浏览器、40表重启及完整恢复成功；[任务](tasks/P04-B.md)、[交接](handoffs/P04-B.md)                                                                                                                             |
| P05    | 基础记分、赛果与观赛                                   | IN_PROGRESS             | root集成                                   | P04-A                             | P05-A/B已交付；可靠离线与专业统计另卡                                                                                                                                                                                                                                          |
| P05-A  | 基础在线记分、服务器时钟与独立确认                     | DONE                    | root/API/UI/PG                             | P04-A                             | MAIN3c0bf84，PR5，CI39743710053的212/88/12+10成功；[任务卡](tasks/P05-A.md)、[交接](handoffs/P05-A.md)                                                                                                                                                                         |
| P05-B  | 显式单循环排名与可撤销公开观赛                         | DONE                    | root/API/UI/PG                             | P05-A                             | MAINbd38318，PR6，CI39751848322的302/106/12＋12及37表重启／清理全成功；[任务卡](tasks/P05-B.md)、[交接](handoffs/P05-B.md)                                                                                                                                                     |
| P06    | OBS包装、直播与交付                                    | IN_PROGRESS             | root集成                                   | P05-A/B；真实视频需配置服务与预算 | P06-A及C05受控小视频/显式发布/人工定位已交付；原生OBS、云直播/大视频/转码仍待验收                                                                                                                                                                                              |
| P06-A  | 单场透明比分包装与独立只读授权                         | DONE                    | root/API/UI/PG                             | P05-A/B                           | MAINf8af5c9，PR7，最终CI39758913295的372／123／12＋14／39表重启与清理全部成功；[任务卡](tasks/P06-A.md)、[交接](handoffs/P06-A.md)                                                                                                                                             |
| P07-A  | 同源HTTPS自托管包与隔离备份恢复                        | DONE                    | root集成/API/UI/PG/打包                    | P06-A                             | MAIN82a3705，PR8，CI39827535301的432/140/12Mock＋18真实浏览器及完整恢复通过；[任务](tasks/P07-A.md)、[交接](handoffs/P07-A.md)                                                                                                                                                 |
| C01    | 商业版范围与实施顺序规划                               | REVIEW                  | root / Codex                               | 已交付P03/P04/P05/P06/P07         | MAIN文档（随PR10）；[商业规划](COMMERCIAL_PRODUCT_PLAN.md)、[任务](tasks/C01.md)、[交接](handoffs/C01.md)；C01是范围草案，实施另见C02                                                                                                                                          |
| C02    | 商业能力首轮并行实现与验收                             | DONE                    | root / API / UI / 排时 / 账号 / 导出       | C01及已交付模块                   | MAIN e5d4782；[PR10](https://github.com/xyq-dev/small-city-basketball/pull/10)、[任务](tasks/C02.md)、[交接](handoffs/C02.md)；CI39919192641三job成功：573源码/185真实PG/12Mock＋20真实浏览器、两模式重启及完整恢复；生产未更新                                                |
| C03    | 整届生命周期/历史观赛/私有球员基础榜                   | DONE                    | root/API/UI/独立审查                       | C02                               | MAIN 01f8ea4 PR11；[任务](tasks/C03.md)、[交接](handoffs/C03.md)；CI39941294620三job成功：660源码/202PG/12Mock＋20真实浏览器与完整恢复；合并后CI39942415842三job通过（无重试）                                                                                                 |
| C04    | 单淘汰赛签位/逐轮晋级/最终名次                         | DONE                    | root/API/UI/PG/浏览器/独立审查             | C03                               | MAIN 7ef18c9 PR12；[任务](tasks/C04.md)、[交接](handoffs/C04.md)，CI39975284464三job通过：749源码/217PG/12Mock＋22真实浏览器/41表完整恢复；合并后CI39976904075同范围全部通过（无重试），无生产部署                                                                             |
| C05    | 分组接淘汰、按届计费、微信及媒体                       | DONE                    | root及四域独立作者/UI/恢复/审查            | C04                               | MAIN d4f6500 [PR13](https://github.com/xyq-dev/small-city-basketball/pull/13)；[任务](tasks/C05.md)、[交接](handoffs/C05.md)；CI40001590258三job成功：914源码/11VM/254PG/12Mock＋28真实浏览器、15迁移/58表完整恢复；合并后CI40003519494同范围全部SUCCESS（无重试）；无生产部署 |
| D01    | 整套商业版Figma UI全景初稿                             | DONE（设计交付）        | root主画布/移动与运营只读协作/独立视觉复核 | 已有业务能力与商业规划            | [Figma](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=18-2)、[设计索引](design/COMMERCIAL_UI_FIGMA.md)、[任务](tasks/D01.md)、[交接](handoffs/D01.md)；本记录同步main仅文档，用户视觉签收/应用实现另卡                                                           |
| D02    | 小程序预约与球员数据UI补全                             | DONE（设计交付）        | root / 范围只读复核                        | D01、C06/C07                      | [Figma导览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2400)、[设计索引](design/MINI_PROGRAM_BOOKING_UI.md)、[任务](tasks/D02.md)、[交接](handoffs/D02.md)；99业务/状态+2辅助；设计阶段未执行应用测试；接续原生实现见C08，微信环境统一验收待办             |
| C06    | 球员赛事预约、逐场履约及UI                             | DONE                    | root / API / UI / 验证                     | C05、预约设计                     | MAIN7d23203 PR14；[任务](tasks/C06.md)、[使用](PLAYER_BOOKING_USAGE.md)、[证据](evidence/C06/README.md)、[交接](handoffs/C06.md)；最终CI40065953550完整通过，未部署生产                                                                                                        |
| C07    | 已授权球员数据与同价同位置对比                         | DONE                    | root / API / UI / PG / 独立审查            | C06、C03                          | MAIN7d23203 PR14；[任务](tasks/C07.md)、[交接](handoffs/C07.md)、[证据](evidence/C07/README.md)；1046源码/VM11/305PG/42浏览器、17迁移65表重启恢复通过，无生产部署                                                                                                              |
| C08    | 按D01/D02设计实现原生小程序页面                        | DONE（源码实现） / MAIN | root集成 / 六域独立作者与复核              | D01/D02、C06/C07                  | MAIN0d35d46 [PR15](https://github.com/xyq-dev/small-city-basketball/pull/15)；[任务](tasks/C08.md)、[交接](handoffs/C08.md)、[使用](../apps/wechat/README.md)、[预览/验收](evidence/C08/README.md)；225VM/90布局及CI40094090818三job通过；官方微信编译/真机未验，无生产部署    |

## 当前顺序

C08按稿原生实现已合并main（PR15），225VM/90兼容布局及完整隔离CI通过。接续按使用/交接在目标AppID、合法域名与真实微信环境做统一验收；不要把VM/Chromium或旧C06/C07 Web验收当作小程序真机结果。没有生产部署，旧库升级/外部支付、通知与资格核验仍按原范围另行推进。

C06/C07最终候选验收及PR14合并已完成，接续按实际环境补旧库隔离升级、部署和外部支付/微信/通知/身份核验联调；D01设计交付及C05外部环境待办继续有效。已实现的球员预约和数据UI以代码/真实PG/浏览器证据为准，不以设计原型替代测试，不将隔离验收等同生产发布。

C02/PR10、C03/PR11、C04/PR12与C05/PR13均已整合main。C05最终候选完整验收通过，合并后CI40003519494同范围全部SUCCESS（无重试）；自动CodeReview仍运行，不算通过，必要独立审查已完成。真实PG、源码/VM、Mock和浏览器证据分列见[当前状态](CURRENT_STATUS.md)及[C05验收](evidence/C05/README.md)。本轮无生产操作或正式账号变更。

下一步先补旧001–007完整FINAL赛事的隔离升级演练，再按实际环境推进真实微信客户端及商户支付退款对账联调；依赖资质、凭据和服务器通道的工作须如实列为外部阻塞。长期球员/赛季/专业统计、可靠离线、观众关注提醒与云直播/大视频/转码仍另卡，原生OBS依用户要求暂缓。服务器旧1534216部署仅为用户回传报告，不代表C02至C05已上线。
