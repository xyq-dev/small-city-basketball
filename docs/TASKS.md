# 任务看板

更新：2026-10-23（Asia/Shanghai）。集成人单写汇总；细节与证据见任务卡/交接。

| ID     | 任务                               | 状态        | 负责人                       | 依赖                              | 交付位置                                                                                                                           |
| ------ | ---------------------------------- | ----------- | ---------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| DOC000 | 私有仓库、初始说明与四组 UI        | DONE        | Codex / 初始化会话           | 无                                | MAIN，源基线6911724                                                                                                                |
| DOC001 | 开发文档及多 AI 协作规范           | DONE        | Codex                        | DOC000                            | MAIN；[记录](handoffs/DOC001.md)                                                                                                   |
| P01    | 机构后台四页 Mock 原型             | DONE        | Codex                        | DOC001                            | MAIN f15adb4，PR#1；[任务卡](tasks/P01.md)                                                                                         |
| P02    | 身份、机构与赛事基础后端           | DONE        | Codex                        | P01                               | MAIN29c4ee4，PR#2，CI39730670229成功；[任务卡](tasks/P02.md)、[交接](handoffs/P02.md)                                              |
| P03    | 球队报名、资料与审核               | IN_PROGRESS | Codex集成                    | P02                               | 拆P03-A及后续文件/小程序；全P03未完成                                                                                              |
| P03-A  | Web球队、报名审核与名单冻结        | DONE        | Codex集成，API/UI/PG独立分工 | P02                               | MAIN1c4b352，PR3，CI39735150535全部成功；[任务卡](tasks/P03-A.md)、[交接](handoffs/P03-A.md)                                       |
| P04    | 抽签、排赛与冲突检查               | IN_PROGRESS | root集成                     | P03-A                             | P04-A/B已交付；其他赛制/自动排时仍未完成                                                                                           |
| P04-A  | 单循环对阵、手工排时与一次正式发布 | DONE        | Codex集成，API/UI/PG独立分工 | P03-A                             | MAIN9fc9b30，PR4，CI39737812114成功；[任务卡](tasks/P04-A.md)、[交接](handoffs/P04-A.md)                                           |
| P04-B | 正式单场改期与冲突复检 | DONE | root/API/UI/PG | P04-A、P05-A/B、P07-A | MAINe3102e4，PR9，CI39871485940的497源码/165真实PG/12Mock＋18真实浏览器、40表重启及完整恢复成功；[任务](tasks/P04-B.md)、[交接](handoffs/P04-B.md) |
| P05    | 基础记分、赛果与观赛               | IN_PROGRESS | root集成                     | P04-A                             | P05-A/B已交付；可靠离线与专业统计另卡                                                                                              |
| P05-A  | 基础在线记分、服务器时钟与独立确认 | DONE        | root/API/UI/PG               | P04-A                             | MAIN3c0bf84，PR5，CI39743710053的212/88/12+10成功；[任务卡](tasks/P05-A.md)、[交接](handoffs/P05-A.md)                             |
| P05-B  | 显式单循环排名与可撤销公开观赛     | DONE        | root/API/UI/PG               | P05-A                             | MAINbd38318，PR6，CI39751848322的302/106/12＋12及37表重启／清理全成功；[任务卡](tasks/P05-B.md)、[交接](handoffs/P05-B.md)         |
| P06    | OBS包装、直播与交付                | IN_PROGRESS | root集成                     | P05-A/B；真实视频需配置服务与预算 | P06-A已交付，原生OBS／真实视频未验收                                                                                               |
| P06-A  | 单场透明比分包装与独立只读授权     | DONE        | root/API/UI/PG               | P05-A/B                           | MAINf8af5c9，PR7，最终CI39758913295的372／123／12＋14／39表重启与清理全部成功；[任务卡](tasks/P06-A.md)、[交接](handoffs/P06-A.md) |

| P07-A | 同源HTTPS自托管包与隔离备份恢复 | DONE | root集成/API/UI/PG/打包 | P06-A | MAIN82a3705，PR8，CI39827535301的432/140/12Mock＋18真实浏览器及完整恢复通过；[任务](tasks/P07-A.md)、[交接](handoffs/P07-A.md) |

| C01 | 商业版范围与实施顺序规划 | REVIEW | root / Codex | 已交付P03/P04/P05/P06/P07 | LOCAL_ONLY；[商业规划](COMMERCIAL_PRODUCT_PLAN.md)、[任务](tasks/C01.md)、[交接](handoffs/C01.md)；未实施新功能 |
| C02 | 商业能力首轮并行实现与验收 | REVIEW | root / API / UI / 排时 / 账号 / 导出 | C01及已交付模块 | LOCAL_ONLY；[任务](tasks/C02.md)、[交接](handoffs/C02.md)；用户已授权Git操作，四组代码及573源码检查通过，准备真实隔离CI，未上线 |

## 当前顺序

P07-A由PR8、P04-B由PR9合并，候选完整CI及审查通过。2026-10-23用户要求暂缓原生OBS；[P04-B正式单场改期](tasks/P04-B.md)为**DONE / MAIN**。后续服务器部署/隔离验收/本站门禁移除据用户回传Hermes报告已完成，证据类型见[当前状态](CURRENT_STATUS.md)，不是本会话独立实测。商业规划[C01](tasks/C01.md)后，六名Agent已在[C02](tasks/C02.md)实现首批私有逐人统计、自动排时建议、用户名登录/离线维护、公开SVG/CSV/打印；本地573源码测试、严格类型、构建及格式通过。下一步优先解除运行条件阻塞，核实本批Git操作授权后跑既有隔离CI，或在提供的隔离环境补真实PG/迁移升级/重启恢复/桌面手机浏览器。008/009与20项PG新用例未运行，不沿用旧SHA CI，也不在正式库验收。首批未标DONE，完整商业版其余范围继续单列。

专业统计、个人集锦、赞助报告与年度套餐另拆有验收条件的任务。阶段规划与概念图不构成完成证据。
