# 小城市篮球：其余72页视觉稿 v3（UIV003）

更新 2026-11-02T04:00:38.527Z。本轮负责人 Codex root。**12组×6页的主视图视觉参考已交付；完整交互状态、可编辑Figma、业务原型和前端实施仍为部分完成／待开展。** 不把这批图片称为全套UI工程已验收。

## 核验依据与文件

无本地Git检出；工作目录 `/workspace/scratch/0f4f16dde23c`，无本地分支、HEAD或dirty状态；通过GitHub读取。业务源码基线 `717a3a7a9fbb91aa93370d6dc594c10b58bdf4c9`；交付前再次读取main@`da2fbf168e87f00d9a7525a5bfccfbb4dfec47c8`及app.json，仅本任务Markdown前进，没有业务变化。app.json共73条路由，除已有首页外72条均有一个画面位置。

已读AGENTS、COLLABORATION、CURRENT_STATUS、TASKS、UI_SPEC及全部72页WXML；专项规则与重点JS由只读核验补充。历史状态标题中的旧Draft／未开发说法未直接当作当前事实。入口、能力与数据仍须以接手时最新代码和API契约为准。

- [下载本次完整视觉包](https://chatgpt.com/library?file_id=libfile_c166a09e9fec8191ae70ce90b1843411&account_id=personal)：`scb_remaining_ui_v3.zip`，21,471,685字节，34文件。
- ZIP中 `index.html` 可离线浏览；`boards/01.png—12.png` 为12张1024×1536的6页组图；`reference-home.png` 仅作已有首页风格参照，不重复计数。
- `page-index.csv/json/md` 对应72个编号、路由、角色和位置；`cursor-handoff.md` 是前端交接；`review-notes.md` 记录限制；附生成提示词、文件哈希和元数据。
- 下载链接面向当前ChatGPT账户，未建立GitHub Release或公开素材托管；给其他开发者时请转交下载后的ZIP。
- 原有首页资产与旧Figma保留；本次未向旧Figma导入图片或声称创建新的Figma／可点击原型。

## 视觉和入口方向

全国篮球赛事＋按本地真实供给开放的服务。采用新首页深蓝、活力橙、浅色底、体育图片和立体图标方向；示例城市／球队／人物／数字均为合成资料，不将高州或其他城市写成产品固定结构。底部保持首页／赛事／同城／球队／我的。主办方、工作人员、财务、运营等经明确授权工作台进入，不将所有后台管理入口塞进普通观众首页；网页后台专属操作未强行搬入。

原生实施建议以390宽为主，检查320/430、长标题、44px触控及底部安全区。**这批位图未完成上述原生适配验证，不能据组图像素推算完整布局规格。** 文本、表单、图标和组件需由Cursor原生实现，不得把整屏图片作为实际页面。

## 分组覆盖

| 组 | 页面类别 | 路由简称 |
| --- | --- | --- |
| 01 | 赛事／同城／球队／我的 | `watch`、`local`、`teams`、`account`、`city-select`、`search` |
| 02 | 赛事发现与公开观赛 | `event`、`match`、`bracket`、`media`、`follows`、`public-ledgers` |
| 03 | 球队、成员与公开数据 | `team`、`memberships`、`invitation`、`team-join`、`public-archives`、`public-archive` |
| 04 | 球员服务、邀约与履约 | `players`、`player`、`compare`、`booking-create`、`bookings`、`booking-detail` |
| 05 | 本人档案、赛季与建队 | `player-center`、`performance`、`seasons`、`season-grants`、`team-request`、`team-requests` |
| 06 | 赛事招募、本人资料与审核 | `recruitment`、`registration-events`、`entry`、`participant-materials`、`qualification-precheck`、`entry-review` |
| 07 | 办赛、排赛与工作人员 | `org-event`、`event-setup`、`schedule`、`reschedule`、`org-match`、`staff-configuration` |
| 08 | 记分、裁定与直播媒体 | `scoring-tasks`、`scorer`、`match-exceptions`、`live-studio`、`media-jobs`、`match-media` |
| 09 | 同城履约、撮合与派单 | `local-manage`、`local-bookings`、`local-matchups`、`matching`、`dispatch`、`training` |
| 10 | 培训、交易、保险与监护 | `training-manage`、`trade-order`、`trade-manage`、`insurance`、`guardian`、`youth-review` |
| 11 | 消息、隐私、账号与客服 | `messages`、`notification-settings`、`account-recovery`、`account-closure`、`governance`、`governance-reviews` |
| 12 | 城市运营、赞助、海报及平台 | `city-operations`、`sponsorships`、`sponsor-commerce`、`poster`、`platform`、`planned` |

## 关键状态与功能边界

| 范围 | 本批主视图表达及实施边界 |
| --- | --- |
| 全国／同城 | 赛事、城市选择、搜索、真实服务发现；地图和位置按实际能力开放 |
| 公开观赛 | 赛事、比分、分节、有效发布媒体；撤回来源清空旧内容，私有专业报表不直接公开 |
| 球队与档案 | 长期成员、本届报名、26位加入码、本人授权；公开档案、私有赛季、宣传／直播用途分开 |
| 球员服务 | 条件意向、待回应、履约分别展示；交通未知只算已知小计，意向不占档不自动付款 |
| 报名／保障 | 资料补充、独立预审、审核分别展示；保单按届规则核验，8MiB限制，正式在线投保未开放 |
| 办赛／赛果 | 模板、8队分组排赛、改期、人员授权；结束记分仍待独立赛果确认 |
| 记分／直播 | 离线本地草稿未计入当前比分，时钟／阵容／节次受限；正式直播关闭时保留比分入口 |
| 同城／派单 | 服务方确认、临时占档、待到场、资金记录分开；跨城交通独立核验，不能直接派单成功 |
| 培训／青年 | 仅成人固定短班；签到、授课、消费分开；青年参赛必要处理确认与可选宣传分开 |
| 交易／保险 | 已有业务编排及原订单查询不等于正式渠道已接入；金额未知显示—，不画钱包或假到账 |
| 消息／账号 | 站内消息、微信一次许可和送达分开；邮箱找回通道未配置；注销先核对未决事项 |
| 赞助／运营 | 草稿、独立审核、签署、收费分别表示；曝光不等收入，退款不等回退／追偿 |

**能力分类：** 已实现部分以现有页面、授权、资料、报名、排赛、订单等真实代码为基础；保险、支付／退款／分账、微信通知、地图与直播等虽有代码或适配入口，正式接入和真实外部验收仍待完成，不以设计放开。青少年培训等当前未开放能力未按可用功能设计。单纯存在路由不能证明该模块全业务已验收。

生成图片的小字和按钮可能有残余误差，`review-notes.md`及最新源码优先。例如团队申请应是机构分享入口而非任意账号定向赋权；费用未知不能按图片中“确定场次”字样推导已确认全包报价。performance只有限得分、犯规、样本与完整度；独立专业档案另按其授权处理。不得将合成数字或按钮颜色当作真实状态。

## 检查与未覆盖

已检查12组各6画面、编号与72路由唯一对应；与交付前再次读取app.json做集合比较，遗漏0、重复0、额外0；逐组查看图片并对授权、审批、未知费用、离线、外部关闭等作定向修正。PNG完整性、原字节复制哈希和ZIP完整性通过。

尚未逐页单独出齐加载、空、失败、无权、未登录、未开放、处理中、结果未知及全部弹窗／长表单／长列表；未完成可编辑组件、Auto Layout、全部逐页图层、可点击关键流程；未运行小程序、浏览器布局、微信真机或真实外部验收。因此全套交互交付仍是**部分完成**。目录点击仅打开原图／文档，不是业务原型。

## 与代码差异和Cursor顺序

1. 仅视觉：颜色、层级、圆角、间距、插图、卡片与导航。复用既有事件、字段、数据和权限。
2. 需前端核验／新增：分步展示、页签、折叠、内联校验、状态解释和恢复入口。逐项映射已有事件；缺失则单列，不伪造服务端成功。
3. 需功能／后端另立任务：契约不能表达的新字段、动作、权限，以及正式保险、资金、订阅和直播准入。此视觉任务不修改它们。
4. 实施顺序：保留首页基准 → 四主导航与共享视觉 → 公开赛事／球队／同城 → 本人报名与审核 → 主办方／排赛／记分 → 媒体／履约 → 交易／运营／账号 → 全状态及320/390/430回归。
5. Cursor使用独立分支／worktree，只认领自己的页面；app.json、全局样式、共享组件、工具、契约和汇总文档由明确负责人串行集成。禁止覆盖其他AI成果、自动重写视觉基准或混入其他PR。

本次只更新UIV003自己的任务、交接和本文件三份Markdown；业务代码、数据库、API、权限、其他任务、PR、部署及生产均未修改。

## 逐页索引

| 编号 | 路由 | 页面 | 角色 | 图内位置 |
| --- | --- | --- | --- | --- |
| V3-01-1 | `pages/watch/index` | 赛事 | 公开观众 | 上左 · `boards/01.png` |
| V3-01-2 | `pages/local/index` | 同城 | 公开访客 | 上中 · `boards/01.png` |
| V3-01-3 | `pages/teams/index` | 球队 | 已登录本人 | 上右 · `boards/01.png` |
| V3-01-4 | `pages/account/index` | 我的 | 已登录普通用户 | 下左 · `boards/01.png` |
| V3-01-5 | `pages/city-select/index` | 选择城市 | 公开访客 | 下中 · `boards/01.png` |
| V3-01-6 | `pages/search/index` | 搜索 | 公开访客 | 下右 · `boards/01.png` |
| V3-02-1 | `pages/event/index` | 赛事详情 | 公开观众 | 上左 · `boards/02.png` |
| V3-02-2 | `pages/match/index` | 比赛实况 | 公开观众 | 上中 · `boards/02.png` |
| V3-02-3 | `pages/bracket/index` | 分组与晋级 | 有权赛事工作人员 | 上右 · `boards/02.png` |
| V3-02-4 | `pages/media/index` | 比赛视频 | 公开观众 | 下左 · `boards/02.png` |
| V3-02-5 | `pages/follows/index` | 我的关注 | 本人 | 下中 · `boards/02.png` |
| V3-02-6 | `pages/public-ledgers/index` | 经费公示 | 公开观众 | 下右 · `boards/02.png` |
| V3-03-1 | `pages/team/index` | 球队主页与成员 | 有权球队领队 | 上左 · `boards/03.png` |
| V3-03-2 | `pages/memberships/index` | 我的成员关系 | 本人 | 上中 · `boards/03.png` |
| V3-03-3 | `pages/invitation/index` | 接受球队邀请 | 邀请指定账号 | 上右 · `boards/03.png` |
| V3-03-4 | `pages/team-join/index` | 加入球队 | 本人 | 下左 · `boards/03.png` |
| V3-03-5 | `pages/public-archives/index` | 公开档案授权 | 本人／有权主办方 | 下中 · `boards/03.png` |
| V3-03-6 | `pages/public-archive/index` | 公开球员档案 | 公开观众 | 下右 · `boards/03.png` |
| V3-04-1 | `pages/players/index` | 找球员 | 公开观众／需求方 | 上左 · `boards/04.png` |
| V3-04-2 | `pages/player/index` | 球员服务详情 | 需求方 | 上中 · `boards/04.png` |
| V3-04-3 | `pages/compare/index` | 球员对比 | 需求方 | 上右 · `boards/04.png` |
| V3-04-4 | `pages/booking-create/index` | 发起球员邀约 | 有权需求方 | 下左 · `boards/04.png` |
| V3-04-5 | `pages/bookings/index` | 我的球员预约 | 本人需求方 | 下中 · `boards/04.png` |
| V3-04-6 | `pages/booking-detail/index` | 逐场邀约与履约 | 预约双方／授权处理人 | 下右 · `boards/04.png` |
| V3-05-1 | `pages/player-center/index` | 本人球员中心 | 本人 | 上左 · `boards/05.png` |
| V3-05-2 | `pages/performance/index` | 比赛数据授权 | 本人／有权主办方 | 上中 · `boards/05.png` |
| V3-05-3 | `pages/seasons/index` | 私有赛季管理 | 机构负责人／管理员 | 上右 · `boards/05.png` |
| V3-05-4 | `pages/season-grants/index` | 私有赛季授权 | 本人 | 下左 · `boards/05.png` |
| V3-05-5 | `pages/team-request/index` | 申请建队 | 已登录申请人 | 下中 · `boards/05.png` |
| V3-05-6 | `pages/team-requests/index` | 建队申请审核 | 机构有权独立管理员 | 下右 · `boards/05.png` |
| V3-06-1 | `pages/recruitment/index` | 赛事公开招募 | 公开访客／领队 | 上左 · `boards/06.png` |
| V3-06-2 | `pages/registration-events/index` | 选择报名赛事 | 有权球队领队 | 上中 · `boards/06.png` |
| V3-06-3 | `pages/entry/index` | 本届球队名单 | 有权领队 | 上右 · `boards/06.png` |
| V3-06-4 | `pages/participant-materials/index` | 本人报名资料 | 本人 | 下左 · `boards/06.png` |
| V3-06-5 | `pages/qualification-precheck/index` | 独立资格预审 | 本人／独立审核员 | 下中 · `boards/06.png` |
| V3-06-6 | `pages/entry-review/index` | 报名独立审核 | 无关联独立审核员 | 下右 · `boards/06.png` |
| V3-07-1 | `pages/org-event/index` | 主办方赛事工作台 | 有权主办方 | 上左 · `boards/07.png` |
| V3-07-2 | `pages/event-setup/index` | 办赛向导 | 有权主办方 | 上中 · `boards/07.png` |
| V3-07-3 | `pages/schedule/index` | 抽签与排程 | 有权主办方 | 上右 · `boards/07.png` |
| V3-07-4 | `pages/reschedule/index` | 比赛改期 | 有权主办方 | 下左 · `boards/07.png` |
| V3-07-5 | `pages/org-match/index` | 本场比赛管理 | 实际工作人员／独立复核人 | 下中 · `boards/07.png` |
| V3-07-6 | `pages/staff-configuration/index` | 赛事工作人员 | 有权管理员 | 下右 · `boards/07.png` |
| V3-08-1 | `pages/scoring-tasks/index` | 记分与复核任务 | 实际被分配工作人员 | 上左 · `boards/08.png` |
| V3-08-2 | `pages/scorer/index` | 现场记分 | 当前主记分员 | 上中 · `boards/08.png` |
| V3-08-3 | `pages/match-exceptions/index` | 弃权与取消裁定 | 有权提议人／独立复核人 | 上右 · `boards/08.png` |
| V3-08-4 | `pages/live-studio/index` | 直播准备与控制 | 有权主播／独立批准人 | 下左 · `boards/08.png` |
| V3-08-5 | `pages/media-jobs/index` | 录像与媒体作业 | 有权媒体工作人员 | 下中 · `boards/08.png` |
| V3-08-6 | `pages/match-media/index` | 比赛媒体管理 | 有权赛事工作人员 | 下右 · `boards/08.png` |
| V3-09-1 | `pages/local-manage/index` | 供给与档期管理 | 经营方／实际服务者／独立审核者 | 上左 · `boards/09.png` |
| V3-09-2 | `pages/local-bookings/index` | 同城预约订单 | 本人／对应服务方 | 上中 · `boards/09.png` |
| V3-09-3 | `pages/local-matchups/index` | 球队约赛 | 双方球队有权管理人 | 上右 · `boards/09.png` |
| V3-09-4 | `pages/matching/index` | 全国篮球撮合 | 有权需求人／合格供给方 | 下左 · `boards/09.png` |
| V3-09-5 | `pages/dispatch/index` | 跨城服务派单 | 需求方／受邀本人／独立交通复核 | 下中 · `boards/09.png` |
| V3-09-6 | `pages/training/index` | 成人篮球训练 | 成年学员本人 | 下右 · `boards/09.png` |
| V3-10-1 | `pages/training-manage/index` | 培训教务工作台 | 有权教务／已确认教练 | 上左 · `boards/10.png` |
| V3-10-2 | `pages/trade-order/index` | 本人资金订单 | 本人原订单 | 上中 · `boards/10.png` |
| V3-10-3 | `pages/trade-manage/index` | 机构财务与条款 | 本机构授权独立财务 | 上右 · `boards/10.png` |
| V3-10-4 | `pages/insurance/index` | 本人赛事保障 | 本人／有权审核人 | 下左 · `boards/10.png` |
| V3-10-5 | `pages/guardian/index` | 青年参赛确认 | 本人及独立监护账号 | 下中 · `boards/10.png` |
| V3-10-6 | `pages/youth-review/index` | 青年关系独立审核 | 有权独立审核员 | 下右 · `boards/10.png` |
| V3-11-1 | `pages/messages/index` | 我的消息 | 本人 | 上左 · `boards/11.png` |
| V3-11-2 | `pages/notification-settings/index` | 提醒设置 | 本人 | 上中 · `boards/11.png` |
| V3-11-3 | `pages/account-recovery/index` | 账号找回 | 本人 | 上右 · `boards/11.png` |
| V3-11-4 | `pages/account-closure/index` | 账号注销 | 本人 | 下左 · `boards/11.png` |
| V3-11-5 | `pages/governance/index` | 客服与争议 | 本人／明确分派处理人 | 下中 · `boards/11.png` |
| V3-11-6 | `pages/governance-reviews/index` | 服务评价 | 真实完成订单参与人 | 下右 · `boards/11.png` |
| V3-12-1 | `pages/city-operations/index` | 城市运营工作台 | 有限范围授权运营者 | 上左 · `boards/12.png` |
| V3-12-2 | `pages/sponsorships/index` | 赞助与广告投放 | 本机构商务／独立审核人 | 上中 · `boards/12.png` |
| V3-12-3 | `pages/sponsor-commerce/index` | 广告合同与收益 | 普通广告主本人／受限商务财务 | 上右 · `boards/12.png` |
| V3-12-4 | `pages/poster/index` | 授权赛事海报 | 当前有权赛事人员 | 下左 · `boards/12.png` |
| V3-12-5 | `pages/platform/index` | 平台处理工作台 | 当前有权独立平台处理人 | 下中 · `boards/12.png` |
| V3-12-6 | `pages/planned/index` | 服务费用规则 | 普通用户说明 | 下右 · `boards/12.png` |
