# 任务看板

当前C05：`IN_PROGRESS / LOCAL_ONLY`，root集成四域；[任务](tasks/C05.md)、[交接](handoffs/C05.md)。不把作者局部测试视为联合PG/浏览器或生产证据。

更新：2026-10-23（Asia/Shanghai）。集成人单写汇总；细节与证据见任务卡/交接。

| ID     | 任务                               | 状态        | 负责人                       | 依赖                              | 交付位置                                                                                                                           |
| ------ | ---------------------------------- | ----------- | ---------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| DOC000 | 私有仓库、初始说明与四组 UI        | DONE        | Codex / 初始化会话           | 无                                | MAIN，源基线6911724                                                                                                                |
| DOC001 | 开发文档及多 AI 协作规范           | DONE        | Codex                        | DOC000                            | MAIN；[记录](handoffs/DOC001.md)                                                                                                   |
| P01    | 机构后台四页 Mock 原型             | DONE        | Codex                        | DOC001                            | MAIN f15adb4，PR#1；[任务卡](tasks/P01.md)                                                                                         |
| P02    | 身份、机构与赛事基础后端           | DONE        | Codex                        | P01                               | MAIN29c4ee4，PR#2，CI39730670229成功；[任务卡](tasks/P02.md)、[交接](handoffs/P02.md)                                              |
| P03    | 球队报名、资料与审核               | IN_PROGRESS | Codex集成                    | P02                               | 拆P03-A及后续文件/小程序；全P03未完成                                                                                              |
| P03-A  | Web球队、报名审核与名单冻结        | DONE        | Codex集成，API/UI/PG独立分工 | P02                               | MAIN1c4b352，PR3，CI39735150535全部成功；[任务卡](tasks/P03-A.md)、[交接](handoffs/P03-A.md)                                       |
| P04    | 抽签、排赛与冲突检查               | IN_PROGRESS | root集成                     | P03-A                             | P04-A/B、C02自动排时建议与C04单淘汰已交付；分组接淘汰/全局优化仍待实施                                                                                           |
| P04-A  | 单循环对阵、手工排时与一次正式发布 | DONE        | Codex集成，API/UI/PG独立分工 | P03-A                             | MAIN9fc9b30，PR4，CI39737812114成功；[任务卡](tasks/P04-A.md)、[交接](handoffs/P04-A.md)                                           |
| P04-B | 正式单场改期与冲突复检 | DONE | root/API/UI/PG | P04-A、P05-A/B、P07-A | MAINe3102e4，PR9，CI39871485940的497源码/165真实PG/12Mock＋18真实浏览器、40表重启及完整恢复成功；[任务](tasks/P04-B.md)、[交接](handoffs/P04-B.md) |
| P05    | 基础记分、赛果与观赛               | IN_PROGRESS | root集成                     | P04-A                             | P05-A/B已交付；可靠离线与专业统计另卡                                                                                              |
| P05-A  | 基础在线记分、服务器时钟与独立确认 | DONE        | root/API/UI/PG               | P04-A                             | MAIN3c0bf84，PR5，CI39743710053的212/88/12+10成功；[任务卡](tasks/P05-A.md)、[交接](handoffs/P05-A.md)                             |
| P05-B  | 显式单循环排名与可撤销公开观赛     | DONE        | root/API/UI/PG               | P05-A                             | MAINbd38318，PR6，CI39751848322的302/106/12＋12及37表重启／清理全成功；[任务卡](tasks/P05-B.md)、[交接](handoffs/P05-B.md)         |
| P06    | OBS包装、直播与交付                | IN_PROGRESS | root集成                     | P05-A/B；真实视频需配置服务与预算 | P06-A已交付，原生OBS／真实视频未验收                                                                                               |
| P06-A  | 单场透明比分包装与独立只读授权     | DONE        | root/API/UI/PG               | P05-A/B                           | MAINf8af5c9，PR7，最终CI39758913295的372／123／12＋14／39表重启与清理全部成功；[任务卡](tasks/P06-A.md)、[交接](handoffs/P06-A.md) |

| P07-A | 同源HTTPS自托管包与隔离备份恢复 | DONE | root集成/API/UI/PG/打包 | P06-A | MAIN82a3705，PR8，CI39827535301的432/140/12Mock＋18真实浏览器及完整恢复通过；[任务](tasks/P07-A.md)、[交接](handoffs/P07-A.md) |

| C01 | 商业版范围与实施顺序规划 | REVIEW | root / Codex | 已交付P03/P04/P05/P06/P07 | MAIN文档（随PR10）；[商业规划](COMMERCIAL_PRODUCT_PLAN.md)、[任务](tasks/C01.md)、[交接](handoffs/C01.md)；C01是范围草案，实施另见C02 |
| C02 | 商业能力首轮并行实现与验收 | DONE | root / API / UI / 排时 / 账号 / 导出 | C01及已交付模块 | MAIN e5d4782；[PR10](https://github.com/xyq-dev/small-city-basketball/pull/10)、[任务](tasks/C02.md)、[交接](handoffs/C02.md)；CI39919192641三job成功：573源码/185真实PG/12Mock＋20真实浏览器、两模式重启及完整恢复；生产未更新 |

| C03 | 整届生命周期/历史观赛/私有球员基础榜 | DONE | root/API/UI/独立审查 | C02 | MAIN 01f8ea4 PR11；[任务](tasks/C03.md)、[交接](handoffs/C03.md)；CI39941294620三job成功：660源码/202PG/12Mock＋20真实浏览器与完整恢复；合并后CI39942415842三job通过（无重试） |

| C04 | 单淘汰赛签位/逐轮晋级/最终名次 | DONE | root/API/UI/PG/浏览器/独立审查 | C03 | MAIN 7ef18c9 PR12；[任务](tasks/C04.md)、[交接](handoffs/C04.md)，CI39975284464三job通过：749源码/217PG/12Mock＋22真实浏览器/41表完整恢复；合并后CI39976904075同范围全部通过（无重试），无生产部署 |

## 当前顺序

C02/PR10、C03/PR11与C04/PR12均已整合main。C04最终候选完整验收通过，合并后CI39976904075三个job同范围全部SUCCESS（无重试）；见[当前状态](CURRENT_STATUS.md)。本轮无生产操作或正式账号变更，完整商业版尚未完成。下一项分组循环接淘汰，先冻结分组/同分/跨组比较/晋级签位/权限/更正规则，再沿原授权/比赛/确认和淘汰凭证实施。

P03/P04/P05完整范围、长期球员/赛季及高级统计、资料文件、观众中心/微信、商业套餐/订单/支付退款对账、真实媒体继续单列；原生OBS仍按用户要求暂缓。服务器部署验收报告是用户回传的旧1534216，不等于C02/C03已上线。
