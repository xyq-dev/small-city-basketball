# C10 整套原生小程序视觉验收

21页实现与兼容截图已完成，等待用户统一视觉签收。源码PR16已合并main7607c28，最终完整隔离CI40156690255三job全部SUCCESS；官方微信开发者工具/真机未验。

[下载整套截图验收包](https://chatgpt.com/library?file_id=libfile_8e169efe9158819184379dccc5150f1f&account_id=personal)（当前账号文件，ZIP约27.2MB）。解压打开index.html：21页原稿与正常界面并列，其余状态按页展开；checklist.csv可填写验收意见。

- 最终源码486d5d9cf1befc06be64b955e60288bd9c38b9f3，完整tree9964b4cbee56699587af159c39d483ba2f88a5d0，apps子树f366a47dae45fbf08857d1b4c339ee0658922755。
- [CI40156690255](https://github.com/xyq-dev/small-city-basketball/actions/runs/40156690255)：admin/API/production三job全部SUCCESS（无重试）；包内verification保留打包时点快照，此处补记最终终态。admin含512 Web+534 API源码测试、271原生、654原生布局；浏览器668通过、654重复mobile布局skip；格式、typecheck、build与证据检查通过。
- artifact12585381105（mini-program-layouts），ZIP117643440字节，SHA256 `75fe9e9638e134db38d015520f759a40ed15d063109e29deacf1775cd3b06cfb`，已下载并校验同源head486d5d9。
- 交付包460张实际界面PNG、21份原稿、654份三宽JSON、113份390滚动位置记录；包括全部390状态及21正常页三宽，其他320/430状态PNG留在原CI artifact，不声称包内全有。ZIP27168470字节，SHA256 `39cfc6cca387a3c7bea749b3e3eec8856ee0853ae7c58647e3c3a08b0f4c53d7`。
- 长页按600px步长捕获844px原始viewport，保留top/bottom及中段和scrollY，不拼接、不交付iframe裁切的空白长图。全部PNG尺寸/目录链接/文件SHA检查通过，layout finding为0。

原生页面全部是真实WXML/WXSS，动态示例均为合成数据，不是用Figma截图代替界面。微信引擎、原生组件、标题、安全区与真机仍需目标环境验证，用户视觉签收单列待定。详见[视觉复核](VISUAL_REVIEW.md)、[来源核验](verification.json)、[主图哈希索引](screenshots/index.json)及[逐页映射](../../../tests/mini-program/visual-catalog.json)。

| 页面 | 本轮390截图 | Figma原稿 | 映射 |
| --- | --- | --- | --- |
| 预约首页 | [查看](screenshots/home-390.png) | [原稿](references/home.png) · 30:35 | adapted |
| 观赛入口 | [查看](screenshots/watch-390.png) | [原稿](references/watch.png) · 9:58 | derived |
| 视频入口 | [查看](screenshots/media-390.png) | [原稿](references/media.png) · 9:421 | derived |
| 我的账号 | [查看](screenshots/account-390.png) | [原稿](references/account.png) · 30:2358 | derived |
| 赛事观赛 | [查看](screenshots/event-390.png) | [原稿](references/event.png) · 9:58 | direct |
| 单场比赛 | [查看](screenshots/match-390.png) | [原稿](references/match.png) · 9:155 | direct |
| 找球员 | [查看](screenshots/players-390.png) | [原稿](references/players.png) · 30:78 | adapted |
| 球员档案 | [查看](screenshots/player-390.png) | [原稿](references/player.png) · 30:168 | adapted |
| 球员对比 | [查看](screenshots/compare-390.png) | [原稿](references/compare.png) · 30:333 | adapted |
| 创建预约 | [查看](screenshots/booking-create-390.png) | [原稿](references/booking-create.png) · 30:552 | adapted |
| 预约列表 | [查看](screenshots/bookings-390.png) | [原稿](references/bookings.png) · 30:1027 | adapted |
| 预约与逐场履约 | [查看](screenshots/booking-detail-390.png) | [原稿](references/booking-detail.png) · 30:1114 | adapted |
| 球员中心 | [查看](screenshots/player-center-390.png) | [原稿](references/player-center.png) · 30:1731 | adapted |
| 数据授权 | [查看](screenshots/performance-390.png) | [原稿](references/performance.png) · 30:1938 | adapted |
| 我的球队 | [查看](screenshots/teams-390.png) | [原稿](references/teams.png) · 9:818 | direct |
| 球队详情 | [查看](screenshots/team-390.png) | [原稿](references/team.png) · 9:863 | adapted |
| 赛事报名 | [查看](screenshots/registration-events-390.png) | [原稿](references/registration-events.png) · 9:982 | direct |
| 报名与本届名单 | [查看](screenshots/entry-390.png) | [原稿](references/entry.png) · 9:1028 | adapted |
| 接受球队邀请 | [查看](screenshots/invitation-390.png) | [原稿](references/invitation.png) · 9:1248 | derived |
| 资金与规划 | [查看](screenshots/planned-390.png) | [原稿](references/planned.png) · 30:2471 | derived |
| 平台处理 | [查看](screenshots/platform-390.png) | [原稿](references/platform.png) · 30:1535 | derived |

## 原稿适配与业务边界

21页分别注明direct/adapted/derived；入口、邀请、平台处理、账号/规划等合并状态不宣称有一张独立画板逐像素对应。未采集篮板/助攻/评分不编造，真实0/未统计/不可用和来源分母保留；长期成员不造球衣字段，邀请无预览不造球队/角色/到期。完整费用、声明、权限、写锁和原编号恢复未简化。静态页N/A列入catalog，不虚构异步状态。资金、消息、长期档案未启用部分仍禁用，真实资金为0。

开发复核覆盖21normal和代表状态；修复球队标签折行及长图空白问题后，最终候选全量重拍。19张正常390图与首轮逐字节相同；球队新三宽逐图通过；邀请仅输入框圆角16/29个像素的轻微栅格化差异。球员/履约20张中段40个相邻重叠区逐像素一致；不把局部几何/人工抽查描述为全部状态像素一致。

复现打包工具位于[证据分支](https://github.com/xyq-dev/small-city-basketball/tree/evidence/c10-mini-ui-complete/scripts/package-mini-visual-acceptance.mjs)，仅做原文件整理和校验。主干交付文档/截图不修改应用逻辑；工具27项检查、语法/格式和本轮真实artifact打包已通过。没有生产部署、生产库或Migration、新凭据或付费资源。


源码合并tree与已检候选精确相同：9964b4cbee56699587af159c39d483ba2f88a5d0。合并后main独立CI尚未完成，不将其描述为通过；此处通过指最终候选40156690255的完整三job结果。接续文档/图像提交仅改docs，不改变该apps子树。[终态核验](verification-final.json)。
