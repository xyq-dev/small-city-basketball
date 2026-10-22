# 小城市篮球

**小城市，也有大主场。**

面向篮球赛事主办方、协会和场馆的商业赛事运营平台，贯通球队报名、抽签排赛、现场记分、数据展示和赛后交付。青锋杯是试点，产品支持不同机构独立办赛。

## 当前状态

2026-10-22：P01、P02及P03-A均为 **DONE / MAIN**。[PR3](https://github.com/xyq-dev/small-city-basketball/pull/3)已合并，业务基线`1c4b352e4277af6a418ae46908d1aed0fcb01827`。按[开发说明](docs/DEVELOPMENT.md)运行显式Mock，或连接真实PostgreSQL的Web后台；身份/机构/赛事、外部领队邀请、球队成员、不可变报名名单、独立审核与冻结已验收。

[最终CI39735150535](https://github.com/xyq-dev/small-city-basketball/actions/runs/39735150535)通过100项单元/组件/HTTP、44项独立真实PG、12项Mock+6项真实API桌面/手机浏览器及构建，实际PG18.6重启保留授权、名单、freeze、审计及迁移校验和。证据见[P03-A交接](docs/handoffs/P03-A.md)与[TESTING](docs/TESTING.md)。001/002只在隔离测试库执行，没有生产部署、保险文件、微信、OBS或云服务接入。

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

**接续任务：[P04-A单循环排赛](docs/tasks/P04-A.md)**，状态按任务卡实时核验，目前只完成设计合同。全P03仍有资料/小程序范围，完整排赛、记分和OBS未完成。用户已授权项目范围内开发与同步，具体边界见AGENTS。Mock刷新重置；API使用真实数据库，失败不会静默退回Mock。

新 AI 会话先读 `AGENTS.md`、`docs/CURRENT_STATUS.md`、`docs/TASKS.md`，再读取分配到的任务卡；不要凭旧对话判断当前进度。
