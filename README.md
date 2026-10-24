# 小城市篮球

**小城市，也有大主场。**

面向篮球赛事主办方、协会和场馆的商业赛事运营平台，贯通球队报名、抽签排赛、现场记分、数据展示和赛后交付。青锋杯是试点，产品支持不同机构独立办赛。

## 当前状态

C06球员赛事预约已在独立任务分支实现五类预约、多球员逐场履约、10%报价快照及球员/运营UI，尚未合并或上线；类型/构建/源码和桌面Mock交互已验证，真实PG/CI受环境与推送审批阻塞，真实撮合支付/分账保持关闭。入口和准确边界见[预约使用说明](docs/PLAYER_BOOKING_USAGE.md)与[C06交接](docs/handoffs/C06.md)，不要将本地演示当作真实收款或生产验收。

最新增量：[C05](docs/tasks/C05.md)/[PR13](https://github.com/xyq-dev/small-city-basketball/pull/13)已合并main `d4f6500`：分组循环接淘汰、按届软件服务费与独立双人收退款、默认关闭的微信支付适配/微信账号绑定与原生小程序源码、受控附件和短视频发布/人工定位。最终[CI40001590258](https://github.com/xyq-dev/small-city-basketball/actions/runs/40001590258)三个job成功：914源码、11小程序VM、254真实PG、12Mock＋28真实浏览器、15迁移及58表完整恢复；合并后[CI40003519494](https://github.com/xyq-dev/small-city-basketball/actions/runs/40003519494)三个job同范围全部SUCCESS（无重试），完整日志已核对。准确证据见[当前状态](docs/CURRENT_STATUS.md)，入口见[使用指南](docs/COMMERCIAL_USAGE.md)。本轮未部署生产；真实微信/商户支付、云直播/大视频/转码、专业统计及原生OBS/CEF仍有未验证或后续范围，完整商业平台尚未完成。

2026-10-23：P01、P02、P03-A、P04-A/B、P05-A/B、P06-A及P07-A均为 **DONE / MAIN**。按[开发说明](docs/DEVELOPMENT.md)运行Mock或真实PostgreSQL Web后台：报名审核／冻结、单循环排赛／正式单场改期、在线记分／服务器时钟／独立确认、显式排名及匿名观赛，并可签发1920×1080透明比分浏览器源。

以下PR7/PR8段保留对应版本的历史验收范围；服务器旧1534216部署是用户回传报告，见CURRENT_STATUS，不等于C02至C05已上线。

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

机构后台及现场工作台采用 React + Vite + TypeScript，后端采用 NestJS + PostgreSQL，沿用模块化单体。C05的 `apps/wechat` 是原生小程序源码（JS/WXML/WXSS）；早期Taro方向不代表当前实现。依赖由仓库锁定。

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
