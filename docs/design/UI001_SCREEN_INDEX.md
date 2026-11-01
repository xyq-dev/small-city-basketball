# UI001 画板、路由、角色与状态索引

核验：2026-11-01T02:42:57.537Z；代码基线 main `c61ab3667c9d3f756244a28046b9ee2395ccac00`。可编辑界面总计200张：原核心127张＋本轮补充73张（62业务/状态、11尺寸适配）。说明板不计入画板总数。[设计交付说明](WECHAT_UI_V2.md) · [Figma最新封面](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=48-7)。

E＝已实现源码；X＝已有源码或编排，正式接入待验；P＝规划，尚未实现。适配画板沿用其源画板能力。视觉交付不改变代码、正式服务或生产状态。原68条路由没有因为新增画板而增加。

## 1. 既有核心设计127张

| ID | 可编辑画板 | 角色 | 能力边界 | 尺寸 | 源码入口 |
| --- | --- | --- | --- | --- | --- |
| H01 | [小城市篮球](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-16) | 公开访客／已登录用户 | E 已实现源码 | 390×844 | apps/wechat/pages/home/index |
| E01 | [赛事](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-126) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/watch/index |
| L01 | [同城](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-206) | 公开访客 | E 源码已实现；地图正式待验 | 390×844 | apps/wechat/pages/local/index |
| T01 | [球队](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-286) | 球队成员／领队 | E 已实现源码 | 390×844 | apps/wechat/pages/teams/index |
| A01 | [我的](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-378) | 登录用户；工作台按授权出现 | E 已实现源码 | 390×844 | apps/wechat/pages/account/index |
| H02 | [选择浏览城市](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-162) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/city-select/index |
| H03 | [打开观赛入口](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-222) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/watch/index |
| H04 | [全国搜索](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-252) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/search/index |
| H05 | [我的消息](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-306) | 本人 | E 已实现源码 | 390×844 | apps/wechat/pages/messages/index |
| H06 | [微信订阅提醒](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-360) | 本人 | E 源码已实现；微信正式发送待验 | 390×844 | apps/wechat/pages/notification-settings/index |
| H07 | [我的关注](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-401) | 本人 | E 已实现源码 | 390×844 | apps/wechat/pages/follows/index |
| E02 | [赛事详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-438) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/event/index |
| E03 | [赛事赛程](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-508) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/event/index |
| E04 | [小组积分](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-550) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/event/index |
| E05 | [比赛实况](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-601) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/match/index |
| E06 | [分组与淘汰](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-658) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/event/index |
| E07 | [本场技术统计](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-696) | 被授权工作人员 · 报表只读 | E 私有报表已实现；公开比赛新增统计页需API审查 | 390×844 | apps/wechat/pages/scorer/index |
| E08 | [比赛视频与回放](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-744) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/media/index |
| T02 | [球队管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-787) | 领队／授权管理者 | E 已实现源码 | 390×844 | apps/wechat/pages/team/index |
| T03 | [接受球队邀请](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-844) | 被邀请的目标账号 | E 已实现源码 | 390×844 | apps/wechat/pages/invitation/index |
| T04 | [公开球员档案](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-879) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/public-archive/index |
| T05 | [比赛数据授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-943) | 球员本人／提名负责人 | E 已实现源码 | 390×844 | apps/wechat/pages/performance/index |
| T10 | [向机构申请建队](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-983) | 本人 | E 已实现源码 | 390×844 | apps/wechat/pages/team-request/index |
| T11 | [输入球队加入码](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1016) | 本人 | E 已实现源码 | 390×844 | apps/wechat/pages/team-join/index |
| T06 | [找球员](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1047) | 已登录用户 | E 已实现源码 | 390×844 | apps/wechat/pages/players/index |
| T07 | [球员服务详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1102) | 已登录用户 | E 已实现源码 | 390×844 | apps/wechat/pages/player/index |
| T08 | [同价球员对比](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1147) | 已登录用户 | E 已实现源码 | 390×844 | apps/wechat/pages/compare/index |
| T09 | [发起球员邀约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1195) | 有权代表球队的领队 | E 已实现源码 | 390×844 | apps/wechat/pages/booking-create/index |
| T17 | [我的球员预约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1244) | 发起人／受邀球员 | E 已实现源码 | 390×844 | apps/wechat/pages/bookings/index |
| T18 | [逐场邀约与履约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1290) | 订单当前参与双方 | E 已实现源码 | 390×844 | apps/wechat/pages/booking-detail/index |
| T12 | [我的成员关系](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1353) | 本人／授权领队 | E 已实现源码 | 390×844 | apps/wechat/pages/memberships/index |
| T13 | [本人球员中心](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1394) | 球员本人 | E 已实现源码 | 390×844 | apps/wechat/pages/player-center/index |
| T14 | [公开档案管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1458) | 本人／球队授权管理者 | E 已实现源码 | 390×844 | apps/wechat/pages/public-archives/index |
| T15 | [私有赛季管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1512) | 机构负责人／管理员 | E 已实现源码 | 390×844 | apps/wechat/pages/seasons/index |
| T16 | [赛季数据授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1552) | 本人／有权赛事管理员 | E 已实现源码 | 390×844 | apps/wechat/pages/season-grants/index |
| O13 | [建队申请审核](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1590) | 机构管理员 | E 已实现源码 | 390×844 | apps/wechat/pages/team-requests/index |
| R01 | [赛事公开招募](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-356) | 访客／有权领队 | E 已实现源码 | 390×844 | apps/wechat/pages/recruitment/index |
| R02 | [选择本届报名](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-402) | 有权领队 | E 已实现源码 | 390×844 | apps/wechat/pages/registration-events/index |
| R09 | [本届球队名单](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-436) | 有权领队 | E 已实现源码 | 390×844 | apps/wechat/pages/entry/index |
| R03 | [本人报名资料](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-492) | 球员本人 | E 已实现源码 | 390×844 | apps/wechat/pages/participant-materials/index |
| R04 | [上传本人照片](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-564) | 球员本人 | E 已实现源码 | 390×844 | apps/wechat/pages/participant-materials/index |
| R05 | [独立资格预审](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-609) | 本人申请／独立审核人 | E 已实现源码 | 390×844 | apps/wechat/pages/qualification-precheck/index |
| R07 | [已有外部保单](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-669) | 本人 | E 已实现源码 | 390×844 | apps/wechat/pages/participant-materials/index |
| R06 | [在线保险](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-707) | 本人 | X 已有编排代码；供应商adapter未接，购买默认关闭 | 390×844 | apps/wechat/pages/insurance/index |
| R10 | [报名审核进度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-751) | 球员本人／领队仅见汇总 | E 已实现源码 | 390×844 | apps/wechat/pages/participant-materials/index |
| R08 | [青少年与监护确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-807) | 本人／独立监护账号 | E 已实现源码 | 390×844 | apps/wechat/pages/guardian/index |
| R11 | [监护人独立确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-862) | 受邀监护账号 | E 已实现源码 | 390×844 | apps/wechat/pages/guardian/index |
| R12 | [保险订单与出单进度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-905) | 本人 | X 保险正式接入待验；所有示例为合成状态 | 390×844 | apps/wechat/pages/insurance/index |
| O01 | [赛事主办方工作台](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-951) | 当前机构赛事负责人 | E 已实现源码 | 390×844 | apps/wechat/pages/org-event/index |
| O02 | [办赛向导](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1014) | 机构负责人／管理员 | E 已实现源码 | 390×844 | apps/wechat/pages/event-setup/index |
| O03 | [办赛模板](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1080) | 机构负责人／管理员 | E 已实现源码 | 390×844 | apps/wechat/pages/event-setup/index |
| O04 | [招募、导入与邀请](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1124) | 赛事负责人 | E 已实现源码 | 390×844 | apps/wechat/pages/recruitment/index |
| O05 | [报名独立审核](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1174) | 无关联的独立审核人 | E 已实现源码 | 390×844 | apps/wechat/pages/entry-review/index |
| O10 | [青少年关系审核](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1224) | 有权且无关联的独立审核人 | E 已实现源码 | 390×844 | apps/wechat/pages/youth-review/index |
| O06 | [抽签与排程](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1272) | 赛事负责人 | E 已实现源码 | 390×844 | apps/wechat/pages/schedule/index |
| O07 | [晋级与下一轮发布](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1325) | 赛事负责人 | E 已实现源码 | 390×844 | apps/wechat/pages/bracket/index |
| O08 | [比赛改期](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1365) | 赛事负责人 | E 已实现源码 | 390×844 | apps/wechat/pages/reschedule/index |
| O09 | [工作人员配置](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1401) | 机构／赛事授权管理者 | E 已实现源码 | 390×844 | apps/wechat/pages/staff-configuration/index |
| O11 | [弃权与取消裁定](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1454) | 提议人与独立复核人 | E 已实现源码 | 390×844 | apps/wechat/pages/match-exceptions/index |
| O12 | [比赛管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1492) | 被授权工作人员 | E 已实现源码 | 390×844 | apps/wechat/pages/org-match/index |
| S01 | [记分与复核任务](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-528) | 被指派的记分员／复核人 | E 已实现源码 | 390×844 | apps/wechat/pages/scoring-tasks/index |
| S02 | [现场记分](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-567) | 本场记分员 | E 已实现源码 | 390×844 | apps/wechat/pages/scorer/index |
| S03 | [阵容与换人](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-639) | 持有控制权的记分员 | E 已实现源码 | 390×844 | apps/wechat/pages/scorer/index |
| S04 | [专业事件记录](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-686) | 持有控制权的记分员 | E 已实现源码 | 390×844 | apps/wechat/pages/scorer/index |
| S05 | [离线草稿](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-737) | 本场原登录账号 | E 已实现源码 | 390×844 | apps/wechat/pages/scorer/index |
| S06 | [同步冲突与更正](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-775) | 本场记分员 | E 已实现源码 | 390×844 | apps/wechat/pages/scorer/index |
| S07 | [独立确认赛果](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-832) | 其他独立有权复核人 | E 已实现源码 | 390×844 | apps/wechat/pages/org-match/index |
| S08 | [赛果已确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-877) | 有权工作人员 | E 已实现源码 | 390×844 | apps/wechat/pages/org-match/index |
| E09 | [正式比赛赛果](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-933) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/match/index |
| L02 | [设置附近起点](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-983) | 公开访客 | X 定位与地图已有代码；正式配置及真机待验 | 390×844 | apps/wechat/pages/local/index |
| L03 | [球场与可约档期](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1024) | 访客浏览／本人预约 | E 已实现源码 | 390×844 | apps/wechat/pages/local/index |
| L04 | [同城人员服务](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1072) | 本人需求方 | E 已实现源码 | 390×844 | apps/wechat/pages/local/index |
| L05 | [同城预约订单](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1115) | 订单本人参与方 | E 已实现源码 | 390×844 | apps/wechat/pages/local-bookings/index |
| L06 | [服务履约进度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1169) | 需求方／实际服务方 | E 已实现源码 | 390×844 | apps/wechat/pages/local-bookings/index |
| L07 | [球队约赛](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1239) | 双方球队授权代表 | E 已实现源码 | 390×844 | apps/wechat/pages/local-matchups/index |
| L08 | [供给与服务方管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1282) | 供给管理者／独立审核者 | E 已实现源码 | 390×844 | apps/wechat/pages/local-manage/index |
| V01 | [创建本场直播](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1332) | 本场授权直播管理人员 | X 已有代码；正式微信、腾讯及外站待验 | 390×844 | apps/wechat/pages/live-studio/index |
| V02 | [直播独立批准](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1373) | 与申请／采集者分开的管理者 | X 接入后条件流程；原型为合成演示 | 390×844 | apps/wechat/pages/live-studio/index |
| V03 | [本机采集与预检](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1415) | 当前授权采集人员 | X 接入待验；独立预检页为交互重组 | 390×844 | apps/wechat/pages/live-studio/index |
| V04 | [直播控制](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1473) | 当前授权采集人员 | X 合成运行状态；正式双目标待验 | 390×844 | apps/wechat/pages/live-studio/index |
| V05 | [停流待确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1524) | 采集人员／直播管理者 | X 已有停流屏障代码；正式物理证据待验 | 390×844 | apps/wechat/pages/live-studio/index |
| V06 | [录像与媒体作业](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1567) | 有权媒体工作人员 | X 已有执行代码；正式长时媒体与容量待验 | 390×844 | apps/wechat/pages/media-jobs/index |
| V07 | [比赛媒体与授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1619) | 有权赛事媒体管理者 | E 已实现源码 | 390×844 | apps/wechat/pages/match-media/index |
| V08 | [授权宣传海报](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1662) | 有权赛事工作人员 | E 已实现源码 | 390×844 | apps/wechat/pages/poster/index |
| F01 | [本次资金订单](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-686) | 来源订单有权参与者 | X 已有交易代码；正式商户联调待验 | 390×844 | apps/wechat/pages/trade-order/index |
| F02 | [付款结果核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-741) | 付款本人 | X 接入后付款条件状态；无真实资金 | 390×844 | apps/wechat/pages/trade-order/index |
| F03 | [退款申请与进度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-784) | 订单参与方／独立复核人 | X 已有代码；正式退款联调待验 | 390×844 | apps/wechat/pages/trade-order/index |
| F04 | [保证金与扣减](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-828) | 有权提议人／独立复核人 | X 交易源码已实现；正式渠道待验 | 390×844 | apps/wechat/pages/trade-order/index |
| F05 | [对账与结算](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-869) | 当前机构有权财务／独立复核人 | X 代码已实现；真实日账与分账待验 | 390×844 | apps/wechat/pages/trade-manage/index |
| F06 | [收款条款管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-913) | 机构有权管理者／独立审批人 | E 条款源码已实现；外部资金另验 | 390×844 | apps/wechat/pages/trade-manage/index |
| A02 | [账号与隐私](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-954) | 本人 | E 已实现源码 | 390×844 | apps/wechat/pages/account/index |
| A03 | [登录与微信绑定](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1025) | 未登录／本人 | E 账号已实现；正式微信身份联调待验 | 390×844 | apps/wechat/pages/account/index |
| A04 | [验证邮箱与找回](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1063) | 本人 | X 源码已实现；正式邮件发送待验 | 390×844 | apps/wechat/pages/account-recovery/index |
| A05 | [账号自助注销](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1099) | 本人重新认证 | E 已实现源码 | 390×844 | apps/wechat/pages/account-closure/index |
| A06 | [客服、举报与争议](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1155) | 本人／明确分派的工作人员 | E 已实现源码 | 390×844 | apps/wechat/pages/governance/index |
| A07 | [服务评价](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1203) | 真实参与且已完成订单的一方 | E 已实现源码 | 390×844 | apps/wechat/pages/governance-reviews/index |
| A08 | [城市运营工作台](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1242) | 明确授权的城市操作员 | E 已实现源码 | 390×844 | apps/wechat/pages/city-operations/index |
| A09 | [赞助与广告投放](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1288) | 机构投放者／独立审核者／访客 | E 已实现源码 | 390×844 | apps/wechat/pages/sponsorships/index |
| A10 | [赛事经费公示](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1328) | 公开访客／有权账务管理者 | E 已实现源码 | 390×844 | apps/wechat/pages/public-ledgers/index |
| A11 | [平台处理工作台](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1376) | 明确授权的平台人员 | E 已实现源码 | 390×844 | apps/wechat/pages/platform/index |
| F07 | [软件服务与资金说明](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1431) | 有权机构用户 | P 旧规划说明；不是钱包或通用支付入口 | 390×844 | apps/wechat/pages/planned/index |
| V09 | [授权回放](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1465) | 公开访客 | E 已实现源码 | 390×844 | apps/wechat/pages/match/index |
| X01 | [正在加载](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-793) | 视具体业务的当前用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/home/index |
| X02 | [本地暂无供给](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-819) | 视具体业务的当前用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/local/index |
| X03 | [读取失败](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-847) | 视具体业务的当前用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/home/index |
| X04 | [没有当前权限](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-875) | 失权／无权账号 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/org-event/index |
| X05 | [登录后继续](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-901) | 未登录用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/account/index |
| X06 | [直播尚未开通](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-927) | 有权直播人员 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/live-studio/index |
| X07 | [操作处理中](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-957) | 视具体业务的当前用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/trade-order/index |
| X08 | [原操作结果待核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-983) | 视具体业务的当前用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/trade-order/index |
| X09 | [内容已停止公开](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-1011) | 公开访客 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/event/index |
| X10 | [记分台已被占用](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-1037) | 已分配但未持控制权的记分员 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/scorer/index |
| X11 | [上传未完成](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-1070) | 本人 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/participant-materials/index |
| X12 | [资料版本已变化](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-1096) | 本人／有权审核人 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | apps/wechat/pages/participant-materials/index |
| H01W320 | [小城市篮球](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-835) | 公开访客／已登录用户 | 适配审阅 · 320px；沿用H01 | 320×844 | apps/wechat/pages/home/index |
| E02W320 | [赛事详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-945) | 公开访客 | 适配审阅 · 320px；沿用E02 | 320×844 | apps/wechat/pages/event/index |
| R03W320 | [本人报名资料](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1015) | 球员本人 | 适配审阅 · 320px；沿用R03 | 320×844 | apps/wechat/pages/participant-materials/index |
| S02W320 | [现场记分](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1087) | 本场记分员 | 适配审阅 · 320px；沿用S02 | 320×844 | apps/wechat/pages/scorer/index |
| V04W320 | [直播控制](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1159) | 当前授权采集人员 | 适配审阅 · 320px；沿用V04 | 320×844 | apps/wechat/pages/live-studio/index |
| H01W430 | [小城市篮球](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1210) | 公开访客／已登录用户 | 适配审阅 · 430px；沿用H01 | 430×844 | apps/wechat/pages/home/index |
| E02W430 | [赛事详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1320) | 公开访客 | 适配审阅 · 430px；沿用E02 | 430×844 | apps/wechat/pages/event/index |
| R03W430 | [本人报名资料](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1390) | 球员本人 | 适配审阅 · 430px；沿用R03 | 430×844 | apps/wechat/pages/participant-materials/index |
| S02W430 | [现场记分](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1462) | 本场记分员 | 适配审阅 · 430px；沿用S02 | 430×844 | apps/wechat/pages/scorer/index |
| V04W430 | [直播控制](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1534) | 当前授权采集人员 | 适配审阅 · 430px；沿用V04 | 430×844 | apps/wechat/pages/live-studio/index |
| Q320 | [赛事详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=16-967) | 公开访客 | 压力检查 · 320px · 合成长名称 | 320×844 | apps/wechat/pages/event/index |
| Q430 | [赛事详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=16-1000) | 公开访客 | 压力检查 · 430px · 合成长名称 | 430×844 | apps/wechat/pages/event/index |
| V10 | [横屏直播控制](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=16-1033) | 当前授权采集人员 | X 横屏交互设计；真机及正式推流待验 | 844×390 | apps/wechat/pages/live-studio/index |

## 2. DOC006补充设计73张（全部P，尚未实现）

| ID | 可编辑画板 | 角色 | 关键状态 | 尺寸 | 需求来源 |
| --- | --- | --- | --- | --- | --- |
| IN01 | [赛事保险](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1032) | 本人／监护人 | 未开通 | 390×844 | INSURANCE_PROVIDER_INTEGRATION |
| IN02 | [产品与保障条款](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1061) | 本人／监护人 | 合规主体/销售模式获批后的条件界面 | 390×844 | INSURANCE_PROVIDER_INTEGRATION §2—4 |
| IN03 | [核对投保资料](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1099) | 成年本人；未成年人仅关闭提示 | 本人私有资料确认／授权不足阻塞 | 390×844 | INSURANCE_PROVIDER_INTEGRATION §4—6 |
| IN04 | [前往保险服务方](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1139) | 本人／监护人 | 跳转服务方与获准提交分支 | 390×844 | INSURANCE_PROVIDER_INTEGRATION §3—6 |
| IN05 | [保险结果待核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1168) | 本人／监护人 | 付款已确认／承保结果未知 | 390×844 | INSURANCE_PROVIDER_INTEGRATION §5—8 |
| IN06 | [保单详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1198) | 本人／有权审核员 | 已出单／资格仍独立审核 | 390×844 | INSURANCE_PROVIDER_INTEGRATION §6—8 |
| IN07 | [本次未承保](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1228) | 本人／监护人 | 拒保／报价失效／付款独立核对 | 390×844 | INSURANCE_PROVIDER_INTEGRATION §7—8 |
| IN08 | [退保与退款进度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1257) | 本人／监护人 | 申请受理／保单与退款双状态 | 390×844 | INSURANCE_PROVIDER_INTEGRATION §8 |
| MP01 | [同城地图找服务](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1288) | 公开访客 | 初始／未定位仍浏览 | 390×844 | MAP_VIEWPORT_SEARCH MAP01 |
| MP02 | [搜索此区域](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1328) | 公开访客 | 地图已移动／旧结果保持原范围 | 390×844 | MAP_VIEWPORT_SEARCH MAP02 |
| MP03 | [正在搜索此区域](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1370) | 公开访客 | 搜索中再拖动／旧响应作废 | 390×844 | MAP_VIEWPORT_SEARCH MAP03 |
| MP04 | [区域服务结果](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1408) | 公开访客／预约人 | 搜索成功／选中服务卡 | 390×844 | MAP_VIEWPORT_SEARCH MAP04 |
| MP05 | [此区域暂无供给](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1450) | 公开访客 | 空结果 | 390×844 | MAP_VIEWPORT_SEARCH MAP05 |
| MP06 | [请缩小搜索范围](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1487) | 公开访客 | 超范围／过密结果 | 390×844 | MAP_VIEWPORT_SEARCH MAP06 |
| MP07 | [确认跨城浏览范围](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1523) | 公开访客 | 跨城范围确认 | 390×844 | MAP_VIEWPORT_SEARCH MAP07 |
| MP08 | [地图暂时无法显示](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1550) | 公开访客 | 地图失败／列表仍可用 | 390×844 | MAP_VIEWPORT_SEARCH MAP08 |
| NM01 | [发布篮球服务需求](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1112) | 本人／有权领队 | 填写需求／真实地点时段 | 390×844 | NATIONWIDE_MATCHING |
| NM02 | [确认需求公开范围](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1148) | 本人／有权领队 | 逐项授权／需求发布前审阅 | 390×844 | NATIONWIDE_MATCHING |
| NM03 | [候选服务与比较](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1186) | 需求发布人 | 匹配理由／报价证据／非自动成单 | 390×844 | NATIONWIDE_MATCHING |
| NM04 | [服务意向详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1222) | 需求发布人／对应服务方 | 双方有意向／不锁档期 | 390×844 | NATIONWIDE_MATCHING |
| NM05 | [我的服务需求](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1254) | 本人／有权领队 | 列表／草稿／已发布／撤回 | 390×844 | NATIONWIDE_MATCHING |
| NM06 | [请重新核对候选](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1285) | 需求发布人 | 资格/时段/报价/需求版本变化 | 390×844 | NATIONWIDE_MATCHING |
| NM07 | [暂未找到合适候选](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1312) | 需求发布人 | 无候选／证据覆盖不足 | 390×844 | NATIONWIDE_MATCHING |
| DS01 | [发起跨城服务邀约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1340) | 有权办赛方／服务购买人 | 需求与邀请设置 | 390×844 | CROSS_CITY_DISPATCH |
| DS02 | [我的跨城服务偏好](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1378) | 工作人员本人 | 服务覆盖／出行规则／需主动同意 | 390×844 | CROSS_CITY_DISPATCH |
| DS03 | [邀请与分项报价](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1416) | 受邀工作人员本人 | 邀请有效／资格与交通已核实的成功分支 | 390×844 | CROSS_CITY_DISPATCH |
| DS04 | [客户确认跨城报价](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1454) | 本次服务购买人 | 报价锁／地点时间费用集中确认 | 390×844 | CROSS_CITY_DISPATCH |
| DS05 | [跨城预约待确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1490) | 购买人／当前履约方 | 原预约REQUESTED／未承接未付款 | 390×844 | CROSS_CITY_DISPATCH |
| DS06 | [报价已失效](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1519) | 购买人／受邀人员 | 锁到期／需求版本变化 | 390×844 | CROSS_CITY_DISPATCH |
| DS07 | [本次已由他人承接](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1546) | 受邀工作人员本人 | 并发承接未中选／不扣款不占日历 | 390×844 | CROSS_CITY_DISPATCH |
| DS08 | [暂时无人承接](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1573) | 本次服务购买人／调度员 | 批次结束／无有效承接 | 390×844 | CROSS_CITY_DISPATCH |
| TR01 | [同城篮球课程](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1212) | 公开访客／报名人 | 课程列表／按真实城市供给开放 | 390×844 | TRAINING_ENROLLMENT |
| TR02 | [课程与班次详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1244) | 公开访客／报名人 | 课程说明／资质／容量与退款条款 | 390×844 | TRAINING_ENROLLMENT |
| TR03 | [学员与报名授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1279) | 本人／已核验监护人／付款人 | 学员监护付款身份分别确认 | 390×844 | TRAINING_ENROLLMENT |
| TR04 | [名额已暂时保留](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1319) | 本次付款人／监护人 | 有效锁位／明确到期与费用 | 390×844 | TRAINING_ENROLLMENT |
| TR05 | [课程付款待核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1351) | 本次付款人 | 渠道返回／付款与报名待核对 | 390×844 | TRAINING_ENROLLMENT |
| TR06 | [我的课程与课次](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1378) | 学员本人／有效监护人 | 报名已确认／课程表／消费明细 | 390×844 | TRAINING_ENROLLMENT |
| TR07 | [到场签到与课次明细](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1412) | 监护人／当班有权教练 | 到场/接送/授课消费分别记录 | 390×844 | TRAINING_ENROLLMENT |
| TR08 | [请假、补课与退费](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1441) | 本人／有效监护人／付款人按权限 | 申请与结果分态／退款原渠道核对 | 390×844 | TRAINING_ENROLLMENT |
| TR09 | [付款已确认，名额待处理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1474) | 本次付款人／监护人 | 晚付款／锁过期无名额 | 390×844 | TRAINING_ENROLLMENT |
| TR10 | [监护与接送确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1503) | 本人／已核验监护人 | 监护撤回／阻塞新增处理与交接 | 390×844 | TRAINING_ENROLLMENT |
| TR11 | [课程变更与课次争议](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1532) | 学员本人／监护人／机构处理人 | 停课改期／出勤争议／保留证据 | 390×844 | TRAINING_ENROLLMENT |
| TR12 | [班次满员与候补](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1565) | 本人／监护人 | 满员／主动候补／不得先收确定席位费 | 390×844 | TRAINING_ENROLLMENT |
| AD01 | [广告合同与分成协议](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1277) | 有权机构商务／合同管理员 | 合同版本／参与方签署 | 1440×960 | AD_REVENUE_SHARING |
| AD02 | [实际收款与交付证据](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1314) | 有权机构商务／财务经办 | 真实收款核验／履约独立验收 | 1440×960 | AD_REVENUE_SHARING |
| AD03 | [结算预览与金额守恒](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1349) | 财务经办（申请人） | 不可变预览／未提交审核 | 1440×960 | AD_REVENUE_SHARING |
| AD04 | [独立审核结算申请](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1384) | 独立财务审核员（非申请人） | 申请与批准分离／固定版本复核 | 1440×960 | AD_REVENUE_SHARING |
| AD05 | [分账执行与逐方核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1421) | 独立执行员／有权财务 | 渠道结果未知／部分成功 | 1440×960 | AD_REVENUE_SHARING |
| AD06 | [退款与分账回退处理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1465) | 独立审核员／有权财务 | 退款占用／回退未知或不足额 | 1440×960 | AD_REVENUE_SHARING |
| OP01 | [保险供应商与原单核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1502) | 授权保险运营／独立核对员 | 供应商未选定关闭／只读查单与差异 | 1440×960 | INSURANCE_PROVIDER_INTEGRATION |
| OP02 | [跨城邀约与调度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1539) | 当前城市／机构范围内授权调度员 | 批次与锁／单赢家／人工换人 | 1440×960 | CROSS_CITY_DISPATCH |
| OP03 | [培训排课与招生管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1578) | 当前机构授权教务／财务 | 排课容量／教师与场地冲突／招生 | 1440×960 | TRAINING_ENROLLMENT |
| AD07 | [我的广告收入对账](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1618) | 当前收款方本人／本机构有权财务 | 仅己方金额与原渠道结果 | 390×844 | AD_REVENUE_SHARING |
| AD08 | [结算独立审批](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1646) | 独立财务审核员 | 390只读核对与审批／无配置入口 | 390×844 | AD_REVENUE_SHARING |
| OP04 | [教练今日课表](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1680) | 当前班次有权教练 | 签到／授课完成／消费待独立确认 | 390×844 | TRAINING_ENROLLMENT |
| TR13 | [候补登记已受理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1712) | 本人／有效监护人 | 已候补／未报名未锁位未扣款 | 390×844 | TRAINING_ENROLLMENT |
| MP04W320 | [区域服务结果](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1742) | 公开访客／预约人 | 响应检查 320px；搜索成功／选中服务卡 | 320×844 | MAP_VIEWPORT_SEARCH MAP04；适配自MP04 |
| MP04W430 | [区域服务结果](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1784) | 公开访客／预约人 | 响应检查 430px；搜索成功／选中服务卡 | 430×844 | MAP_VIEWPORT_SEARCH MAP04；适配自MP04 |
| NM03W320 | [候选服务与比较](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1826) | 需求发布人 | 响应检查 320px；匹配理由／报价证据／非自动成单 | 320×844 | NATIONWIDE_MATCHING；适配自NM03 |
| NM03W430 | [候选服务与比较](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1862) | 需求发布人 | 响应检查 430px；匹配理由／报价证据／非自动成单 | 430×844 | NATIONWIDE_MATCHING；适配自NM03 |
| TR03W320 | [学员与报名授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1898) | 本人／已核验监护人／付款人 | 响应检查 320px；学员监护付款身份分别确认 | 320×844 | TRAINING_ENROLLMENT；适配自TR03 |
| TR03W430 | [学员与报名授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1938) | 本人／已核验监护人／付款人 | 响应检查 430px；学员监护付款身份分别确认 | 430×844 | TRAINING_ENROLLMENT；适配自TR03 |
| DS04W320 | [客户确认跨城报价](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1978) | 本次服务购买人 | 响应检查 320px；报价锁／地点时间费用集中确认 | 320×844 | CROSS_CITY_DISPATCH；适配自DS04 |
| DS04W430 | [客户确认跨城报价](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-2014) | 本次服务购买人 | 响应检查 430px；报价锁／地点时间费用集中确认 | 430×844 | CROSS_CITY_DISPATCH；适配自DS04 |
| AD03W1024 | [结算预览与金额守恒](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-2051) | 财务经办（申请人） | 响应检查 1024px；不可变预览／未提交审核 | 1024×960 | AD_REVENUE_SHARING；适配自AD03 |
| OP02W1024 | [跨城邀约与调度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-2086) | 当前城市／机构范围内授权调度员 | 响应检查 1024px；批次与锁／单赢家／人工换人 | 1024×960 | CROSS_CITY_DISPATCH；适配自OP02 |
| OP03W1024 | [培训排课与招生管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-2125) | 当前机构授权教务／财务 | 响应检查 1024px；排课容量／教师与场地冲突／招生 | 1024×960 | TRAINING_ENROLLMENT；适配自OP03 |
| TR14 | [未获名额原单退费](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1791) | 原付款人／有权财务 | 晚付款未获名额／消费0／原款960独立处理 | 390×844 | TRAINING_ENROLLMENT |
| TR15 | [培训监护与用途核验](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1819) | 本人／已核验监护人／有权教务 | 培训专用授权待重新确认／不复用赛事授权 | 390×844 | TRAINING_ENROLLMENT |
| DS09 | [服务方确认原预约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1851) | 当前受邀服务方本人 | 最终承接前复检资格/时段/锁 | 390×844 | CROSS_CITY_DISPATCH |
| DS10 | [承接已确认，付款待核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1882) | 原购买人／当前履约方 | 已承接／原付款未知 | 390×844 | CROSS_CITY_DISPATCH |
| DS11 | [跨城服务确认详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1907) | 原购买人／当前履约方 | 承接与付款分别已确认／待到场 | 390×844 | CROSS_CITY_DISPATCH |
| DS12 | [本次跨城服务履约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1935) | 原购买人／当前履约方／有权处理人 | 到场/服务/验收分别记录／争议分支 | 390×844 | CROSS_CITY_DISPATCH |

## 3. 当前68条原生路由映射

下表只反映真实 app.json；一条路由可承载多个交互画板，不据画板数增加路由。

| 当前路由 | 核心画板 | 权限与使用角色 | 正式外部待验 |
| --- | --- | --- | --- |
| pages/home/index | H01 / X01 / X03 / H01W320 / H01W430 | 公开访客／已登录用户；视具体业务的当前用户 | 不因此承诺正式环境已验 |
| pages/city-select/index | H02 | 公开访客 | 不因此承诺正式环境已验 |
| pages/search/index | H04 | 公开访客 | 不因此承诺正式环境已验 |
| pages/watch/index | E01 / H03 | 公开访客 | 不因此承诺正式环境已验 |
| pages/media/index | E08 | 公开访客 | 不因此承诺正式环境已验 |
| pages/account/index | A01 / A02 / A03 / X05 | 登录用户；工作台按授权出现；本人；未登录／本人；未登录用户 | 不因此承诺正式环境已验 |
| pages/account-recovery/index | A04 | 本人 | 是，见专项验收 |
| pages/staff-configuration/index | O09 | 机构／赛事授权管理者 | 不因此承诺正式环境已验 |
| pages/event/index | E02 / E03 / E04 / E06 / X09 / E02W320 / E02W430 / Q320 / Q430 | 公开访客 | 不因此承诺正式环境已验 |
| pages/org-event/index | O01 / X04 | 当前机构赛事负责人；失权／无权账号 | 不因此承诺正式环境已验 |
| pages/org-match/index | O12 / S07 / S08 | 被授权工作人员；其他独立有权复核人；有权工作人员 | 不因此承诺正式环境已验 |
| pages/scorer/index | E07 / S02 / S03 / S04 / S05 / S06 / X10 / S02W320 / S02W430 | 被授权工作人员 · 报表只读；本场记分员；持有控制权的记分员；本场原登录账号；已分配但未持控制权的记分员 | 不因此承诺正式环境已验 |
| pages/scoring-tasks/index | S01 | 被指派的记分员／复核人 | 不因此承诺正式环境已验 |
| pages/entry-review/index | O05 | 无关联的独立审核人 | 不因此承诺正式环境已验 |
| pages/event-setup/index | O02 / O03 | 机构负责人／管理员 | 不因此承诺正式环境已验 |
| pages/schedule/index | O06 | 赛事负责人 | 不因此承诺正式环境已验 |
| pages/bracket/index | O07 | 赛事负责人 | 不因此承诺正式环境已验 |
| pages/reschedule/index | O08 | 赛事负责人 | 不因此承诺正式环境已验 |
| pages/match-media/index | V07 | 有权赛事媒体管理者 | 不因此承诺正式环境已验 |
| pages/match/index | E05 / E09 / V09 | 公开访客 | 不因此承诺正式环境已验 |
| pages/players/index | T06 | 已登录用户 | 不因此承诺正式环境已验 |
| pages/player/index | T07 | 已登录用户 | 不因此承诺正式环境已验 |
| pages/compare/index | T08 | 已登录用户 | 不因此承诺正式环境已验 |
| pages/booking-create/index | T09 | 有权代表球队的领队 | 不因此承诺正式环境已验 |
| pages/bookings/index | T17 | 发起人／受邀球员 | 不因此承诺正式环境已验 |
| pages/booking-detail/index | T18 | 订单当前参与双方 | 不因此承诺正式环境已验 |
| pages/player-center/index | T13 | 球员本人 | 不因此承诺正式环境已验 |
| pages/performance/index | T05 | 球员本人／提名负责人 | 不因此承诺正式环境已验 |
| pages/teams/index | T01 | 球队成员／领队 | 不因此承诺正式环境已验 |
| pages/team/index | T02 | 领队／授权管理者 | 不因此承诺正式环境已验 |
| pages/registration-events/index | R02 | 有权领队 | 不因此承诺正式环境已验 |
| pages/entry/index | R09 | 有权领队 | 不因此承诺正式环境已验 |
| pages/invitation/index | T03 | 被邀请的目标账号 | 不因此承诺正式环境已验 |
| pages/planned/index | F07 | 有权机构用户 | 不因此承诺正式环境已验 |
| pages/platform/index | A11 | 明确授权的平台人员 | 不因此承诺正式环境已验 |
| pages/follows/index | H07 | 本人 | 不因此承诺正式环境已验 |
| pages/team-request/index | T10 | 本人 | 不因此承诺正式环境已验 |
| pages/team-requests/index | O13 | 机构管理员 | 不因此承诺正式环境已验 |
| pages/team-join/index | T11 | 本人 | 不因此承诺正式环境已验 |
| pages/memberships/index | T12 | 本人／授权领队 | 不因此承诺正式环境已验 |
| pages/seasons/index | T15 | 机构负责人／管理员 | 不因此承诺正式环境已验 |
| pages/season-grants/index | T16 | 本人／有权赛事管理员 | 不因此承诺正式环境已验 |
| pages/participant-materials/index | R03 / R04 / R07 / R10 / X11 / X12 / R03W320 / R03W430 | 球员本人；本人；球员本人／领队仅见汇总；本人／有权审核人 | 不因此承诺正式环境已验 |
| pages/match-exceptions/index | O11 | 提议人与独立复核人 | 不因此承诺正式环境已验 |
| pages/recruitment/index | R01 / O04 | 访客／有权领队；赛事负责人 | 不因此承诺正式环境已验 |
| pages/poster/index | V08 | 有权赛事工作人员 | 不因此承诺正式环境已验 |
| pages/local/index | L01 / L02 / L03 / L04 / X02 | 公开访客；访客浏览／本人预约；本人需求方；视具体业务的当前用户 | 是，见专项验收 |
| pages/local-manage/index | L08 | 供给管理者／独立审核者 | 不因此承诺正式环境已验 |
| pages/local-bookings/index | L05 / L06 | 订单本人参与方；需求方／实际服务方 | 不因此承诺正式环境已验 |
| pages/local-matchups/index | L07 | 双方球队授权代表 | 不因此承诺正式环境已验 |
| pages/governance/index | A06 | 本人／明确分派的工作人员 | 不因此承诺正式环境已验 |
| pages/governance-reviews/index | A07 | 真实参与且已完成订单的一方 | 不因此承诺正式环境已验 |
| pages/city-operations/index | A08 | 明确授权的城市操作员 | 不因此承诺正式环境已验 |
| pages/sponsorships/index | A09 | 机构投放者／独立审核者／访客 | 不因此承诺正式环境已验 |
| pages/public-archives/index | T14 | 本人／球队授权管理者 | 不因此承诺正式环境已验 |
| pages/public-archive/index | T04 | 公开访客 | 不因此承诺正式环境已验 |
| pages/public-ledgers/index | A10 | 公开访客／有权账务管理者 | 不因此承诺正式环境已验 |
| pages/live-studio/index | V01 / V02 / V03 / V04 / V05 / X06 / V04W320 / V04W430 / V10 | 本场授权直播管理人员；与申请／采集者分开的管理者；当前授权采集人员；采集人员／直播管理者；有权直播人员 | 是，见专项验收 |
| pages/media-jobs/index | V06 | 有权媒体工作人员 | 是，见专项验收 |
| pages/insurance/index | R06 / R12 | 本人 | 是，见专项验收 |
| pages/qualification-precheck/index | R05 | 本人申请／独立审核人 | 不因此承诺正式环境已验 |
| pages/trade-order/index | F01 / F02 / F03 / F04 / X07 / X08 | 来源订单有权参与者；付款本人；订单参与方／独立复核人；有权提议人／独立复核人；视具体业务的当前用户 | 是，见专项验收 |
| pages/trade-manage/index | F05 / F06 | 当前机构有权财务／独立复核人；机构有权管理者／独立审批人 | 是，见专项验收 |
| pages/messages/index | H05 | 本人 | 不因此承诺正式环境已验 |
| pages/notification-settings/index | H06 | 本人 | 不因此承诺正式环境已验 |
| pages/account-closure/index | A05 | 本人重新认证 | 不因此承诺正式环境已验 |
| pages/guardian/index | R08 / R11 | 本人／独立监护账号；受邀监护账号 | 不因此承诺正式环境已验 |
| pages/youth-review/index | O10 | 有权且无关联的独立审核人 | 不因此承诺正式环境已验 |
