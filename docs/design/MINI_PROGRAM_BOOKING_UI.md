# D02 小程序预约与球员数据 UI

日期：2026-10-24 Asia/Shanghai；设计交付完成；原生小程序实现和统一业务测试未执行。

**[设计导览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2400) · [三屏预览](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=38-195)**。沿用原文件「小城市篮球 · 商业版 UI 设计系统」，保留 [D01观赛、报名等设计](COMMERCIAL_UI_FIGMA.md)，本轮不创建替代文件。

## 完成范围

新增4个分区、99张业务/状态界面和2张导览/交接板，另有三屏预览板和组件审阅板。99包含身份、模式、勾选和异常状态变体，不代表99个独立业务模块。

| 分区 | 业务/状态及辅助画板数 | 内容 |
| --- | ---: | --- |
| 10 小程序选人与预约 | 38 | 筛选/资料/记录/2–3人比较、5种预约、多人、各种费用确认、恢复及异常 |
| 11 小程序履约与异常 | 29 | 发出/收到、单人单场、两方变更、条件激活、到场完成、拒绝取消/到期/争议 |
| 12 小程序球员与数据授权 | 24 | 入驻报价档期、明确声明、精确提名/本人同意/拒绝/撤销、历史及权限 |
| 13 交付与资金规划 | 10 | 8张业务/规划界面与2张辅助板 |

92张E仅表示设计对齐现有Web/API能力，**不表示原生小程序代码已完成**。7张P为F02–F08：未来支付确认/未知结果、退款申请/进度、个人结算、关注消息、长期档案；均明确标记规划和未启用。现有D01的E/P含义继续有效。

## 交互与视觉

- 基准390×844，保留既有深蓝/橙/浅灰及中文Noto Sans SC、数字Inter。长页纵向滚动；3人对比指标列固定、球员列横向滚动。返回/操作区至少44px；正文14/16。320/375/430适配要求交由实现验收，本轮没有逐尺寸实机验证。
- 复用原53变量、12文本样式和Button/Field/Notice/Tab/MobileNav；新增4组件组11变体：球员卡2、逐场卡5、记录2、明确同意2。原有组件不替换、不发布团队库、不生成Code Connect。
- 声明默认未勾选，主按钮禁用；单场/系列费用、本人授权、成人声明、主办方发布声明、到场与完成均有明确同意状态。勾选变体用于原型展示，实施时仍逐项校验当前真实身份与条件。
- 已配置414条实际原型反应、11个起点。同页使用原生导航，跨页使用文件内画板URL。刷新/加载等自循环按钮保持静态，不能把原型当真实API调用或数据保存；未逐条演示回放414项。
- 球队视角与本人球员视角分别设计，接单/本人到场和激活/球队完成不互相替代；参与方不能从订单进度进入平台裁定。独立平台处理从辅助交接场景入口查看，真实实现仍依赖服务端独立性判断。

## 固定业务口径

1. 合作总单包含每位球员每场独立项，覆盖单场、多场、整届、赛季、时段。固定请求保留20分钟，场后交通缓冲30分钟。条件意向不占档、不保证到场；激活补齐实际时间地点，再由本人接单。
2. **现有ACTIVATE沿用原订单金额/费率快照，不支持重新报价参数。**价格另议须取消原项后新建。建单报价变化需要重新读取并明确确认，不能静默调价。改期同时收集报到、开始、结束，满足报到≤开始<结束；同意前保留原约定。
3. 同价按参赛服务费筛选。对比列出含平台、交通食宿估算；平台费只按服务费计算。费用样例：单场330，多场3场990，整届确定660/意向330，赛季确定1320/意向660，两人740（其中交通80）。这些为合成示例，不是真实成交。
4. 未接单不能转争议延长占档；拒绝/取消/到期各有独立界面。到场是本人声明，不是GPS核验；服务结束且有到场记录后由球队方确认完成。完成后24小时争议窗口及独立处理条件沿用C06。
5. 保留原请求编号和内容处理未知结果，不自动换号/重发。明确拒绝、恢复记录损坏、本机存储不可用分别呈现；新的原生存储实现仍需按当前账号隔离并另行验证，不能把Web sessionStorage测试当小程序证据。
6. 数据按明确赛事/球队/固定成员提名，本人单独同意；双方可撤销。完整历史每页50条，旧有效授权仍能找到并操作。授权不授予私有赛事接口权限，不按同名自动关联，不冒充双人实名核验。
7. 固定名单样本不代表实际出场；真实0保留，未采集不补0。公开有限得分/犯规、近5条、样本和完整度；篮板/助攻/时间/命中率未统计。本人归属不完整、TEAM_ONLY、来源失效和截断均提示。重开旧确认退出，只取当前有效确认。
8. 支付/个人分账未接通；实收、退款到账和结算为0。当前费用与未来真实交易稿分开；不画虚假的支付成功、到账、可提现余额或通知已送达。预约不自动加入赛事名单，也不等于资格或保险已核验。

## 自查与后续

本轮最终101张源画板共3893个FRAME/TEXT/INSTANCE节点；IMAGE填充0；字体为产品既有字体，检查未发现缺失字体、短于行高的固定文本或横向越界（滚动容器内的有意溢出除外）。代表性视觉检查包括三屏预览、本人授权未勾选、球员接单、组件状态、设计导览和整届费用；修复了标题自适应高度和组件变体共享默认文本问题。并非101张逐像素签收。

未执行应用类型检查/构建/单测/真实PG/浏览器业务/微信开发工具/真机/支付联调，未修改应用代码、依赖、Migration或生产环境。此前C06/C07的CI不构成本次小程序新UI实现证据。按用户要求，统一业务测试留待设计完成并落实原生代码后进行。详见[任务](../tasks/D02.md)、[交接](../handoffs/D02.md)、[证据](../evidence/D02/README.md)。

## 完整画板索引

### 10 · 小程序选人与预约

| 编号 | 界面/状态 | 标记 | Figma |
| --- | --- | --- | --- |
| K01 | 小城市篮球 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-35) |
| K02 | 找球员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-78) |
| K03 | 筛选球员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-126) |
| K04 | 林越 · 球员详情 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-168) |
| K05 | 个人比赛记录 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-206) |
| K06 | 同价球员对比 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-256) |
| K07 | 3人对比 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-333) |
| K08 | 暂无匹配球员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-427) |
| K09 | 尚无个人统计 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-453) |
| K10 | 代表哪支球队预约 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-482) |
| K11 | 预约几场 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-520) |
| K12 | 单场预约 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-552) |
| K13 | 多场预约 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-597) |
| K14 | 整届赛事预约 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-638) |
| K15 | 赛季合作预约 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-682) |
| K16 | 按时段预约 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-717) |
| K17 | 多人逐场安排 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-760) |
| K18 | 确认预约与费用 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-806) |
| K19 | 预约已提交 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-852) |
| K20 | 报价发生变化 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-884) |
| K21 | 这段时间不可预约 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-913) |
| K22 | 原预约结果待核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-940) |
| K23 | 原请求已明确拒绝 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-970) |
| K24 | 当前不能代表球队下单 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-999) |
| K25 | 恢复记录损坏 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3081) |
| K26 | 本机无法保存恢复资料 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3106) |
| K27 | 选择日期与时间 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3133) |
| K28 | 确认预约 · 已核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3248) |
| K29 | 多场预约 · 费用核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=42-490) |
| K34 | 多场预约 · 已核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=42-537) |
| K30 | 整届合作 · 费用核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=42-584) |
| K35 | 整届合作 · 已核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=42-631) |
| K31 | 赛季合作 · 费用核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=42-678) |
| K36 | 赛季合作 · 已核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=42-725) |
| K32 | 按时段合作 · 费用核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=42-772) |
| K37 | 按时段合作 · 已核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=42-819) |
| K33 | 多人预约 · 费用核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=42-866) |
| K38 | 多人预约 · 已核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=42-916) |

### 11 · 小程序履约与异常

| 编号 | 界面/状态 | 标记 | Figma |
| --- | --- | --- | --- |
| L01 | 我的预约 · 发出 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1027) |
| L02 | 收到的预约 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1072) |
| L03 | 青锋杯 · 合作总单 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1114) |
| L04 | 核对本场预约 · 球员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1162) |
| L05 | 拒绝本场预约 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1196) |
| L06 | 本场已接单 · 球队 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1226) |
| L07 | 提议更改安排 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1263) |
| L08 | 确认变更提议 · 球员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1301) |
| L09 | 取消单人单场 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1330) |
| L10 | 本人到场声明 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1364) |
| L11 | 确认本场服务完成 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1396) |
| L12 | 本场服务记录已完成 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1431) |
| L13 | 发起本场争议 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1467) |
| L14 | 争议处理中 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1501) |
| L15 | 平台独立处理 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1535) |
| L16 | 条件合作意向 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1570) |
| L17 | 激活条件场次 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1601) |
| L18 | 接单请求已到期 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1641) |
| L19 | 本场已拒绝 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1673) |
| L20 | 状态已变化，请重新核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1703) |
| L21 | 本场已取消 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3629) |
| L24 | 本场待接单 · 球队 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3655) |
| L25 | 本场已接单 · 球员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3686) |
| L26 | 条件合作意向 · 球员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3723) |
| L27 | 本人已声明到场 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3756) |
| L22 | 本人到场 · 已核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3786) |
| L23 | 确认完成 · 已核对 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-3821) |
| L28 | 提议更改安排 · 球员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=37-452) |
| L29 | 确认变更提议 · 球队 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=37-495) |

### 12 · 小程序球员与数据授权

| 编号 | 界面/状态 | 标记 | Figma |
| --- | --- | --- | --- |
| C01 | 我的球员中心 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1731) |
| C02 | 球员入驻与资料 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1766) |
| C03 | 设置服务报价 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1804) |
| C04 | 管理可约时间 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1843) |
| C05 | 资料等待审核 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1880) |
| C06 | 入驻资料需要修改 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1907) |
| C07 | 我的比赛数据授权 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1938) |
| C08 | 核对本人比赛记录 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-1975) |
| C09 | 拒绝公开提名 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2013) |
| C10 | 撤销这条公开授权 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2041) |
| C11 | 主办方提名 · 选赛事 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2073) |
| C12 | 主办方提名 · 选成员 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2106) |
| C13 | 确认发起数据提名 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2141) |
| C14 | 完整授权历史 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2172) |
| C15 | 来源已撤销或失效 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2206) |
| C16 | 保留未保存的编辑 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2234) |
| C17 | 当前权限已变化 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2261) |
| C18 | 登录后继续预约 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2288) |
| C19 | 怎样理解这些记录 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2324) |
| C20 | 我的球赛主场 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2358) |
| C21 | 服务档案已停用 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-4031) |
| C23 | 球员入驻 · 已声明 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-4058) |
| C22 | 本人公开授权 · 已同意 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-4099) |
| C24 | 主办方提名 · 已声明 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=34-4140) |

### 13 · 小程序交付与资金规划

| 编号 | 界面/状态 | 标记 | Figma |
| --- | --- | --- | --- |
| D02 | 小程序预约设计导览 | 辅助 | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2400) |
| G01 | 开发交接与统一测试 | 辅助 | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2434) |
| F01 | 费用与资金说明 | E | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2471) |
| F02 | 支付确认 · 规划 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2504) |
| F03 | 支付结果待核验 · 规划 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2534) |
| F04 | 取消与退款申请 · 规划 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2564) |
| F05 | 退款处理进度 · 规划 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2597) |
| F06 | 球员结算明细 · 规划 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2624) |
| F07 | 关注与消息 · 规划 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2659) |
| F08 | 长期球员档案 · 规划 | P | [打开](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2693) |
