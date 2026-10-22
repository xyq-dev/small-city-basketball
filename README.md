# 小城市篮球

**小城市，也有大主场。**

面向篮球赛事主办方、协会和场馆的商业赛事运营平台，贯通球队报名、抽签排赛、现场记分、数据展示和赛后交付。青锋杯是试点，产品支持不同机构独立办赛。

## 当前状态

2026-10-22：P01、P02、P03-A、P04-A、P05-A及P05-B均为 **DONE / MAIN**。[PR6](https://github.com/xyq-dev/small-city-basketball/pull/6)已合并，业务基线`bd38318fdfdbaeb9cfee1033c0d025e79c6cc797`。按[开发说明](docs/DEVELOPMENT.md)运行Mock或真实PostgreSQL Web后台：球队报名审核／冻结、单循环排赛、在线记分／服务器时钟／独立确认，以及显式排名规则和可撤销匿名观赛。

[CI39751848322](https://github.com/xyq-dev/small-city-basketball/actions/runs/39751848322)通过302项源码、106项独立真实PG、12Mock＋12API官方桌面／手机浏览器、格式／strict／构建、37表实际PG18.6重启及浏览器子库正常／失败清理。最新自动代码审查完成无finding；自动security未运行。001–005仅在隔离测试库执行，没有生产执行。首轮失败与修复见[P05-B交接](docs/handoffs/P05-B.md)。

## 首版目标范围

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

**接续任务：P06-A单场透明比分包装与独立只读授权**，合同已审查，按[任务卡](docs/tasks/P06-A.md)实施，尚无原生OBS验收。完整P03/P04仍有资料、小程序、其他赛制／自动排时／改期；可靠离线、专业统计、生产和真实视频另有后续范围。用户已授权项目范围内开发与同步，见AGENTS；Mock刷新重置，API失败不回Mock。

新 AI 会话先读 `AGENTS.md`、`docs/CURRENT_STATUS.md`、`docs/TASKS.md`，再读取分配到的任务卡；不要凭旧对话判断当前进度。
