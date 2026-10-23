# 小城市篮球

**小城市，也有大主场。**

面向篮球赛事主办方、协会和场馆的商业赛事运营平台，贯通球队报名、抽签排赛、现场记分、数据展示和赛后交付。青锋杯是试点，产品支持不同机构独立办赛。

## 当前状态

最新增量：[C02](docs/tasks/C02.md)/PR10与[C03](docs/tasks/C03.md)/[PR11](https://github.com/xyq-dev/small-city-basketball/pull/11)已合并。新增私有逐人基础统计、更正/确认、自动排时建议、用户名登录维护、公开SVG/CSV/打印，以及整届完赛/归档/重开、独立显式历史观赛和私有球员基础数据榜。C03最终CI39941294620的660源码、202真实PG、桌面/手机模拟浏览器和40表完整恢复通过；合并后CI39942415842同范围全部通过（无重试），证据及准确边界见[当前状态](docs/CURRENT_STATUS.md)。本轮未部署生产，完整商业版尚未完成；原生OBS/CEF、其他赛制、专业统计、微信、支付与真实媒体仍另项推进。

2026-10-23：P01、P02、P03-A、P04-A/B、P05-A/B、P06-A及P07-A均为 **DONE / MAIN**。按[开发说明](docs/DEVELOPMENT.md)运行Mock或真实PostgreSQL Web后台：报名审核／冻结、单循环排赛／正式单场改期、在线记分／服务器时钟／独立确认、显式排名及匿名观赛，并可签发1920×1080透明比分浏览器源。

以下PR7/PR8段保留对应版本的历史验收范围；服务器旧1534216部署是用户回传报告，见CURRENT_STATUS，不等于C02/C03已上线。

[PR7](https://github.com/xyq-dev/small-city-basketball/pull/7)已合并为`f8af5c99fba294a40334c49a5d2e32f80c6acbf9`，源`addeb8f38c016ea60d3a9c3bd7de3e34e1c70d11`／tree`2a719b4b3e8fd4f67996144c687f5bbb72902519`。最终[CI39758913295](https://github.com/xyq-dev/small-city-basketball/actions/runs/39758913295)两job全部成功：372源码（admin171/API201）、123独立PG、12Mock＋7桌面／7手机真实API、格式／完整strict／两端build、001→006与checksum、实际PG18.6重启39表指纹，正常及故意失败子库清理均通过且control保留。官方Chromium151.0.7922.34；完整日志已读。自动addeb CodeReview completed无finding，旧文档P2已resolved/outdated；security未运行。 001–006只在隔离测试库执行，没有生产执行。

P07-A已由[PR8](https://github.com/xyq-dev/small-city-basketball/pull/8)合并`82a3705001da50f60655b07d6174b50f4d84266f`；[CI39827535301](https://github.com/xyq-dev/small-city-basketball/actions/runs/39827535301)三job全成功：432源码、140真实PG、12Mock＋18真实API/HTTPS浏览器。交付三非root镜像、同源HTTPS、分离DB身份、显式首owner与完整隔离备份恢复；实际API换IP/Web不变、39表恢复一致及旧授权隔离通过。[自托管说明](ops/templates/README.md)。这是该版本交付包与隔离CI证据，该轮未执行生产部署、未验原生OBS/CEF；合并后CI结果见当前状态。

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

**历史交付：P04-B正式单场改期与冲突复检（DONE / MAIN）**，[PR9](https://github.com/xyq-dev/small-city-basketball/pull/9)已合并`e3102e4090cd09158f6a9f8cb30a00fee57b14b9`。[最终CI39871485940](https://github.com/xyq-dev/small-city-basketball/actions/runs/39871485940)三job全部成功：497源码、165真实PG、12Mock＋14真实API＋4可信HTTPS浏览器，40表实际重启与完整隔离恢复；详见[任务](docs/tasks/P04-B.md)及[交接](docs/handoffs/P04-B.md)。用户要求暂缓原生OBS并先推进其余能力；原生OBS／CEF、真机Safari/微信与生产未验证。完整P03/P04仍有资料、小程序、其他赛制；可靠离线、专业统计和真实视频另卡，整个平台未完成。用户已授权项目范围内开发与同步，见AGENTS；Mock刷新重置，API失败不回Mock。

新 AI 会话先读 `AGENTS.md`、`docs/CURRENT_STATUS.md`、`docs/TASKS.md`，再读取分配到的任务卡；不要凭旧对话判断当前进度。
