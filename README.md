# 小城市篮球

**小城市，也有大主场。**

面向篮球赛事主办方、协会和场馆的商业赛事运营平台，贯通球队报名、抽签排赛、现场记分、数据展示和赛后交付。青锋杯是试点，产品支持不同机构独立办赛。

## 当前状态

2026-10-22：P01、P02 均为 **DONE / MAIN**。[PR #2](https://github.com/xyq-dev/small-city-basketball/pull/2) 已合并，交付基线为 `29c4ee4cf588e911b2e087224522b832b726d18e`。现在可按[开发说明](docs/DEVELOPMENT.md)运行 Mock 演示或连接真实 PostgreSQL 的 Web 后台；注册登录、机构权限、赛事草稿保存与编辑已验收。

[P02 远端 CI](https://github.com/xyq-dev/small-city-basketball/actions/runs/39730670229) 已通过71项单测/组件/HTTP检查、20项独立真实数据库集成场景及12项Mock＋4项真实API浏览器测试，并验证 PostgreSQL 重启后的持久化。证据见[P02交接](docs/handoffs/P02.md)与[测试说明](docs/TESTING.md)。Migration001只在隔离测试库执行，尚无生产部署、生产数据库或真实保险、微信、OBS及云服务接入。

## 首版范围

- 多机构与赛事管理，机构数据隔离、工作人员权限。
- 球队长期档案和每届赛事独立报名名单，资料审核、外购保险凭证提交。
- 分组抽签、循环赛与淘汰赛，休息间隔及赛程冲突检查。
- 基础记分、节次、犯规、暂停、操作撤销和赛果确认。
- 赛程、积分榜与分享海报，机构套餐可先人工开通。
- 为 OBS 比分包装预留数据接口；直播、专业统计和视频集锦分阶段接入。

## 技术方向

微信小程序采用 Taro + React + TypeScript；机构后台及现场工作台采用 React + Vite + TypeScript；后端采用 NestJS + PostgreSQL，使用模块化单体架构。依赖版本在实施时核验并锁定。

OBS 负责采集、导播和推流。平台提供只读的赛事比分包装页面，通过 OBS 浏览器源接入；比分、节次和计时以记分系统为准。自动切场、远程控制及云直播分发后续实施，OBS 断开不能阻断比赛记录。

## 设计与开发入口

- **[项目开发总文档](docs/PROJECT_DEVELOPMENT.md)**：产品、架构、数据、API、实施计划与协作的统一入口。
- **[多 AI 协作流程](docs/COLLABORATION.md)**：开工、认领、检查点、验证、交接与文档同步要求。
- [任务看板](docs/TASKS.md)
- [首版 UI 概念图](docs/design/README.md)
- [当前状态与下一项任务](docs/CURRENT_STATUS.md)
- [开发协作规则](AGENTS.md)

**下一项：P03-A Web 报名闭环，TODO／待开工。** P03 整体、排赛、记分和 OBS 仍未完成。用户已授权项目范围内开发与同步，具体边界见 `AGENTS.md`。Mock模式仍为刷新重置；API模式使用真实数据库，失败不会静默退回Mock。

新 AI 会话先读 `AGENTS.md`、`docs/CURRENT_STATUS.md`、`docs/TASKS.md`，再读取分配到的任务卡；不要凭旧对话判断当前进度。
