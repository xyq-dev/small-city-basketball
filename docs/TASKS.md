# 任务看板

更新：2026-10-22（Asia/Shanghai）。集成人单写汇总；细节与证据见任务卡/交接。

| ID | 任务 | 状态 | 负责人 | 依赖 | 交付位置 |
|---|---|---|---|---|---|
| DOC000 | 私有仓库、初始说明与四组 UI | DONE | Codex / 初始化会话 | 无 | MAIN，源基线6911724 |
| DOC001 | 开发文档及多 AI 协作规范 | DONE | Codex | DOC000 | MAIN；[记录](handoffs/DOC001.md) |
| P01 | 机构后台四页 Mock 原型 | DONE | Codex | DOC001 | MAIN f15adb4，PR#1；[任务卡](tasks/P01.md) |
| P02 | 身份、机构与赛事基础后端 | DONE | Codex | P01 | MAIN29c4ee4，PR#2，CI39730670229成功；[任务卡](tasks/P02.md)、[交接](handoffs/P02.md) |
| P03 | 球队报名、资料与审核 | IN_PROGRESS | Codex集成 | P02 | 拆P03-A及后续文件/小程序；全P03未完成 |
| P03-A | Web球队、报名审核与名单冻结 | DONE | Codex集成，API/UI/PG独立分工 | P02 | MAIN1c4b352，PR3，CI39735150535全部成功；[任务卡](tasks/P03-A.md)、[交接](handoffs/P03-A.md) |
| P04 | 抽签、排赛与冲突检查 | IN_PROGRESS | root集成 | P03-A | P04-A已交付；其他赛制/自动优化/改期仍未完成 |
| P04-A | 单循环对阵、手工排时与一次正式发布 | DONE | Codex集成，API/UI/PG独立分工 | P03-A | MAIN9fc9b30，PR4，CI39737812114成功；[任务卡](tasks/P04-A.md)、[交接](handoffs/P04-A.md) |
| P05 | 基础记分、赛果与观赛 | IN_PROGRESS | root集成 | P04-A | P05-A在线基础记分开工；排名/公开观赛/可靠离线另卡 |
| P05-A | 基础在线记分、服务器时钟与独立确认 | REVIEW | root/API/UI/PG | P04-A | BRANCH_ONLY；207本地检查通过，87PG/重启/官方浏览器待CI；[任务卡](tasks/P05-A.md)、[交接](handoffs/P05-A.md) |
| P06 | OBS包装、直播与交付 | TODO | 未认领 | P05；真实视频需配置服务与预算 | 未实施 |


## 当前顺序

P04-A已通过首轮完整CI合并main。P05-A已按任务卡认领，先提交显式规则、事件和幂等/主写租约共享契约，再并行API/UI/PG。P05-B排名/观赛与后续离线可靠性另卡；完整P03/P04遗留不以首卡冒充完成。保险文件、微信及视频服务仍需后续配置验收。

专业统计、个人集锦、赞助报告与年度套餐另拆有验收条件的任务。阶段规划与概念图不构成完成证据。
