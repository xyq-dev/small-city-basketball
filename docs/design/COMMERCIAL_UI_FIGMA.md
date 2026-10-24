# D01 商业版 Figma UI 全景初稿

2026-10-24（Asia/Shanghai）；root 设计集成。设计交付完成，用户视觉确认及前端实现另行推进。本稿不改变现有产品架构、比赛状态、权限或计时源。

**[从导览打开 Figma](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=18-2)**。文件「小城市篮球 · 商业版 UI 设计系统」，file key `2jAHpYjdIHqal1nXeoVqm6`。所有界面为原生可编辑图层与组件实例，没有用整页位图代替界面。

## 范围与导航

共10个页面、94张业务及状态画板：75张业务画板（包含阶段状态和尺寸变体）及19张异常/权限画板。另有封面、2张设计系统审阅板和F01交接板，共98张审阅画板。数量不代表94个独立业务模块。

| 分区 | 业务/状态画板 | 入口 |
| --- | --- | --- |
| 00 导览与交付说明 | 封面另计 | [导览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=18-2) |
| 01 设计系统 | 2张规范审阅板另计 | [品牌规范](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=14-153)、[组件](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=14-227) |
| 02 机构赛事后台 | 18 | [机构总览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-49) |
| 03 现场记分与媒体 | 11 | [记分台](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-93)、[OBS预览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-879) |
| 04 平台商业运营 | 11 | [软件服务套餐](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-8)、[独立财务复核](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-569) |
| 05 微信观赛与球员 | 16 | [观赛](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-8)、[比赛](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-155) |
| 06 球队报名与资料 | 11 | [球队](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-818)、[提交核对](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-1139) |
| 07 异常状态与权限 | 19 | [状态集合](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=15-1938) |
| 08 移动端后台适配 | 4 | [手机赛务](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-297)、[手机记分](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-446) |
| 09 交互说明与开发交接 | 4，另有F01 | [身份选择](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=12-47)、[交接说明](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=12-185) |

桌面画板1440×1040，手机画板390×844，长内容使用滚动容器。沿用深蓝`#132C49`、橙色`#FF6B2D`与浅灰`#F5F7FA`。中文采用项目现有回退字体Noto Sans SC，数字采用Inter。

12个文件内组件组、41个变体：Button、Badge、Field、NavItem、Tab、Notice、Step、KPI、Avatar、Cell、MatchCard、MobileNav。53个变量包含18基础色、18语义色、17尺寸/圆角；12个文本样式，另有阴影样式。语义色含Light/Dark模式，不代表每张页面都完成双主题设计或验收；没有发布团队组件库或配置Code Connect。

## 现有能力与规划边界

画板外部标注 **E：设计对齐已有Web/API能力**；这不表示新UI已写入代码，也不表示全部手机稿已经成为原生小程序页面。**P：规划能力**。8张P画板为R05专业技术统计、R09云媒体、B03平台汇总、B09用量与云成本、B10服务工单、S11关注消息、S12长期球员档案、A04自助安全与会话管理。该清单是规划入口，不能据此称完整商业平台已经实现。

- 沿用单一比赛、服务器计时、记分控制权、独立确认及机构隔离；记分员菜单不提供机构管理入口。未采集统计显示“未统计”。
- 赛事包含报名独立审核/冻结、循环/单淘汰/分组接淘汰、同分独立抽签、冲突处理、显式逐轮发布、归档与历史授权；固定规则继续以[C05](../tasks/C05.md)为准。
- 计费设计仅平台软件服务费；价格为示例。平台人员与机构角色分离；人工收退款须独立复核，缺第二人不可跳过；已激活赛事不因到期中断记分。未配置或关闭状态不伪装可支付。
- 微信绑定先明确同意，再重新验证已有账号；解绑复核明确退出全部会话。未配置微信保留相应状态。手机设计不等于已通过微信开发工具、真机或Safari验收。
- 保险文件私有，上传不等于承保。媒体需显式公开；观赛与OBS分别授权，撤销/到期有独立状态。OBS棋盘格仅表达透明背景，未做真实OBS客户端测试。
- 文件/小视频现有边界为单文件8MiB、机构128MiB；人工事件对时不等于自动剪辑、云直播或转码。真实支付、退款、微信及外部媒体服务本轮均未联调。
- 球队、球员、机构、比分和金额均为合成示例；不包含生产数据、真实私密资料或授权令牌。

## 原型与验证证据

已写入555条业务页NODE/URL原型反应、18个业务流程起点，另有封面9条导览链接与1个起点。原生页面内导航及部分阶段切换可用于审阅；跨Figma页面使用文件内画板URL跳转。记录数量是原型配置数量，不是业务交互测试数量。禁止把示例比分切换描述为真实后台写分、支付或授权签发。

| 验证 | 本轮实际结果 | 限制 |
| --- | --- | --- |
| 全文件原生图层审计 | 10页结构、字体、图片填充与布局检查无所列问题；最后修改后复查设计系统/记分媒体/观赛/报名/手机后台5页，横向越界、缺失字体、空文本框均0，IMAGE填充0 | 程序化结构检查不是全部画板逐像素验收 |
| 视觉截图检查 | 机构总览、公开比赛、封面、组件、状态集合、报名核对、手机记分、专业记录台、OBS预览等抽查通过 | 没有对94张画板逐一截图签收 |
| 独立视觉复核 | figma_ops_scope只读复核R02记分台、B06财务复核、A02身份选择，3张通过 | 仅代表该3张范围 |
| 设计修正后回查 | 修正KPI/按钮文字换行、手机队徽40×40、空提示字段高度、手机离线提示位置；补齐专业事件按钮与透明背景表达，并检查修正后画面 | 专业统计页仍为规划 |
| 原型 | 原生反应及起点写入、读取核对成功 | 未在Figma演示浏览器逐条点击回放，不是自动化端到端验收 |
| 应用测试/环境 | 本轮纯Figma及文档，无应用代码、依赖、数据库或Migration改动，未重跑类型检查/构建/PG/浏览器测试 | 原C05 CI与服务器历史报告不构成本稿已实现证据；未部署生产 |

下一步先审阅导览中的机构总览、记分台、手机观赛及报名；视觉与范围确认后，按现有React/Web与小程序分批实现，继续复用原权限、状态和计时源，再对实际代码执行对应真实PG及桌面/手机回归。接续方法见[D01交接](../handoffs/D01.md)。

## 完整画板索引

以下为Figma实际原生节点，F01另列；E/P为上文定义。

| ID | 界面 | 能力标记 | Figma画板 |
| --- | --- | --- | --- |
| A01 | 账号登录 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=12-8) |
| A02 | 选择工作身份 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=12-47) |
| A03 | 个人账号注册 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=12-85) |
| A04 | 个人安全与会话管理 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=12-133) |
| B01 | 机构套餐与按届软件服务 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-8) |
| B02 | 软件服务订单详情 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-117) |
| B03 | 平台运营与机构概况 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-194) |
| B04 | 不可变套餐版本管理 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-286) |
| B04B | 新建不可变套餐版本 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-385) |
| B05 | 平台订单与收款登记 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-471) |
| B06 | 人工收款独立复核 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-569) |
| B07 | 未激活订单全额退款复核 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-667) |
| B08 | 商户查单与双向对账 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-765) |
| B09 | 机构用量与云成本 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-871) |
| B10 | 服务工单与客户交付 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=8-955) |
| M01 | 赛务工作台 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-297) |
| M02 | 本届赛事 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-346) |
| M03 | 赛程与冲突 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-400) |
| M04 | 手机记分工作台 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-446) |
| O01 | 工作总览 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-49) |
| O02 | 赛事管理 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-148) |
| O03 | 创建赛事草稿 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-258) |
| O04 | 城市联赛2026 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-342) |
| O05 | 球队与长期成员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-446) |
| O06 | 报名资料与独立审核 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-546) |
| O07 | 本届名单冻结复核 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-648) |
| O08 | 机构共享场地 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-759) |
| O09 | 分组抽签与种子队 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-853) |
| O10 | 赛程编辑与排时建议 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-1005) |
| O11 | 赛程冲突处理 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-1097) |
| O12 | 首次正式发布复核 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-1177) |
| O13 | 组内资格与同分抽签 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-1259) |
| O14 | 淘汰签位与逐轮发布 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-1412) |
| O15 | 排名与公开观赛授权 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-1499) |
| O16 | 完赛、归档与历史交付 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-1640) |
| O17 | 工作人员与权限 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-1719) |
| O18 | 赛事变更与安全审计 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=4-1824) |
| R01 | 赛前规则与本场名单 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-8) |
| R02 | 现场记分工作台 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-93) |
| R02B | 记分提交后的反馈 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-201) |
| R02C | 终场与提交待确认 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-313) |
| R03 | 独立赛果确认 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-419) |
| R04 | 更正记录与重开原因 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-508) |
| R05 | 专业技术统计记录台 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-584) |
| R06 | 比赛媒体上传与发布 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-703) |
| R07 | 原事件对时与片段定位 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-790) |
| R08 | OBS只读授权与预览 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-879) |
| R09 | 云媒体与赛事交付 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=7-950) |
| S00 | 登录已有账号 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-476) |
| S01 | 小城市篮球 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-8) |
| S02 | 城市联赛2026 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-58) |
| S03 | 赛事赛程 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-109) |
| S04 | 比赛详情 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-155) |
| S05 | 小组积分与资格 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-215) |
| S06 | 淘汰签位 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-329) |
| S07 | 正式赛果与名次 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-374) |
| S08 | 比赛视频与图片 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-421) |
| S09 | 我的球赛主场 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-524) |
| S10 | 绑定微信身份 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-581) |
| S10A | 确认绑定微信 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-624) |
| S10B | 微信账号管理 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-669) |
| S10C | 解除微信绑定复核 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=17-320) |
| S11 | 关注与消息 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-704) |
| S12 | 长期球员档案 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-755) |
| T01 | 我的球队 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-818) |
| T02 | 球队与长期成员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-863) |
| T03 | 编辑球队成员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-936) |
| T04 | 选择可报名赛事 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-982) |
| T05 | 本届报名名单 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-1028) |
| T06 | 报名资料与保险凭证 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-1095) |
| T07 | 提交前核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-1139) |
| T08 | 报名审核进度 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-1195) |
| T08A | 报名已提交待审核 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=17-571) |
| T09 | 接受球队邀请 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-1248) |
| T10 | 本届已冻结名单 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-1300) |
| X01 | 首次空数据 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-8) |
| X02 | 搜索无结果 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-22) |
| X03 | 加载与读取失败 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-36) |
| X04 | 无权限或内容不存在 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-54) |
| X05 | 赛事草稿版本冲突 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-66) |
| X06 | 离线与未知操作结果 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-85) |
| X07 | 控制权被其他终端持有 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-105) |
| X08 | 等待独立赛果确认 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-119) |
| X09 | 同分资格与独立抽签 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-133) |
| X10 | 计费关闭 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-153) |
| X11 | 缺少独立财务复核人 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-167) |
| X12 | 私有文件超出额度 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-181) |
| X13 | 媒体或观赛授权撤销 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-196) |
| X14 | 微信登录尚未配置 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-208) |
| X15 | 支付结果待核验 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-222) |
| X16 | OBS授权到期或撤销 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-237) |
| X17 | 原正式赛事兼容与到期 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-249) |
| X18 | 上传处理中与失败恢复 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-263) |
| X19 | 首次发布的权益额度不足 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=11-279) |

F01：[设计交互与开发交接](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=12-185)，辅助板，不计入94张业务/状态画板。
