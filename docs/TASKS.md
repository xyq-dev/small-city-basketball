# 任务看板

当前C07：球员数据与最多3人同价比较，`REVIEW / BRANCH_ONLY`。API/schema/UI/tests已整合，本地API534/首版前端442/最终13新增直接测试/类型/格式/build/VM11通过，桌面Mock及独立静态复核通过，真实PG与最终联合CI待验。[草稿PR14](https://github.com/xyq-dev/small-city-basketball/pull/14)已建立；C06基线隔离CI正在完成，历史推送审批阻塞已由最新明确授权解除。见[任务](tasks/C07.md)、[交接](handoffs/C07.md)；不把C06证据当新C07通过。

当前四项审查问题均已修复并静态CLEAR（最终99bf6e8）：原买方128配额、完整授权分页、跨页面/刷新原请求恢复，以及持久终态拒绝。root最终全类型/格式/npm test1039源码（505/534）＋VM11及两端build通过；新增预约30/数据19 PG须新完整候选CI。尚未解除四线程、合并或生产执行。

当前C06：`REVIEW / BRANCH_ONLY`，首基线CI40061888579三job完整成功、含新24PG/63表重启恢复；后续同PR的C07及审查修复等待新最终候选CI，尚未合并/上线。见[任务](tasks/C06.md)、[使用](PLAYER_BOOKING_USAGE.md)、[交接](handoffs/C06.md)。

当前D01：商业版Figma全景初稿已交付，设计DONE；[Figma导览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=18-2)、[任务](tasks/D01.md)、[交接](handoffs/D01.md)。10页/94张业务与状态画板，原生组件及核心浏览/阶段原型；用户视觉确认、前端新稿实现未完成。本批仅文档同步，不更新应用或生产。

当前C05：`DONE / MAIN`，PR13合并d4f6500，候选CI40001590258三job完整通过，合并后CI40003519494同范围全部SUCCESS（无重试）；root集成四域；[任务](tasks/C05.md)、[交接](handoffs/C05.md)。不把作者局部测试视为联合PG/浏览器或生产证据。

更新：2026-10-24（Asia/Shanghai）。集成人单写汇总；细节与证据见任务卡/交接。

| ID     | 任务                               | 状态        | 负责人                       | 依赖                              | 交付位置                                                                                                                           |
| ------ | ---------------------------------- | ----------- | ---------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| DOC000 | 私有仓库、初始说明与四组 UI        | DONE        | Codex / 初始化会话           | 无                                | MAIN，源基线6911724                                                                                                                |
| DOC001 | 开发文档及多 AI 协作规范           | DONE        | Codex                        | DOC000                            | MAIN；[记录](handoffs/DOC001.md)                                                                                                   |
| P01    | 机构后台四页 Mock 原型             | DONE        | Codex                        | DOC001                            | MAIN f15adb4，PR#1；[任务卡](tasks/P01.md)                                                                                         |
| P02    | 身份、机构与赛事基础后端           | DONE        | Codex                        | P01                               | MAIN29c4ee4，PR#2，CI39730670229成功；[任务卡](tasks/P02.md)、[交接](handoffs/P02.md)                                              |
| P03    | 球队报名、资料与审核               | IN_PROGRESS | Codex集成                    | P02                               | P03-A及C05私有文件/小程序有界入口已交付；完整自助资料/保险验证仍另卡                                                                                              |
| P03-A  | Web球队、报名审核与名单冻结        | DONE        | Codex集成，API/UI/PG独立分工 | P02                               | MAIN1c4b352，PR3，CI39735150535全部成功；[任务卡](tasks/P03-A.md)、[交接](handoffs/P03-A.md)                                       |
| P04    | 抽签、排赛与冲突检查               | IN_PROGRESS | root集成                     | P03-A                             | P04-A/B、C02自动排时建议、C04单淘汰及C05分组接淘汰已交付；全局优化及更多赛制另卡                                                                                           |
| P04-A  | 单循环对阵、手工排时与一次正式发布 | DONE        | Codex集成，API/UI/PG独立分工 | P03-A                             | MAIN9fc9b30，PR4，CI39737812114成功；[任务卡](tasks/P04-A.md)、[交接](handoffs/P04-A.md)                                           |
| P04-B | 正式单场改期与冲突复检 | DONE | root/API/UI/PG | P04-A、P05-A/B、P07-A | MAINe3102e4，PR9，CI39871485940的497源码/165真实PG/12Mock＋18真实浏览器、40表重启及完整恢复成功；[任务](tasks/P04-B.md)、[交接](handoffs/P04-B.md) |
| P05    | 基础记分、赛果与观赛               | IN_PROGRESS | root集成                     | P04-A                             | P05-A/B已交付；可靠离线与专业统计另卡                                                                                              |
| P05-A  | 基础在线记分、服务器时钟与独立确认 | DONE        | root/API/UI/PG               | P04-A                             | MAIN3c0bf84，PR5，CI39743710053的212/88/12+10成功；[任务卡](tasks/P05-A.md)、[交接](handoffs/P05-A.md)                             |
| P05-B  | 显式单循环排名与可撤销公开观赛     | DONE        | root/API/UI/PG               | P05-A                             | MAINbd38318，PR6，CI39751848322的302/106/12＋12及37表重启／清理全成功；[任务卡](tasks/P05-B.md)、[交接](handoffs/P05-B.md)         |
| P06    | OBS包装、直播与交付                | IN_PROGRESS | root集成                     | P05-A/B；真实视频需配置服务与预算 | P06-A及C05受控小视频/显式发布/人工定位已交付；原生OBS、云直播/大视频/转码仍待验收                                                                                               |
| P06-A  | 单场透明比分包装与独立只读授权     | DONE        | root/API/UI/PG               | P05-A/B                           | MAINf8af5c9，PR7，最终CI39758913295的372／123／12＋14／39表重启与清理全部成功；[任务卡](tasks/P06-A.md)、[交接](handoffs/P06-A.md) |
| P07-A | 同源HTTPS自托管包与隔离备份恢复 | DONE | root集成/API/UI/PG/打包 | P06-A | MAIN82a3705，PR8，CI39827535301的432/140/12Mock＋18真实浏览器及完整恢复通过；[任务](tasks/P07-A.md)、[交接](handoffs/P07-A.md) |
| C01 | 商业版范围与实施顺序规划 | REVIEW | root / Codex | 已交付P03/P04/P05/P06/P07 | MAIN文档（随PR10）；[商业规划](COMMERCIAL_PRODUCT_PLAN.md)、[任务](tasks/C01.md)、[交接](handoffs/C01.md)；C01是范围草案，实施另见C02 |
| C02 | 商业能力首轮并行实现与验收 | DONE | root / API / UI / 排时 / 账号 / 导出 | C01及已交付模块 | MAIN e5d4782；[PR10](https://github.com/xyq-dev/small-city-basketball/pull/10)、[任务](tasks/C02.md)、[交接](handoffs/C02.md)；CI39919192641三job成功：573源码/185真实PG/12Mock＋20真实浏览器、两模式重启及完整恢复；生产未更新 |
| C03 | 整届生命周期/历史观赛/私有球员基础榜 | DONE | root/API/UI/独立审查 | C02 | MAIN 01f8ea4 PR11；[任务](tasks/C03.md)、[交接](handoffs/C03.md)；CI39941294620三job成功：660源码/202PG/12Mock＋20真实浏览器与完整恢复；合并后CI39942415842三job通过（无重试） |
| C04 | 单淘汰赛签位/逐轮晋级/最终名次 | DONE | root/API/UI/PG/浏览器/独立审查 | C03 | MAIN 7ef18c9 PR12；[任务](tasks/C04.md)、[交接](handoffs/C04.md)，CI39975284464三job通过：749源码/217PG/12Mock＋22真实浏览器/41表完整恢复；合并后CI39976904075同范围全部通过（无重试），无生产部署 |
| C05 | 分组接淘汰、按届计费、微信及媒体 | DONE | root及四域独立作者/UI/恢复/审查 | C04 | MAIN d4f6500 [PR13](https://github.com/xyq-dev/small-city-basketball/pull/13)；[任务](tasks/C05.md)、[交接](handoffs/C05.md)；CI40001590258三job成功：914源码/11VM/254PG/12Mock＋28真实浏览器、15迁移/58表完整恢复；合并后CI40003519494同范围全部SUCCESS（无重试）；无生产部署 |
| D01 | 整套商业版Figma UI全景初稿 | DONE（设计交付） | root主画布/移动与运营只读协作/独立视觉复核 | 已有业务能力与商业规划 | [Figma](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=18-2)、[设计索引](design/COMMERCIAL_UI_FIGMA.md)、[任务](tasks/D01.md)、[交接](handoffs/D01.md)；本记录同步main仅文档，用户视觉签收/应用实现另卡 |
| C06 | 球员赛事预约、逐场履约及UI | REVIEW | root / API / UI / 验证 | C05、当前预约业务设计 | BRANCH_ONLY业务44ceb91；[任务](tasks/C06.md)、[使用](PLAYER_BOOKING_USAGE.md)、[证据](evidence/C06/README.md)、[交接](handoffs/C06.md)；基线完整CI通过，修复后候选待验/未上线 |
| C07 | 已授权球员数据与同价同位置对比 | REVIEW | root / API / UI / PG / 独立审查 | C06、C03已确认个人记录 | BRANCH_ONLY；017/65表、公开有限投影、提名/同意/撤销已整合；[任务](tasks/C07.md)、[交接](handoffs/C07.md)，UI已整合/联合CI待验 |

## 当前顺序

当前优先完成C06/C07修复后候选完整CI及审查后合并；D01设计交付及C05外部环境待办继续有效。已实现的球员预约和数据UI以代码/真实PG/浏览器证据为准，不以设计原型替代测试，不将隔离验收等同生产发布。

C02/PR10、C03/PR11、C04/PR12与C05/PR13均已整合main。C05最终候选完整验收通过，合并后CI40003519494同范围全部SUCCESS（无重试）；自动CodeReview仍运行，不算通过，必要独立审查已完成。真实PG、源码/VM、Mock和浏览器证据分列见[当前状态](CURRENT_STATUS.md)及[C05验收](evidence/C05/README.md)。本轮无生产操作或正式账号变更。

下一步先补旧001–007完整FINAL赛事的隔离升级演练，再按实际环境推进真实微信客户端及商户支付退款对账联调；依赖资质、凭据和服务器通道的工作须如实列为外部阻塞。长期球员/赛季/专业统计、可靠离线、观众关注提醒与云直播/大视频/转码仍另卡，原生OBS依用户要求暂缓。服务器旧1534216部署仅为用户回传报告，不代表C02至C05已上线。
