# 任务看板

更新：2026-10-22（Asia/Shanghai）。集成人单写汇总；细节与证据见任务卡/交接。

| ID | 任务 | 状态 | 负责人 | 依赖 | 交付位置 |
|---|---|---|---|---|---|
| DOC000 | 私有仓库、初始说明与四组 UI | DONE | Codex / 初始化会话 | 无 | MAIN，源基线6911724 |
| DOC001 | 开发文档及多 AI 协作规范 | DONE | Codex | DOC000 | MAIN；[记录](handoffs/DOC001.md) |
| P01 | 机构后台四页 Mock 原型 | DONE | Codex | DOC001 | MAIN f15adb4，PR#1；[任务卡](tasks/P01.md) |
| P02 | 身份、机构与赛事基础后端 | DONE | Codex | P01 | MAIN29c4ee4，PR#2，CI39730670229成功；[任务卡](tasks/P02.md)、[交接](handoffs/P02.md) |
| P03 | 球队报名、资料与审核 | IN_PROGRESS | Codex集成 | P02 | 拆P03-A及后续文件/小程序；全P03未完成 |
| P03-A | Web球队、报名审核与名单冻结 | REVIEW | API/UI/独立PG测试分工，root集成 | P02 | BRANCH_ONLY dac9ebc，[PR#3](https://github.com/xyq-dev/small-city-basketball/pull/3)，CI39733327804运行中；本地97项通过 |
| P04 | 抽签、排赛与冲突检查 | TODO | 未认领 | P03冻结名单及规则 | 未实施 |
| P05 | 基础记分、赛果与观赛 | TODO | 未认领 | P04 | 未实施 |
| P06 | OBS包装、直播与交付 | TODO | 未认领 | P05；真实视频需配置服务与预算 | 未实施 |

## 当前顺序

P02 已验收关闭；P03-A已提交PR#3，正在真实PG及官方浏览器CI验收；失败修复并通过独立审查后再合并，未提前标DONE。保险文件、微信、视频服务缺少配置，不能用占位入口宣称已完成；不阻止先实现可独立验证的 Web 报名流程。

专业统计、个人集锦、赞助报告与年度套餐另拆有验收条件的任务。阶段规划与概念图不构成完成证据。
