# 任务看板

## C23 本人报名资料与人工审核

2026-10-31 Asia/Shanghai；唯一集成人 Codex root。状态 **DONE / MAIN（源码与隔离验收）**；PR32合入09348e3，精确候选CI41096252199和合并后[main CI41099428902](https://github.com/xyq-dev/small-city-basketball/actions/runs/41099428902)均完整SUCCESS，三job全绿。本轮按用户要求测试合并分支，实际main完整日志及最终状态已核验；恢复点G.3。没有未合并业务改动，本轮只更新验证记录。

| 切片 | 交付 | 状态 |
| --- | --- | --- |
| A | 差异设计、隐私/状态契约、开工检查点 | DONE / MAIN |
| B | 本人材料、私有照片、外部保单人工审核及报名门槛 | DONE / MAIN；C23 PG13/13 |
| C | 小程序本人填写/审核入口、联合验证与整合 | DONE / MAIN；完整CI通过，官方微信/真机待验 |

[任务](tasks/C23.md)／[恢复入口](handoffs/C23.md)。每个可验证切片同步代码、已执行验证和下一条操作；未同步不写为已共享。在线保险、支付、季军赛、生产部署及真机不在本卡实现范围。

## C21／C22 标准地区目录

2026-10-30 Asia/Shanghai，负责人及集成人 Codex。

| ID  | 范围                                                    | 状态                     | 验收／后续                                                                           |
| --- | ------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| C21 | 地区目录与旧标签兼容设计                                | DONE / MAIN 文档；PR #30 | 原方案保留；实施交给 C22 Codex                                                       |
| C22 | 固定 CC0 数据、Migration 023、API、主办方更正与标准选地 | DONE / MAIN | PR #31 已合并83ae15a；候选及合并后CI均成功；[任务](tasks/C22.md)、[交接](handoffs/C22.md) |

GPS、乡镇、附近服务、生产及官方微信／真机仍独立待办，不由标准地区目录覆盖。


## C20 选城与公开赛事发现

2026-10-30 Asia/Shanghai；负责人及集成人Codex。[任务](tasks/C20.md)、[交接](handoffs/C20.md)。PR #29已合并，代码候选695cac3的完整CI通过，merge tree相同。

| ID | 闭环 | 状态 | 后续 |
| --- | --- | --- | --- |
| C20 | 手动城市标签／全国、首页匿名赛事、最近选择和跨页同步 | DONE / MAIN（源码与隔离验收） | 先做行政区目录及旧城市标签的兼容设计，再接GPS与附近供给；微信真机待验 |

DOC004仅部分实施，G01—G15及全部定位服务未整体验收；C20不代表行政区、地图或真实供给已接入。既有照片保险、外部服务与生产待办保持。

## DOC004 定位选城、附近发现与服务可预约性

2026-10-30 Asia/Shanghai；负责人及集成人：本次Codex会话。[专项要求](design/LOCATION_SERVICE_REQUIREMENTS.md)、[任务](tasks/DOC004.md)、[交接](handoffs/DOC004.md)。

| ID | 任务 | 交付状态 | 下一步 |
| --- | --- | --- | --- |
| DOC004 | 官方资料研究、选城与附近交互、服务地点和覆盖规则、异常与验收要求 | DONE / MAIN文档交付；新增业务未实施 | 先做地区目录和手动选城差异设计；定位准入、真实供给及G01—G15另行实现和验证 |

本轮不修改既有业务、权限、支付、照片保险或订单合同；8个逻辑交互态不代表已新增页面，15项验收为计划。地图地点、定位成功与可预约供给分别判断。

## DOC003 管理员办赛、球员本人报名与必传照片

2026-10-29 Asia/Shanghai；负责人及集成人：本次Codex会话。[专项要求](design/EVENT_REGISTRATION_PHOTO_REQUIREMENTS.md)、[任务](tasks/DOC003.md)、[交接](handoffs/DOC003.md)。

| ID | 任务 | 交付状态 | 下一步 |
| --- | --- | --- | --- |
| DOC003 | 8队办赛、必传本人照片、私有相貌核对、宣传授权、保险与资格流程 | 需求文档及C23本人资料/照片/外部保单切片已合入 | 邀请招募、季军赛、海报和真实投保等剩余范围另卡，不将R01—R12全标通过 |

本轮不调整已完成C13—C19的状态，也不把需求补充算作新功能验收。照片上传为必填；宣传公开用途须单独授权。C23已补既有名单中的本人资料/外部保单人工核验，未启用该流程的旧身份/保险门槛仍保留；季军赛、真实投保等未完成。

## DOC002 全国平台与同城服务需求文档

更新：2026-10-29 Asia/Shanghai；本轮仅文档，负责人及集成人为本次Codex会话。完整内容见 [NATIONWIDE_LOCAL_REQUIREMENTS.md](NATIONWIDE_LOCAL_REQUIREMENTS.md)，执行记录见 [任务](tasks/DOC002.md) 与 [交接](handoffs/DOC002.md)。

| ID | 任务 | 交付范围 | 负责人 | 依赖与后续 |
| --- | --- | --- | --- | --- |
| DOC002 | 全国平台＋同城服务完整功能要求与入口同步 | DONE / MAIN 文档交付；不代表全国化功能DONE | Codex | 已核对main基线及24页方案；后续先做现有实现差异评估，再建实施卡 |

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
| C19    | 小程序媒体恢复、球队成员、私有赛季、关注与完整隔离验收 | DONE / MAIN    | Codex 集成及模块复核                       | C18 / PR #27                      | MAIN f97bb4b，[PR #22](https://github.com/xyq-dev/small-city-basketball/pull/22) 已整合 #23—#28；[任务](tasks/C19.md)、[交接](handoffs/C19.md)；源码与隔离验证完成，官方微信/真机待验，未部署                                                                                                     |
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
