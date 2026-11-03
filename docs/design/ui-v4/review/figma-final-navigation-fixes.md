# Figma导航定稿：三处入口校正

只读核验基线：main@`02c4fcf324de72f243261dbacf17c834c6d15537`，2026-11-02（Asia/Shanghai）。未改Figma、数据、GitHub或业务代码。本报告补充同路由内状态与query，不能用一个主视图代表同页所有角色状态。

## 1. 同城供给详情／档期：在local本页，不是先进入订单列表

源码：`apps/wechat/pages/local/index.js`、`index.wxml`。

- 供给卡和“查看场馆与可约时间／查看人员与可约时间”均是`data-id=item.id`＋`bindtap="detail"`。
- `detail(e)`调用`showDetail(e.currentTarget.dataset.id)`。
- `showDetail(id)`读取供给详情后设置本页`detail`，显示WXML的`detail-card`；开始时清空费用预览、条款同意、已选档期和服务地址。
- 档期按钮调用`slot(e)`，设置`selectedSlot`；`accept(e)`确认合作约定；`previewCharge()`读取实际收费条款；收费启用时还需`chargeConsent(e)`。
- 人员服务需明确实际服务地址，设备定位不会自动作为订单地址。
- `closeDetail()`收起本页详情，不是navigateBack。
- 支持分享／外部深链：`/pages/local/index?listing=<真实listingId>`。onLoad读取`query.listing`，onShow触发showDetail。不能伪造UUID。
- `book()`确认当前可约档期、合作条款、收费读取及相关同意后写原预约；**只有写结果已确认成功时**调用`ls.open('local-bookings')`。
- `bookings()`才是“我的预约”直接进入`local-bookings`。

**最小Figma表现：** 保留现有local列表主视图，增加同一路由状态“local／供给详情与档期”。列表卡、“查看档期”连到这个状态；详情内含可约时间、服务地点、合作约定、费用核对与提交条件。关闭详情回local列表。“我的预约”可直接连订单列表；“提交预约”不能不经本页核对就直接连订单列表，未满足条件保持禁用或进入待补状态。提交后另区分回执成功与结果未知。

## 2. 本人球员中心“收到的预约”：bookings?view=received

源码：`apps/wechat/pages/player-center/index.js`、`index.wxml`及`pages/bookings/index.js`。

- “查看收到的预约／处理收到的预约／查看已有合作”均调用`received()`。
- 精确实现：`ui.open('bookings', { view: 'received' })`。
- 目标URL：`/pages/bookings/index?view=received`。
- bookings.onLoad：仅当query.view为received时设置收件视角，否则默认`sent`。只连到不带query的bookings主视图，会误变为需求方发出的预约。
- 进入逐场详情携带当前视角：`ui.open('booking-detail', { id, view: this.data.view })`，应保留`view=received`。
- 本人数据授权另为`performance()`→`ui.open('performance', { own:'1' })`，与收到预约分开。

**最小Figma表现：** 给bookings增加同路由“收到的预约”角色状态，标明“本人服务方／收到的请求”，与原“我发出的”列表分开。player-center该入口只连received状态，收到请求的详情保留当前视角；不把一个默认sent列表当所有预约通用落点。

## 3. 平台“城市授权／评价处理”：跨路由，但必须携带mode=platform

源码：`apps/wechat/pages/platform/index.js`、`index.wxml`以及目标两页源码。

platform界面“城市与服务治理”中的三个入口均调用`operations(e)`。该函数先检查`this.data.allowed`并限制目标为governance、governance-reviews、city-operations，然后：

```js
ui.open(key, { mode: 'platform' });
```

### 城市运营权限

- 精确目标：`/pages/city-operations/index?mode=platform`。
- city-operations.onLoad在q.mode为platform时设置platform=true。
- load时还要求真实session.platformOperator，才读平台接口；query本身不授予平台权限。
- 同页分“我的授权”和“平台授权维护”。平台视角WXML条件是`platform && canManage`，显示“授予有限权限”区域：机构、人员、地区、具体操作、到期时间、原因；当前有效条目可永久撤销。
- 默认不带mode的city-operations是“我的授权”视角，不是平台授权维护。
- 允许的操作范围是供给资质审核、供给质量下架、明确分派工单处理、城市赞助审核。不是“全城私有资料管理员”。

**最小Figma表现：** 现有city-operations个人有限授权页保留；新增同路由“平台授权维护”状态，平台入口连后者。显示平台tab、限定授权表单和已有授权条目；新增／撤销仍需当前权限与原流程核对。不得直接连回普通城市运营个人主页。

### 平台评价处理

- 精确目标：`/pages/governance-reviews/index?mode=platform`。
- governance-reviews.onLoad设置mode=platform，load再以session.platformOperator核验；平台读`/v1/platform/governance/reviews`，否则回mine视角。
- 同页分“我的评价”和“平台独立审核”。
- 本人mine视角是评价真实完成订单、分数、评论和公开同意。
- 平台视角显示待审核评价列表，`PENDING_REVIEW`才有“独立审核并公开／退回评价”动作；不是让平台人员写自己的星级评价。

**最小Figma表现：** 保留原“本人服务评价”状态；新增同路由“平台独立审核”状态，平台入口只连此状态。显示待审核评价、当前状态及独立处理按钮，不出现给本人订单打星的表单。

### 补充：平台“服务资料审核”才是platform本页面板

- `review(e)`读取本页reviewQueue中的准确条目，设置`reviewOpen=true`、审核对象／版本／快照；`closeReview()`收回本次编辑。
- 打开的是platform本页review-editor，非local-manage供给管理页。
- 面板含本人服务档案快照、处理状态、至少2字原因及当前明确同意，提交前再次读取当前版本与权限。

**最小Figma表现：** 服务资料审核卡连platform自己的“资料审核展开”状态，不连local-manage。平台预约记录`order(e)`才是携具体id进入booking-detail。

## 建议的原型落点表

| 来源控件 | 原型落点 | 实现语义 |
| --- | --- | --- |
| local供给卡／查看档期 | local／供给详情与档期 | detail → showDetail；本页状态 |
| local关闭详情 | local／列表 | closeDetail；本页收起 |
| local我的预约 | local-bookings／本人 | bookings；直接查原订单 |
| local预约确认已成功 | local-bookings／当前原订单 | book写确认后；未知结果另查回执 |
| player-center收到的预约 | bookings／received | query view=received |
| platform城市运营权限 | city-operations／platform | query mode=platform＋真实平台权限 |
| platform评价处理 | governance-reviews／platform | query mode=platform＋真实平台权限 |
| platform服务资料审核 | platform／reviewOpen | 本页审核面板 |

以上状态不新增原生路由，也不意味着新增后端能力或给普通用户开放平台角色。Figma画板／链接应说明角色、同页状态和query；Cursor实现仍复用原事件、真实id及服务端权限。
