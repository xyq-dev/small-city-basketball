# 小城市篮球

**小城市，也有大主场。**

面向篮球赛事主办方、协会和场馆的商业赛事运营平台，贯通球队报名、抽签排赛、现场记分、数据展示和赛后交付。青锋杯是试点，产品支持不同机构独立办赛。

## 当前状态

2026-10-22：P01 机构后台四页 Mock 原型已通过 [PR #1](https://github.com/xyq-dev/small-city-basketball/pull/1) 合并到 `main`，整合提交 `f15adb456c24302ce3d41587c41301e4c3931c6c`。现在可以克隆仓库，按[开发说明](docs/DEVELOPMENT.md)安装并运行。P02 机构与赛事基础后端已开始开发，尚未完成验收；没有部署或真实支付、保险、数据库及 OBS 服务接入。

已整合成果包括工作总览、赛事列表、创建草稿及详情编辑；[远端 Application checks](https://github.com/xyq-dev/small-city-basketball/actions/runs/39728632742) 已通过安装、格式、类型、35项单测/组件测试、构建及官方 Chromium 的12项端到端检查。详见 [P01 验证与截图](docs/evidence/P01/README.md)、[交接记录](docs/handoffs/P01.md)和[开发说明](docs/DEVELOPMENT.md)。这只是首阶段原型，完整项目仍需 P02–P06。

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

**当前交付：P01 为 DONE / MAIN；当前重点为 P02，状态 IN_PROGRESS。** 用户已授权开发与仓库同步，具体边界见 `AGENTS.md`。机构权限与基础后端尚待验证，报名、排赛、记分及 OBS 依次接入。原型使用明确标注的内存 Mock 数据，刷新重置。

新 AI 会话先读 `AGENTS.md`、`docs/CURRENT_STATUS.md`、`docs/TASKS.md`，再读取分配到的任务卡；不要凭旧对话判断当前进度。
