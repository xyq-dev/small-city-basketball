# 小城市篮球

**小城市，也有大主场。**

面向篮球赛事主办方、协会和场馆的商业赛事运营平台，贯通球队报名、抽签排赛、现场记分、数据展示和赛后交付。青锋杯是试点，产品支持不同机构独立办赛。

## 当前状态

2026-10-23：P01、P02、P03-A、P04-A、P05-A、P05-B、P06-A及P07-A均为 **DONE / MAIN**。按[开发说明](docs/DEVELOPMENT.md)运行Mock或真实PostgreSQL Web后台：报名审核／冻结、单循环排赛、在线记分／服务器时钟／独立确认、显式排名及匿名观赛，并可签发1920×1080透明比分浏览器源。

[PR7](https://github.com/xyq-dev/small-city-basketball/pull/7)已合并为`f8af5c99fba294a40334c49a5d2e32f80c6acbf9`，源`addeb8f38c016ea60d3a9c3bd7de3e34e1c70d11`／tree`2a719b4b3e8fd4f67996144c687f5bbb72902519`。最终[CI39758913295](https://github.com/xyq-dev/small-city-basketball/actions/runs/39758913295)两job全部成功：372源码（admin171/API201）、123独立PG、12Mock＋7桌面／7手机真实API、格式／完整strict／两端build、001→006与checksum、实际PG18.6重启39表指纹，正常及故意失败子库清理均通过且control保留。官方Chromium151.0.7922.34；完整日志已读。自动addeb CodeReview completed无finding，旧文档P2已resolved/outdated；security未运行。 001–006只在隔离测试库执行，没有生产执行。

P07-A已由[PR8](https://github.com/xyq-dev/small-city-basketball/pull/8)合并`82a3705001da50f60655b07d6174b50f4d84266f`；[CI39827535301](https://github.com/xyq-dev/small-city-basketball/actions/runs/39827535301)三job全成功：432源码、140真实PG、12Mock＋18真实API/HTTPS浏览器。交付三非root镜像、同源HTTPS、分离DB身份、显式首owner与完整隔离备份恢复；实际API换IP/Web不变、39表恢复一致及旧授权隔离通过。[自托管说明](ops/templates/README.md)。这是可运行交付包和隔离CI证据，未生产部署、未验原生OBS/CEF；合并后CI结果见当前状态。

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

**接续任务：P07-A同源HTTPS自托管包与隔离备份恢复**，按[任务卡](docs/tasks/P07-A.md)实施。尚无原生OBS／CEF或生产验收。完整P03/P04仍有资料、小程序、其他赛制／自动排时／改期；可靠离线、专业统计和真实视频另卡。用户已授权项目范围内开发与同步，见AGENTS；Mock刷新重置，API失败不回Mock。

新 AI 会话先读 `AGENTS.md`、`docs/CURRENT_STATUS.md`、`docs/TASKS.md`，再读取分配到的任务卡；不要凭旧对话判断当前进度。
