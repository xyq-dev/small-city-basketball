# 小城市篮球

**小城市，也有大主场。**

目标定位为全国篮球赛事与同城服务平台：全国发现赛事、观赛与查询数据，同城连接球队、球员、球场及赛事服务。统一账号、多机构管理，高州／石鼓作为首个运营样板。

## 全国平台与同城服务功能要求

最新完整目标见 **[功能要求文档](docs/NATIONWIDE_LOCAL_REQUIREMENTS.md)**，简要基线见 [产品需求](docs/PRODUCT_REQUIREMENTS.md)。采用首页／赛事／同城／球队／我的五项导航，定位不限制跨城浏览；全国机构可申请入驻，交易服务按真实供给逐城开放。

全国化需求文档描述目标能力，不表示全部全国化功能、真实支付或当地服务已上线。当前源码、隔离验收与官方微信／真机待办统一读 [当前状态](docs/CURRENT_STATUS.md)；下列旧版本说明保留为历史交付记录。

## 小程序直接开播与多平台分发设计

新增 [直播专项设计](docs/design/MINI_PROGRAM_MULTIPLATFORM_LIVE.md)：手机在小程序内采集摄像头和麦克风，单路上行至云端，合成权威比分后向多个已授权平台分发；OBS为后续可选输入，不是首版必经环节。含开播／预检／直播／恢复／结束／观赛交互、独立渠道状态、权限与成本、分期及验收要求。

本次仅DOC005设计文档，未开发或开启直播；微信推流准入、外部平台账号与同播权限、供应商及费用均待核验，不承诺所有平台可用。工作安排见 [DOC005任务](docs/tasks/DOC005.md) 和 [交接](docs/handoffs/DOC005.md)。

## 最新源码交付 C23

[PR32](https://github.com/xyq-dev/small-city-basketball/pull/32)已将既有名单中的本人报名资料、私有照片和外部保单独立人工审核合入main。精确候选完整隔离CI通过；生产、官方微信/真机与在线投保未交付。最新事实和后续任务见[当前状态](docs/CURRENT_STATUS.md)，断点恢复读[C23交接](docs/handoffs/C23.md)。开发期间每个可验证代码切片同步代码与工作安排，活跃时最迟15分钟留检查点。

## 历史交付摘要

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
