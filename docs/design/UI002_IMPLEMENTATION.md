# UI002 画板与真实小程序实施映射

状态：IN_PROGRESS / BRANCH_ONLY（实施与验收分项记录，尚未最终合并）。更新时间：2026-11-01T14:53:06+08:00。

依据[UI001设计交付](WECHAT_UI_V2.md)、[200画板原始索引](UI001_SCREEN_INDEX.md)和实际 `app.json`，将设计归入现有 **73条路由**。最终路由文件复核基线为本地整合分支 `9adc72917a129fa0c42e58419008da68ca2eab8a`，相对开工main `c22fde9` 的73条路由均有UI002源码、模板或样式变更；这不代表main或生产完成，最终代码与验证由[UI002任务](../tasks/UI002.md)和[交接](../handoffs/UI002.md)统一记录。

200张由127张核心稿和73张补充稿组成，包含正常/失败/关闭状态、320/430尺寸、844横屏及1440/1024后台稿。**以下200项是去向与差异清单，不是200张已逐像素验收的勾选单。** 路由存在、VM可运行、静态兼容PNG、正式微信真机及实际外部交易是不同证据。

## 当前整合边界

| 项目 | UI002处理 | 验收边界 |
| --- | --- | --- |
| 组件与五导航 | 复用header/nav/icon，增加state/steps；按UI001品牌、正文/表单层级与安全区落地 | root负责实际源码、三宽布局与最终证据，不能只据本表称整套完成 |
| 报名审核与办赛记分 | 原路由内分步骤/分区；保存草稿、预审、保险、监护、最终审核与赛果分别呈现 | 当前API、capabilities和原幂等编号保持；独立审核和离线冲突不变 |
| 撮合、派单与同城订单 | 需求、公开审阅、意向、报价及原预约回路分开 | 选择候选或确认报价不等最终承接、付款或履约 |
| 培训 | 成人短课T1按课程/合同/锁位/付款/课次呈现 | T2青少年培训、培训专用监护和课包T3继续关闭；TR10/TR15不是已开放业务 |
| 保险 | 销售关闭、外购保单和原单核对保留；准入/接口框架不替代供应商 | 关闭态、原单核对及受准入约束的条件界面已接线；OP01独立1440供应商后台不属于本轮小程序开放范围，真实adapter仍BLOCKED_EXTERNAL |
| 广告与财务 | AD07/AD08为本人对账/独立审批；AD01—AD06适配既有受权移动管理区 | 默认本人合同/对账；管理配置仅实际canManage/capability可见，权限和金额核算不变 |
| 直播与媒体 | 准备、批准、采集、停止证据、任务与产物分区 | 未开通保持关闭；正式微信、实际双平台推流、长时采集及横屏/真机另验 |
| 公开数据 | 首页赛事卡使用当前真实公开来源 | 不填设计示例68:64；E07仍为私有工作人员统计，不公开私有技术表 |

## 设计读取与验证口径

Figma以真实截图为视觉目标，整体context超时的节点按metadata拆成小图层读取；提供的SVG下载本地使用，临时URL不作运行时素材。各域节点和实际验证见[报名/记分任务](../tasks/UI002-REGISTRATION.md)、[直播/财务任务](../tasks/UI002-LIVE.md)、[服务任务](../tasks/UI002-SERVICES.md)。映射作者没有重复调用整套Figma或重跑上述作者测试，不将任务记录当作独立视觉验收。

| 证据层 | 本文件可确认 | 未包含的结论 |
| --- | --- | --- |
| 静态映射 | 原索引200个唯一ID逐项有去向；73条实际路由均在反向表，所列JS/WXML/JSON存在 | 不等于各画板所有控件、业务分支和视觉相符 |
| 独立WXSS | 69条路由有页级WXSS；event-setup/schedule/bracket/reschedule四页复用全局样式，match-media已有独立WXSS | 不为凑文件数创建空样式或新路由 |
| UI002源码整合 | 73条路由均已有本轮源码/模板/样式变更；有界关闭态是已实现的能力门槛，不表示整个模块未开发 | 当前[PR36](https://github.com/xyq-dev/small-city-basketball/pull/36)候选CI和独立Review由root收口，不能以源码整合代替验收 |
| Figma高保真 | root与各域已记录取得的代表截图/小层context及超时 | 未逐张核对的范围不写200画板逐像素通过 |
| 直接VM/模板 | 各切片已执行命令由各任务记录 | 当前HEAD完整必要测试和独立Review仍由root汇总，本表不预填结果 |
| 320/390/430兼容布局与PNG | 静态展开和浏览器几何分别记录 | 本地Chrome/字体限制不降低CI布局标准，未执行不计通过 |
| 微信与外部渠道 | 本轮无完整正式验证证据 | 官方工具/真机、真实支付/退款/分账、投保、消息、推流及生产另验 |

## 全73路由反向表

说明每个现有消费者承载的画板，包含状态和尺寸稿；没有按200画板增加路由。同一画板可关联原交易/履约消费者，重复关联不增加画板总数。

| 实际路由 | 画板ID | 使用边界 |
| --- | --- | --- |
| `pages/home/index` | H01 / X01 / X03 / H01W320 / H01W430 | 公开访客／已登录用户；视具体业务的当前用户 |
| `pages/city-select/index` | H02 | 公开访客 |
| `pages/search/index` | H04 | 公开访客 |
| `pages/watch/index` | E01 / H03 | 公开访客 |
| `pages/media/index` | E08 | 公开访客 |
| `pages/account/index` | A01 / A02 / A03 / X05 | 登录用户；工作台按授权出现；本人；未登录／本人；未登录用户 |
| `pages/account-recovery/index` | A04 | 本人 |
| `pages/staff-configuration/index` | O09 | 机构／赛事授权管理者 |
| `pages/event/index` | E02 / E03 / E04 / E06 / X09 / E02W320 / E02W430 / Q320 / Q430 | 公开访客 |
| `pages/org-event/index` | O01 / X04 | 当前机构赛事负责人；失权／无权账号 |
| `pages/org-match/index` | O12 / S07 / S08 | 被授权工作人员；其他独立有权复核人；有权工作人员 |
| `pages/scorer/index` | E07 / S02 / S03 / S04 / S05 / S06 / X10 / S02W320 / S02W430 | 被授权工作人员 · 报表只读；本场记分员；持有控制权的记分员；本场原登录账号；已分配但未持控制权的记分员 |
| `pages/scoring-tasks/index` | S01 | 被指派的记分员／复核人 |
| `pages/entry-review/index` | O05 | 无关联的独立审核人 |
| `pages/event-setup/index` | O02 / O03 | 机构负责人／管理员 |
| `pages/schedule/index` | O06 | 赛事负责人 |
| `pages/bracket/index` | O07 | 赛事负责人 |
| `pages/reschedule/index` | O08 | 赛事负责人 |
| `pages/match-media/index` | V07 | 有权赛事媒体管理者 |
| `pages/match/index` | E05 / E09 / V09 | 公开访客 |
| `pages/players/index` | T06 | 已登录用户 |
| `pages/player/index` | T07 | 已登录用户 |
| `pages/compare/index` | T08 | 已登录用户 |
| `pages/booking-create/index` | T09 | 有权代表球队的领队 |
| `pages/bookings/index` | T17 | 发起人／受邀球员 |
| `pages/booking-detail/index` | T18 | 订单当前参与双方 |
| `pages/player-center/index` | T13 | 球员本人 |
| `pages/performance/index` | T05 | 球员本人／提名负责人 |
| `pages/teams/index` | T01 | 球队成员／领队 |
| `pages/team/index` | T02 | 领队／授权管理者 |
| `pages/registration-events/index` | R02 | 有权领队 |
| `pages/entry/index` | R09 | 有权领队 |
| `pages/invitation/index` | T03 | 被邀请的目标账号 |
| `pages/planned/index` | F07 | 有权机构用户 |
| `pages/platform/index` | A11 | 明确授权的平台人员 |
| `pages/follows/index` | H07 | 本人 |
| `pages/team-request/index` | T10 | 本人 |
| `pages/team-requests/index` | O13 | 机构管理员 |
| `pages/team-join/index` | T11 | 本人 |
| `pages/memberships/index` | T12 | 本人／授权领队 |
| `pages/seasons/index` | T15 | 机构负责人／管理员 |
| `pages/season-grants/index` | T16 | 本人／有权赛事管理员 |
| `pages/participant-materials/index` | R03 / R04 / R07 / R10 / X11 / X12 / R03W320 / R03W430 | 球员本人；本人；球员本人／领队仅见汇总；本人／有权审核人 |
| `pages/match-exceptions/index` | O11 | 提议人与独立复核人 |
| `pages/recruitment/index` | R01 / O04 | 访客／有权领队；赛事负责人 |
| `pages/poster/index` | V08 | 有权赛事工作人员 |
| `pages/local/index` | L01 / L02 / L03 / L04 / X02 / MP01 / MP02 / MP03 / MP04 / MP05 / MP06 / MP07 / MP08 / MP04W320 / MP04W430 | 公开访客；访客浏览／本人预约；本人需求方；视具体业务的当前用户 |
| `pages/local-manage/index` | L08 | 供给管理者／独立审核者 |
| `pages/local-bookings/index` | L05 / L06 / DS09 / DS10 / DS11 / DS12 | 订单本人参与方；需求方／实际服务方 |
| `pages/local-matchups/index` | L07 | 双方球队授权代表 |
| `pages/governance/index` | A06 | 本人／明确分派的工作人员 |
| `pages/governance-reviews/index` | A07 | 真实参与且已完成订单的一方 |
| `pages/city-operations/index` | A08 | 明确授权的城市操作员 |
| `pages/sponsorships/index` | A09 | 机构投放者／独立审核者／访客 |
| `pages/public-archives/index` | T14 | 本人／球队授权管理者 |
| `pages/public-archive/index` | T04 | 公开访客 |
| `pages/public-ledgers/index` | A10 | 公开访客／有权账务管理者 |
| `pages/live-studio/index` | V01 / V02 / V03 / V04 / V05 / X06 / V04W320 / V04W430 / V10 | 本场授权直播管理人员；与申请／采集者分开的管理者；当前授权采集人员；采集人员／直播管理者；有权直播人员 |
| `pages/media-jobs/index` | V06 | 有权媒体工作人员 |
| `pages/insurance/index` | R06 / R12 / IN01 / IN02 / IN03 / IN04 / IN05 / IN06 / IN07 / IN08 / OP01 | 本人 |
| `pages/qualification-precheck/index` | R05 | 本人申请／独立审核人 |
| `pages/trade-order/index` | F01 / F02 / F03 / F04 / X07 / X08 | 来源订单有权参与者；付款本人；订单参与方／独立复核人；有权提议人／独立复核人；视具体业务的当前用户 |
| `pages/trade-manage/index` | F05 / F06 | 当前机构有权财务／独立复核人；机构有权管理者／独立审批人 |
| `pages/messages/index` | H05 | 本人 |
| `pages/notification-settings/index` | H06 | 本人 |
| `pages/account-closure/index` | A05 | 本人重新认证 |
| `pages/guardian/index` | R08 / R11 | 本人／独立监护账号；受邀监护账号 |
| `pages/youth-review/index` | O10 | 有权且无关联的独立审核人 |
| `pages/matching/index` | NM01 / NM02 / NM03 / NM04 / NM05 / NM06 / NM07 / NM03W320 / NM03W430 | 本人、有权领队及对应供给方；真实资格和来源授权复核 |
| `pages/dispatch/index` | DS01 / DS02 / DS03 / DS04 / DS05 / DS06 / DS07 / DS08 / OP02 / DS04W320 / DS04W430 / OP02W1024 / DS09 / DS10 / DS11 / DS12 | 购买人、受邀本人、当前范围内有权调度 |
| `pages/training/index` | TR01 / TR02 / TR03 / TR04 / TR05 / TR06 / TR07 / TR08 / TR09 / TR10 / TR11 / TR12 / TR13 / TR03W320 / TR03W430 / TR14 / TR15 | T1成人本人及当前有效付款授权；T2监护/课包不开放 |
| `pages/training-manage/index` | TR07 / TR11 / OP03 / OP04 / OP03W1024 | 当前机构教务/独立审核财务及当班有权教练 |
| `pages/sponsor-commerce/index` | AD01 / AD02 / AD03 / AD04 / AD05 / AD06 / AD07 / AD08 / AD03W1024 | 本人合同参与者、当前机构有权商务/财务、独立审核员 |

## 全200画板逐项映射

角色与原型状态沿用原始索引；历史E/X/P只反映设计交付时说明，当前实现和关闭门槛以“实施处理”及UI002/REMAINING6当前任务为准。逐项“既有路由承载”表示相关UI002源码已在整合分支落地；“当前验证待集成人汇总”表示当前候选CI/状态/视觉验收仍待收口，不是待开发标记。尺寸稿和后台稿保留自己的ID，未重复认作新小程序页面。

| 画板 | 角色 | 状态/目标 | 尺寸 | 真实路由 | 实施处理 |
| --- | --- | --- | --- | --- | --- |
| [H01 · 小城市篮球](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-16) | 公开访客／已登录用户 | E 已实现源码 | 390×844 | [home](../../apps/wechat/pages/home/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [E01 · 赛事](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-126) | 公开访客 | E 已实现源码 | 390×844 | [watch](../../apps/wechat/pages/watch/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [L01 · 同城](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-206) | 公开访客 | E 源码已实现；地图正式待验 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T01 · 球队](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-286) | 球队成员／领队 | E 已实现源码 | 390×844 | [teams](../../apps/wechat/pages/teams/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A01 · 我的](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=4-378) | 登录用户；工作台按授权出现 | E 已实现源码 | 390×844 | [account](../../apps/wechat/pages/account/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [H02 · 选择浏览城市](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-162) | 公开访客 | E 已实现源码 | 390×844 | [city-select](../../apps/wechat/pages/city-select/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [H03 · 打开观赛入口](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-222) | 公开访客 | E 已实现源码 | 390×844 | [watch](../../apps/wechat/pages/watch/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [H04 · 全国搜索](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-252) | 公开访客 | E 已实现源码 | 390×844 | [search](../../apps/wechat/pages/search/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [H05 · 我的消息](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-306) | 本人 | E 已实现源码 | 390×844 | [messages](../../apps/wechat/pages/messages/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [H06 · 微信订阅提醒](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-360) | 本人 | E 源码已实现；微信正式发送待验 | 390×844 | [notification-settings](../../apps/wechat/pages/notification-settings/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [H07 · 我的关注](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-401) | 本人 | E 已实现源码 | 390×844 | [follows](../../apps/wechat/pages/follows/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [E02 · 赛事详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-438) | 公开访客 | E 已实现源码 | 390×844 | [event](../../apps/wechat/pages/event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [E03 · 赛事赛程](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-508) | 公开访客 | E 已实现源码 | 390×844 | [event](../../apps/wechat/pages/event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [E04 · 小组积分](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-550) | 公开访客 | E 已实现源码 | 390×844 | [event](../../apps/wechat/pages/event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [E05 · 比赛实况](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-601) | 公开访客 | E 已实现源码 | 390×844 | [match](../../apps/wechat/pages/match/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [E06 · 分组与淘汰](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-658) | 公开访客 | E 已实现源码 | 390×844 | [event](../../apps/wechat/pages/event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [E07 · 本场技术统计](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-696) | 被授权工作人员 · 报表只读 | E 私有报表已实现；公开比赛新增统计页需API审查 | 390×844 | [scorer](../../apps/wechat/pages/scorer/index.wxml) | 只映射私有工作人员报表；不将完整比赛技术表公开 |
| [E08 · 比赛视频与回放](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-744) | 公开访客 | E 已实现源码 | 390×844 | [media](../../apps/wechat/pages/media/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T02 · 球队管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-787) | 领队／授权管理者 | E 已实现源码 | 390×844 | [team](../../apps/wechat/pages/team/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T03 · 接受球队邀请](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-844) | 被邀请的目标账号 | E 已实现源码 | 390×844 | [invitation](../../apps/wechat/pages/invitation/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T04 · 公开球员档案](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-879) | 公开访客 | E 已实现源码 | 390×844 | [public-archive](../../apps/wechat/pages/public-archive/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T05 · 比赛数据授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-943) | 球员本人／提名负责人 | E 已实现源码 | 390×844 | [performance](../../apps/wechat/pages/performance/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T10 · 向机构申请建队](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-983) | 本人 | E 已实现源码 | 390×844 | [team-request](../../apps/wechat/pages/team-request/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T11 · 输入球队加入码](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1016) | 本人 | E 已实现源码 | 390×844 | [team-join](../../apps/wechat/pages/team-join/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T06 · 找球员](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1047) | 已登录用户 | E 已实现源码 | 390×844 | [players](../../apps/wechat/pages/players/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T07 · 球员服务详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1102) | 已登录用户 | E 已实现源码 | 390×844 | [player](../../apps/wechat/pages/player/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T08 · 同价球员对比](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1147) | 已登录用户 | E 已实现源码 | 390×844 | [compare](../../apps/wechat/pages/compare/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T09 · 发起球员邀约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1195) | 有权代表球队的领队 | E 已实现源码 | 390×844 | [booking-create](../../apps/wechat/pages/booking-create/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T17 · 我的球员预约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1244) | 发起人／受邀球员 | E 已实现源码 | 390×844 | [bookings](../../apps/wechat/pages/bookings/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T18 · 逐场邀约与履约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1290) | 订单当前参与双方 | E 已实现源码 | 390×844 | [booking-detail](../../apps/wechat/pages/booking-detail/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T12 · 我的成员关系](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1353) | 本人／授权领队 | E 已实现源码 | 390×844 | [memberships](../../apps/wechat/pages/memberships/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T13 · 本人球员中心](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1394) | 球员本人 | E 已实现源码 | 390×844 | [player-center](../../apps/wechat/pages/player-center/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T14 · 公开档案管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1458) | 本人／球队授权管理者 | E 已实现源码 | 390×844 | [public-archives](../../apps/wechat/pages/public-archives/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T15 · 私有赛季管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1512) | 机构负责人／管理员 | E 已实现源码 | 390×844 | [seasons](../../apps/wechat/pages/seasons/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [T16 · 赛季数据授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1552) | 本人／有权赛事管理员 | E 已实现源码 | 390×844 | [season-grants](../../apps/wechat/pages/season-grants/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O13 · 建队申请审核](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=5-1590) | 机构管理员 | E 已实现源码 | 390×844 | [team-requests](../../apps/wechat/pages/team-requests/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R01 · 赛事公开招募](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-356) | 访客／有权领队 | E 已实现源码 | 390×844 | [recruitment](../../apps/wechat/pages/recruitment/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R02 · 选择本届报名](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-402) | 有权领队 | E 已实现源码 | 390×844 | [registration-events](../../apps/wechat/pages/registration-events/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R09 · 本届球队名单](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-436) | 有权领队 | E 已实现源码 | 390×844 | [entry](../../apps/wechat/pages/entry/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R03 · 本人报名资料](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-492) | 球员本人 | E 已实现源码 | 390×844 | [participant-materials](../../apps/wechat/pages/participant-materials/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R04 · 上传本人照片](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-564) | 球员本人 | E 已实现源码 | 390×844 | [participant-materials](../../apps/wechat/pages/participant-materials/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R05 · 独立资格预审](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-609) | 本人申请／独立审核人 | E 已实现源码 | 390×844 | [qualification-precheck](../../apps/wechat/pages/qualification-precheck/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R07 · 已有外部保单](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-669) | 本人 | E 已实现源码 | 390×844 | [participant-materials](../../apps/wechat/pages/participant-materials/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R06 · 在线保险](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-707) | 本人 | X 已有编排代码；供应商adapter未接，购买默认关闭 | 390×844 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R10 · 报名审核进度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-751) | 球员本人／领队仅见汇总 | E 已实现源码 | 390×844 | [participant-materials](../../apps/wechat/pages/participant-materials/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R08 · 青少年与监护确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-807) | 本人／独立监护账号 | E 已实现源码 | 390×844 | [guardian](../../apps/wechat/pages/guardian/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R11 · 监护人独立确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-862) | 受邀监护账号 | E 已实现源码 | 390×844 | [guardian](../../apps/wechat/pages/guardian/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [R12 · 保险订单与出单进度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-905) | 本人 | X 保险正式接入待验；所有示例为合成状态 | 390×844 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O01 · 赛事主办方工作台](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-951) | 当前机构赛事负责人 | E 已实现源码 | 390×844 | [org-event](../../apps/wechat/pages/org-event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O02 · 办赛向导](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1014) | 机构负责人／管理员 | E 已实现源码 | 390×844 | [event-setup](../../apps/wechat/pages/event-setup/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O03 · 办赛模板](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1080) | 机构负责人／管理员 | E 已实现源码 | 390×844 | [event-setup](../../apps/wechat/pages/event-setup/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O04 · 招募、导入与邀请](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1124) | 赛事负责人 | E 已实现源码 | 390×844 | [recruitment](../../apps/wechat/pages/recruitment/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O05 · 报名独立审核](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1174) | 无关联的独立审核人 | E 已实现源码 | 390×844 | [entry-review](../../apps/wechat/pages/entry-review/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O10 · 青少年关系审核](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1224) | 有权且无关联的独立审核人 | E 已实现源码 | 390×844 | [youth-review](../../apps/wechat/pages/youth-review/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O06 · 抽签与排程](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1272) | 赛事负责人 | E 已实现源码 | 390×844 | [schedule](../../apps/wechat/pages/schedule/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O07 · 晋级与下一轮发布](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1325) | 赛事负责人 | E 已实现源码 | 390×844 | [bracket](../../apps/wechat/pages/bracket/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O08 · 比赛改期](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1365) | 赛事负责人 | E 已实现源码 | 390×844 | [reschedule](../../apps/wechat/pages/reschedule/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O09 · 工作人员配置](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1401) | 机构／赛事授权管理者 | E 已实现源码 | 390×844 | [staff-configuration](../../apps/wechat/pages/staff-configuration/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O11 · 弃权与取消裁定](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1454) | 提议人与独立复核人 | E 已实现源码 | 390×844 | [match-exceptions](../../apps/wechat/pages/match-exceptions/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [O12 · 比赛管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=6-1492) | 被授权工作人员 | E 已实现源码 | 390×844 | [org-match](../../apps/wechat/pages/org-match/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [S01 · 记分与复核任务](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-528) | 被指派的记分员／复核人 | E 已实现源码 | 390×844 | [scoring-tasks](../../apps/wechat/pages/scoring-tasks/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [S02 · 现场记分](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-567) | 本场记分员 | E 已实现源码 | 390×844 | [scorer](../../apps/wechat/pages/scorer/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [S03 · 阵容与换人](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-639) | 持有控制权的记分员 | E 已实现源码 | 390×844 | [scorer](../../apps/wechat/pages/scorer/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [S04 · 专业事件记录](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-686) | 持有控制权的记分员 | E 已实现源码 | 390×844 | [scorer](../../apps/wechat/pages/scorer/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [S05 · 离线草稿](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-737) | 本场原登录账号 | E 已实现源码 | 390×844 | [scorer](../../apps/wechat/pages/scorer/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [S06 · 同步冲突与更正](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-775) | 本场记分员 | E 已实现源码 | 390×844 | [scorer](../../apps/wechat/pages/scorer/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [S07 · 独立确认赛果](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-832) | 其他独立有权复核人 | E 已实现源码 | 390×844 | [org-match](../../apps/wechat/pages/org-match/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [S08 · 赛果已确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-877) | 有权工作人员 | E 已实现源码 | 390×844 | [org-match](../../apps/wechat/pages/org-match/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [E09 · 正式比赛赛果](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-933) | 公开访客 | E 已实现源码 | 390×844 | [match](../../apps/wechat/pages/match/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [L02 · 设置附近起点](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-983) | 公开访客 | X 定位与地图已有代码；正式配置及真机待验 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [L03 · 球场与可约档期](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1024) | 访客浏览／本人预约 | E 已实现源码 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [L04 · 同城人员服务](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1072) | 本人需求方 | E 已实现源码 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [L05 · 同城预约订单](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1115) | 订单本人参与方 | E 已实现源码 | 390×844 | [local-bookings](../../apps/wechat/pages/local-bookings/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [L06 · 服务履约进度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1169) | 需求方／实际服务方 | E 已实现源码 | 390×844 | [local-bookings](../../apps/wechat/pages/local-bookings/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [L07 · 球队约赛](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1239) | 双方球队授权代表 | E 已实现源码 | 390×844 | [local-matchups](../../apps/wechat/pages/local-matchups/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [L08 · 供给与服务方管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1282) | 供给管理者／独立审核者 | E 已实现源码 | 390×844 | [local-manage](../../apps/wechat/pages/local-manage/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [V01 · 创建本场直播](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1332) | 本场授权直播管理人员 | X 已有代码；正式微信、腾讯及外站待验 | 390×844 | [live-studio](../../apps/wechat/pages/live-studio/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [V02 · 直播独立批准](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1373) | 与申请／采集者分开的管理者 | X 接入后条件流程；原型为合成演示 | 390×844 | [live-studio](../../apps/wechat/pages/live-studio/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [V03 · 本机采集与预检](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1415) | 当前授权采集人员 | X 接入待验；独立预检页为交互重组 | 390×844 | [live-studio](../../apps/wechat/pages/live-studio/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [V04 · 直播控制](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1473) | 当前授权采集人员 | X 合成运行状态；正式双目标待验 | 390×844 | [live-studio](../../apps/wechat/pages/live-studio/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [V05 · 停流待确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1524) | 采集人员／直播管理者 | X 已有停流屏障代码；正式物理证据待验 | 390×844 | [live-studio](../../apps/wechat/pages/live-studio/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [V06 · 录像与媒体作业](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1567) | 有权媒体工作人员 | X 已有执行代码；正式长时媒体与容量待验 | 390×844 | [media-jobs](../../apps/wechat/pages/media-jobs/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [V07 · 比赛媒体与授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1619) | 有权赛事媒体管理者 | E 已实现源码 | 390×844 | [match-media](../../apps/wechat/pages/match-media/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [V08 · 授权宣传海报](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=8-1662) | 有权赛事工作人员 | E 已实现源码 | 390×844 | [poster](../../apps/wechat/pages/poster/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [F01 · 本次资金订单](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-686) | 来源订单有权参与者 | X 已有交易代码；正式商户联调待验 | 390×844 | [trade-order](../../apps/wechat/pages/trade-order/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [F02 · 付款结果核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-741) | 付款本人 | X 接入后付款条件状态；无真实资金 | 390×844 | [trade-order](../../apps/wechat/pages/trade-order/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [F03 · 退款申请与进度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-784) | 订单参与方／独立复核人 | X 已有代码；正式退款联调待验 | 390×844 | [trade-order](../../apps/wechat/pages/trade-order/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [F04 · 保证金与扣减](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-828) | 有权提议人／独立复核人 | X 交易源码已实现；正式渠道待验 | 390×844 | [trade-order](../../apps/wechat/pages/trade-order/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [F05 · 对账与结算](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-869) | 当前机构有权财务／独立复核人 | X 代码已实现；真实日账与分账待验 | 390×844 | [trade-manage](../../apps/wechat/pages/trade-manage/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [F06 · 收款条款管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-913) | 机构有权管理者／独立审批人 | E 条款源码已实现；外部资金另验 | 390×844 | [trade-manage](../../apps/wechat/pages/trade-manage/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A02 · 账号与隐私](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-954) | 本人 | E 已实现源码 | 390×844 | [account](../../apps/wechat/pages/account/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A03 · 登录与微信绑定](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1025) | 未登录／本人 | E 账号已实现；正式微信身份联调待验 | 390×844 | [account](../../apps/wechat/pages/account/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A04 · 验证邮箱与找回](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1063) | 本人 | X 源码已实现；正式邮件发送待验 | 390×844 | [account-recovery](../../apps/wechat/pages/account-recovery/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A05 · 账号自助注销](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1099) | 本人重新认证 | E 已实现源码 | 390×844 | [account-closure](../../apps/wechat/pages/account-closure/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A06 · 客服、举报与争议](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1155) | 本人／明确分派的工作人员 | E 已实现源码 | 390×844 | [governance](../../apps/wechat/pages/governance/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A07 · 服务评价](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1203) | 真实参与且已完成订单的一方 | E 已实现源码 | 390×844 | [governance-reviews](../../apps/wechat/pages/governance-reviews/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A08 · 城市运营工作台](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1242) | 明确授权的城市操作员 | E 已实现源码 | 390×844 | [city-operations](../../apps/wechat/pages/city-operations/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A09 · 赞助与广告投放](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1288) | 机构投放者／独立审核者／访客 | E 已实现源码 | 390×844 | [sponsorships](../../apps/wechat/pages/sponsorships/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A10 · 赛事经费公示](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1328) | 公开访客／有权账务管理者 | E 已实现源码 | 390×844 | [public-ledgers](../../apps/wechat/pages/public-ledgers/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [A11 · 平台处理工作台](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1376) | 明确授权的平台人员 | E 已实现源码 | 390×844 | [platform](../../apps/wechat/pages/platform/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [F07 · 软件服务与资金说明](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1431) | 有权机构用户 | P 旧规划说明；不是钱包或通用支付入口 | 390×844 | [planned](../../apps/wechat/pages/planned/index.wxml) | 规则说明，不展示静态零额为实收；不是钱包或通用支付入口 |
| [V09 · 授权回放](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=9-1465) | 公开访客 | E 已实现源码 | 390×844 | [match](../../apps/wechat/pages/match/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X01 · 正在加载](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-793) | 视具体业务的当前用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [home](../../apps/wechat/pages/home/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X02 · 本地暂无供给](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-819) | 视具体业务的当前用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X03 · 读取失败](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-847) | 视具体业务的当前用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [home](../../apps/wechat/pages/home/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X04 · 没有当前权限](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-875) | 失权／无权账号 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [org-event](../../apps/wechat/pages/org-event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X05 · 登录后继续](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-901) | 未登录用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [account](../../apps/wechat/pages/account/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X06 · 直播尚未开通](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-927) | 有权直播人员 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [live-studio](../../apps/wechat/pages/live-studio/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X07 · 操作处理中](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-957) | 视具体业务的当前用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [trade-order](../../apps/wechat/pages/trade-order/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X08 · 原操作结果待核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-983) | 视具体业务的当前用户 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [trade-order](../../apps/wechat/pages/trade-order/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X09 · 内容已停止公开](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-1011) | 公开访客 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [event](../../apps/wechat/pages/event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X10 · 记分台已被占用](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-1037) | 已分配但未持控制权的记分员 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [scorer](../../apps/wechat/pages/scorer/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X11 · 上传未完成](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-1070) | 本人 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [participant-materials](../../apps/wechat/pages/participant-materials/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [X12 · 资料版本已变化](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=10-1096) | 本人／有权审核人 | E 通用交互状态；实际能力以对应来源为准 | 390×844 | [participant-materials](../../apps/wechat/pages/participant-materials/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总 |
| [H01W320 · 小城市篮球](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-835) | 公开访客／已登录用户 | 适配审阅 · 320px；沿用H01 | 320×844 | [home](../../apps/wechat/pages/home/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [E02W320 · 赛事详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-945) | 公开访客 | 适配审阅 · 320px；沿用E02 | 320×844 | [event](../../apps/wechat/pages/event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [R03W320 · 本人报名资料](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1015) | 球员本人 | 适配审阅 · 320px；沿用R03 | 320×844 | [participant-materials](../../apps/wechat/pages/participant-materials/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [S02W320 · 现场记分](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1087) | 本场记分员 | 适配审阅 · 320px；沿用S02 | 320×844 | [scorer](../../apps/wechat/pages/scorer/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [V04W320 · 直播控制](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1159) | 当前授权采集人员 | 适配审阅 · 320px；沿用V04 | 320×844 | [live-studio](../../apps/wechat/pages/live-studio/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [H01W430 · 小城市篮球](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1210) | 公开访客／已登录用户 | 适配审阅 · 430px；沿用H01 | 430×844 | [home](../../apps/wechat/pages/home/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [E02W430 · 赛事详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1320) | 公开访客 | 适配审阅 · 430px；沿用E02 | 430×844 | [event](../../apps/wechat/pages/event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [R03W430 · 本人报名资料](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1390) | 球员本人 | 适配审阅 · 430px；沿用R03 | 430×844 | [participant-materials](../../apps/wechat/pages/participant-materials/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [S02W430 · 现场记分](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1462) | 本场记分员 | 适配审阅 · 430px；沿用S02 | 430×844 | [scorer](../../apps/wechat/pages/scorer/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [V04W430 · 直播控制](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=11-1534) | 当前授权采集人员 | 适配审阅 · 430px；沿用V04 | 430×844 | [live-studio](../../apps/wechat/pages/live-studio/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [Q320 · 赛事详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=16-967) | 公开访客 | 压力检查 · 320px · 合成长名称 | 320×844 | [event](../../apps/wechat/pages/event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [Q430 · 赛事详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=16-1000) | 公开访客 | 压力检查 · 430px · 合成长名称 | 430×844 | [event](../../apps/wechat/pages/event/index.wxml) | 既有路由承载；UI002当前验证待集成人汇总；尺寸稿复用源路由 |
| [V10 · 横屏直播控制](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=16-1033) | 当前授权采集人员 | X 横屏交互设计；真机及正式推流待验 | 844×390 | [live-studio](../../apps/wechat/pages/live-studio/index.wxml) | 复用直播台；横屏设备/正式推流未验，不宣称独立横屏实现 |
| [IN01 · 赛事保险](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1032) | 本人／监护人 | 未开通 | 390×844 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 销售关闭；保留外购保单和原单核对，真实供应商未接 |
| [IN02 · 产品与保障条款](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1061) | 本人／监护人 | 合规主体/销售模式获批后的条件界面 | 390×844 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 获批后的条件界面；当前不开放新投保，不以设计替代供应商准入 |
| [IN03 · 核对投保资料](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1099) | 成年本人；未成年人仅关闭提示 | 本人私有资料确认／授权不足阻塞 | 390×844 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 获批后的条件界面；当前不开放新投保，不以设计替代供应商准入 |
| [IN04 · 前往保险服务方](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1139) | 本人／监护人 | 跳转服务方与获准提交分支 | 390×844 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 获批后的条件界面；当前不开放新投保，不以设计替代供应商准入 |
| [IN05 · 保险结果待核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1168) | 本人／监护人 | 付款已确认／承保结果未知 | 390×844 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 原单核对/取消及双状态；正式出单、退保、退款未验 |
| [IN06 · 保单详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1198) | 本人／有权审核员 | 已出单／资格仍独立审核 | 390×844 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 原单核对/取消及双状态；正式出单、退保、退款未验 |
| [IN07 · 本次未承保](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1228) | 本人／监护人 | 拒保／报价失效／付款独立核对 | 390×844 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 原单核对/取消及双状态；正式出单、退保、退款未验 |
| [IN08 · 退保与退款进度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1257) | 本人／监护人 | 申请受理／保单与退款双状态 | 390×844 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 原单核对/取消及双状态；正式出单、退保、退款未验 |
| [MP01 · 同城地图找服务](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1288) | 公开访客 | 初始／未定位仍浏览 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 视野与当前筛选交集；地图失败保留列表，真机地图事件未验 |
| [MP02 · 搜索此区域](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1328) | 公开访客 | 地图已移动／旧结果保持原范围 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 视野与当前筛选交集；地图失败保留列表，真机地图事件未验 |
| [MP03 · 正在搜索此区域](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1370) | 公开访客 | 搜索中再拖动／旧响应作废 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 视野与当前筛选交集；地图失败保留列表，真机地图事件未验 |
| [MP04 · 区域服务结果](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1408) | 公开访客／预约人 | 搜索成功／选中服务卡 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 视野与当前筛选交集；地图失败保留列表，真机地图事件未验 |
| [MP05 · 此区域暂无供给](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1450) | 公开访客 | 空结果 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 视野与当前筛选交集；地图失败保留列表，真机地图事件未验 |
| [MP06 · 请缩小搜索范围](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1487) | 公开访客 | 超范围／过密结果 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 视野与当前筛选交集；地图失败保留列表，真机地图事件未验 |
| [MP07 · 确认跨城浏览范围](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1523) | 公开访客 | 跨城范围确认 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 视野与当前筛选交集；地图失败保留列表，真机地图事件未验 |
| [MP08 · 地图暂时无法显示](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=40-1550) | 公开访客 | 地图失败／列表仍可用 | 390×844 | [local](../../apps/wechat/pages/local/index.wxml) | 视野与当前筛选交集；地图失败保留列表，真机地图事件未验 |
| [NM01 · 发布篮球服务需求](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1112) | 本人／有权领队 | 填写需求／真实地点时段 | 390×844 | [matching](../../apps/wechat/pages/matching/index.wxml) | 本页需求/公开审阅/候选/意向；转换回原预约，意向不等成单 |
| [NM02 · 确认需求公开范围](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1148) | 本人／有权领队 | 逐项授权／需求发布前审阅 | 390×844 | [matching](../../apps/wechat/pages/matching/index.wxml) | 本页需求/公开审阅/候选/意向；转换回原预约，意向不等成单 |
| [NM03 · 候选服务与比较](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1186) | 需求发布人 | 匹配理由／报价证据／非自动成单 | 390×844 | [matching](../../apps/wechat/pages/matching/index.wxml) | 本页需求/公开审阅/候选/意向；转换回原预约，意向不等成单 |
| [NM04 · 服务意向详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1222) | 需求发布人／对应服务方 | 双方有意向／不锁档期 | 390×844 | [matching](../../apps/wechat/pages/matching/index.wxml) | 本页需求/公开审阅/候选/意向；转换回原预约，意向不等成单 |
| [NM05 · 我的服务需求](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1254) | 本人／有权领队 | 列表／草稿／已发布／撤回 | 390×844 | [matching](../../apps/wechat/pages/matching/index.wxml) | 本页需求/公开审阅/候选/意向；转换回原预约，意向不等成单 |
| [NM06 · 请重新核对候选](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1285) | 需求发布人 | 资格/时段/报价/需求版本变化 | 390×844 | [matching](../../apps/wechat/pages/matching/index.wxml) | 本页需求/公开审阅/候选/意向；转换回原预约，意向不等成单 |
| [NM07 · 暂未找到合适候选](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1312) | 需求发布人 | 无候选／证据覆盖不足 | 390×844 | [matching](../../apps/wechat/pages/matching/index.wxml) | 本页需求/公开审阅/候选/意向；转换回原预约，意向不等成单 |
| [DS01 · 发起跨城服务邀约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1340) | 有权办赛方／服务购买人 | 需求与邀请设置 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 本页邀约/报价/唯一赢家；原预约、付款与履约分别判断 |
| [DS02 · 我的跨城服务偏好](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1378) | 工作人员本人 | 服务覆盖／出行规则／需主动同意 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 本页邀约/报价/唯一赢家；原预约、付款与履约分别判断 |
| [DS03 · 邀请与分项报价](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1416) | 受邀工作人员本人 | 邀请有效／资格与交通已核实的成功分支 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 本页邀约/报价/唯一赢家；原预约、付款与履约分别判断 |
| [DS04 · 客户确认跨城报价](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1454) | 本次服务购买人 | 报价锁／地点时间费用集中确认 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 本页邀约/报价/唯一赢家；原预约、付款与履约分别判断 |
| [DS05 · 跨城预约待确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1490) | 购买人／当前履约方 | 原预约REQUESTED／未承接未付款 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 本页邀约/报价/唯一赢家；原预约、付款与履约分别判断 |
| [DS06 · 报价已失效](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1519) | 购买人／受邀人员 | 锁到期／需求版本变化 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 本页邀约/报价/唯一赢家；原预约、付款与履约分别判断 |
| [DS07 · 本次已由他人承接](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1546) | 受邀工作人员本人 | 并发承接未中选／不扣款不占日历 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 本页邀约/报价/唯一赢家；原预约、付款与履约分别判断 |
| [DS08 · 暂时无人承接](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=42-1573) | 本次服务购买人／调度员 | 批次结束／无有效承接 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 本页邀约/报价/唯一赢家；原预约、付款与履约分别判断 |
| [TR01 · 同城篮球课程](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1212) | 公开访客／报名人 | 课程列表／按真实城市供给开放 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [TR02 · 课程与班次详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1244) | 公开访客／报名人 | 课程说明／资质／容量与退款条款 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [TR03 · 学员与报名授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1279) | 本人／已核验监护人／付款人 | 学员监护付款身份分别确认 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [TR04 · 名额已暂时保留](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1319) | 本次付款人／监护人 | 有效锁位／明确到期与费用 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [TR05 · 课程付款待核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1351) | 本次付款人 | 渠道返回／付款与报名待核对 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [TR06 · 我的课程与课次](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1378) | 学员本人／有效监护人 | 报名已确认／课程表／消费明细 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [TR07 · 到场签到与课次明细](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1412) | 监护人／当班有权教练 | 到场/接送/授课消费分别记录 | 390×844 | [training-manage](../../apps/wechat/pages/training-manage/index.wxml) / [training](../../apps/wechat/pages/training/index.wxml) | 当班有权教练/本人明细；签到、授课与独立消费确认分开 |
| [TR08 · 请假、补课与退费](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1441) | 本人／有效监护人／付款人按权限 | 申请与结果分态／退款原渠道核对 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [TR09 · 付款已确认，名额待处理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1474) | 本次付款人／监护人 | 晚付款／锁过期无名额 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [TR10 · 监护与接送确认](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1503) | 本人／已核验监护人 | 监护撤回／阻塞新增处理与交接 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T2培训监护用途流程关闭；不复用赛事监护授权，不做虚假确认 |
| [TR11 · 课程变更与课次争议](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1532) | 学员本人／监护人／机构处理人 | 停课改期／出勤争议／保留证据 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) / [training-manage](../../apps/wechat/pages/training-manage/index.wxml) | 本人课次与有权教务争议处理；不伪造改期/消费/退款结果 |
| [TR12 · 班次满员与候补](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=43-1565) | 本人／监护人 | 满员／主动候补／不得先收确定席位费 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [AD01 · 广告合同与分成协议](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1277) | 有权机构商务／合同管理员 | 合同版本／参与方签署 | 1440×960 | [sponsor-commerce](../../apps/wechat/pages/sponsor-commerce/index.wxml) | 桌面稿适配既有移动管理区；仅实际capability可见，默认不展示配置 |
| [AD02 · 实际收款与交付证据](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1314) | 有权机构商务／财务经办 | 真实收款核验／履约独立验收 | 1440×960 | [sponsor-commerce](../../apps/wechat/pages/sponsor-commerce/index.wxml) | 桌面稿适配既有移动管理区；仅实际capability可见，默认不展示配置 |
| [AD03 · 结算预览与金额守恒](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1349) | 财务经办（申请人） | 不可变预览／未提交审核 | 1440×960 | [sponsor-commerce](../../apps/wechat/pages/sponsor-commerce/index.wxml) | 桌面稿适配既有移动管理区；仅实际capability可见，默认不展示配置 |
| [AD04 · 独立审核结算申请](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1384) | 独立财务审核员（非申请人） | 申请与批准分离／固定版本复核 | 1440×960 | [sponsor-commerce](../../apps/wechat/pages/sponsor-commerce/index.wxml) | 桌面稿适配既有移动管理区；仅实际capability可见，默认不展示配置 |
| [AD05 · 分账执行与逐方核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1421) | 独立执行员／有权财务 | 渠道结果未知／部分成功 | 1440×960 | [sponsor-commerce](../../apps/wechat/pages/sponsor-commerce/index.wxml) | 桌面稿适配既有移动管理区；仅实际capability可见，默认不展示配置 |
| [AD06 · 退款与分账回退处理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1465) | 独立审核员／有权财务 | 退款占用／回退未知或不足额 | 1440×960 | [sponsor-commerce](../../apps/wechat/pages/sponsor-commerce/index.wxml) | 桌面稿适配既有移动管理区；仅实际capability可见，默认不展示配置 |
| [OP01 · 保险供应商与原单核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1502) | 授权保险运营／独立核对员 | 供应商未选定关闭／只读查单与差异 | 1440×960 | [insurance](../../apps/wechat/pages/insurance/index.wxml) | 关闭态与原单核对已接线；不新增独立1440供应商后台，真实adapter仍阻塞 |
| [OP02 · 跨城邀约与调度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1539) | 当前城市／机构范围内授权调度员 | 批次与锁／单赢家／人工换人 | 1440×960 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 桌面调度稿适配当前范围移动调度区；不新增全国权限 |
| [OP03 · 培训排课与招生管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1578) | 当前机构授权教务／财务 | 排课容量／教师与场地冲突／招生 | 1440×960 | [training-manage](../../apps/wechat/pages/training-manage/index.wxml) | 桌面教务稿适配既有有权移动工作区；不新建假后台 |
| [AD07 · 我的广告收入对账](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1618) | 当前收款方本人／本机构有权财务 | 仅己方金额与原渠道结果 | 390×844 | [sponsor-commerce](../../apps/wechat/pages/sponsor-commerce/index.wxml) | 本人合同/对账或独立审批；真实资金与逐方渠道结果分别核对 |
| [AD08 · 结算独立审批](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1646) | 独立财务审核员 | 390只读核对与审批／无配置入口 | 390×844 | [sponsor-commerce](../../apps/wechat/pages/sponsor-commerce/index.wxml) | 本人合同/对账或独立审批；真实资金与逐方渠道结果分别核对 |
| [OP04 · 教练今日课表](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1680) | 当前班次有权教练 | 签到／授课完成／消费待独立确认 | 390×844 | [training-manage](../../apps/wechat/pages/training-manage/index.wxml) | 当班教练课表；签到、授课与独立消费分别判断 |
| [TR13 · 候补登记已受理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1712) | 本人／有效监护人 | 已候补／未报名未锁位未扣款 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [MP04W320 · 区域服务结果](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1742) | 公开访客／预约人 | 响应检查 320px；搜索成功／选中服务卡 | 320×844 | [local](../../apps/wechat/pages/local/index.wxml) | 视野与当前筛选交集；地图失败保留列表，真机地图事件未验；尺寸稿复用源路由 |
| [MP04W430 · 区域服务结果](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1784) | 公开访客／预约人 | 响应检查 430px；搜索成功／选中服务卡 | 430×844 | [local](../../apps/wechat/pages/local/index.wxml) | 视野与当前筛选交集；地图失败保留列表，真机地图事件未验；尺寸稿复用源路由 |
| [NM03W320 · 候选服务与比较](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1826) | 需求发布人 | 响应检查 320px；匹配理由／报价证据／非自动成单 | 320×844 | [matching](../../apps/wechat/pages/matching/index.wxml) | 本页需求/公开审阅/候选/意向；转换回原预约，意向不等成单；尺寸稿复用源路由 |
| [NM03W430 · 候选服务与比较](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1862) | 需求发布人 | 响应检查 430px；匹配理由／报价证据／非自动成单 | 430×844 | [matching](../../apps/wechat/pages/matching/index.wxml) | 本页需求/公开审阅/候选/意向；转换回原预约，意向不等成单；尺寸稿复用源路由 |
| [TR03W320 · 学员与报名授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1898) | 本人／已核验监护人／付款人 | 响应检查 320px；学员监护付款身份分别确认 | 320×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭；尺寸稿复用源路由 |
| [TR03W430 · 学员与报名授权](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1938) | 本人／已核验监护人／付款人 | 响应检查 430px；学员监护付款身份分别确认 | 430×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭；尺寸稿复用源路由 |
| [DS04W320 · 客户确认跨城报价](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-1978) | 本次服务购买人 | 响应检查 320px；报价锁／地点时间费用集中确认 | 320×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 本页邀约/报价/唯一赢家；原预约、付款与履约分别判断；尺寸稿复用源路由 |
| [DS04W430 · 客户确认跨城报价](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-2014) | 本次服务购买人 | 响应检查 430px；报价锁／地点时间费用集中确认 | 430×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 本页邀约/报价/唯一赢家；原预约、付款与履约分别判断；尺寸稿复用源路由 |
| [AD03W1024 · 结算预览与金额守恒](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-2051) | 财务经办（申请人） | 响应检查 1024px；不可变预览／未提交审核 | 1024×960 | [sponsor-commerce](../../apps/wechat/pages/sponsor-commerce/index.wxml) | 桌面稿适配既有移动管理区；仅实际capability可见，默认不展示配置；尺寸稿复用源路由 |
| [OP02W1024 · 跨城邀约与调度](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-2086) | 当前城市／机构范围内授权调度员 | 响应检查 1024px；批次与锁／单赢家／人工换人 | 1024×960 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) | 桌面调度稿适配当前范围移动调度区；不新增全国权限；尺寸稿复用源路由 |
| [OP03W1024 · 培训排课与招生管理](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=44-2125) | 当前机构授权教务／财务 | 响应检查 1024px；排课容量／教师与场地冲突／招生 | 1024×960 | [training-manage](../../apps/wechat/pages/training-manage/index.wxml) | 桌面教务稿适配既有有权移动工作区；不新建假后台；尺寸稿复用源路由 |
| [TR14 · 未获名额原单退费](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1791) | 原付款人／有权财务 | 晚付款未获名额／消费0／原款960独立处理 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T1成人短课；候补/锁位/付款/课次分态，T2和课包关闭 |
| [TR15 · 培训监护与用途核验](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1819) | 本人／已核验监护人／有权教务 | 培训专用授权待重新确认／不复用赛事授权 | 390×844 | [training](../../apps/wechat/pages/training/index.wxml) | T2培训监护用途流程关闭；不复用赛事监护授权，不做虚假确认 |
| [DS09 · 服务方确认原预约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1851) | 当前受邀服务方本人 | 最终承接前复检资格/时段/锁 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) / [local-bookings](../../apps/wechat/pages/local-bookings/index.wxml) | 派单详情连回原预约；最终承接/付款/履约继续由原来源判断 |
| [DS10 · 承接已确认，付款待核对](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1882) | 原购买人／当前履约方 | 已承接／原付款未知 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) / [local-bookings](../../apps/wechat/pages/local-bookings/index.wxml) | 派单详情连回原预约；最终承接/付款/履约继续由原来源判断 |
| [DS11 · 跨城服务确认详情](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1907) | 原购买人／当前履约方 | 承接与付款分别已确认／待到场 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) / [local-bookings](../../apps/wechat/pages/local-bookings/index.wxml) | 派单详情连回原预约；最终承接/付款/履约继续由原来源判断 |
| [DS12 · 本次跨城服务履约](https://www.figma.com/design/BSQ64CrDTJ2P4tOIowOSFk?node-id=49-1935) | 原购买人／当前履约方／有权处理人 | 到场/服务/验收分别记录／争议分支 | 390×844 | [dispatch](../../apps/wechat/pages/dispatch/index.wxml) / [local-bookings](../../apps/wechat/pages/local-bookings/index.wxml) | 派单详情连回原预约；最终承接/付款/履约继续由原来源判断 |

## 合并前收口

root须按最终整合HEAD补实际页面改动范围、关键正常/异常fixture、源码/格式/类型/构建、三宽PNG与直接API消费者验证、独立Review结果。本文件只提供映射和差异；未验证的真机、支付、保险、直播及生产不随Git合并改为已完成。

本片仅修改Markdown，没有修改应用、API、权限、资金、数据库、依赖或配置；没有编写/执行Migration，没有pack、部署、正式渠道或生产操作。
