# MEMBER03 · 暖金V4与产品V2实现映射

2026-11-11（Asia/Shanghai）。本次按用户已确认的桃金视觉补齐“先试排、按届首发”的内容与流程，不更换全局品牌。

## 1. 版本与冲突处理

- 业务以 [产品PRD V2](MEMBER03_PRODUCT_REQUIREMENTS.md) 为准。
- 首发视觉采用本页下列 **V4** 节点。旧V3的VIP/SVIP月年三卡只保留为历史参考，不照抄销售范围。
- V4沿用V3的渐变、深棕文字、皇冠/门票素材、卡片、权益高亮和固定底栏；改为99/149两档按届，并将免费体验前置。
- 调整属于本轮产品方向的实施映射；不允许Cursor再自行换主题或以另一张设计图掩盖还原偏差。
- 演示报价与机构/赛事均为示例。正式数据、资格和金额以服务器为准，示例不能触发真实交易。

## 2. Figma节点

文件：`QpKOskViUwHFVqSG3uYR9X`；页面：`162:32`「23 · 暖金会员中心 V3」。本轮在同页右侧新增V4，旧稿保留。

| 内容 | 节点 | 设计链接 |
| --- | --- | --- |
| V4完整长页，390宽 | 174:262 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=174-262 |
| 新用户免费试排入口，390×844 | 174:650 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=174-650 |
| 真实赛事待发布状态，390×844 | 174:859 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=174-859 |
| 专业单届选中状态，390×844 | 180:304 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=180-304 |
| 我的订单，390×844 | 174:1068 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=174-1068 |
| 免费试排输入，390×844 | 175:304 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=175-304 |
| 试排结果，390×844 | 175:325 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=175-325 |
| 试排转正式资料核对，390×844 | 176:306 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=176-306 |
| 标准单届核对，390×844 | 179:304 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=179-304 |
| 专业单届核对，390×844 | 179:335 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=179-335 |
| 通用状态参考（V3） | 168:284 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=168-284 |
| 皇冠PNG素材 | 162:67 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=162-67 |
| 门票PNG素材 | 162:68 | https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=162-68 |

V4原型入口：https://www.figma.com/proto/QpKOskViUwHFVqSG3uYR9X?node-id=174-650

原型连接免费体验、试排结果、转正式检查，以及就绪态的方案核对/订单入口；不模拟真实付款。正式报名、冻结、资源核对等仍通过项目真实页面完成，不能因为原型省略中间页面就绕过它们。专业选择、错误恢复等动态行为按PRD实现，不把有限原型覆盖说成全部功能已实现。

## 3. 状态与交互

| 元素 | 数据与行为 |
| --- | --- |
| 首屏“免费试排，满意再开通” | 无隐式下单；进入独立规划体验 |
| 标准/专业卡片 | 基于真实可售方案选择；更新高亮、摘要、金额和核对参数 |
| 真实赛事待发布摘要 | 必须是真实eventId、全届规模、机构与当前资格；示例8队/28场仅用于夹具 |
| “我的订单” | 当前机构可读原单；无数据/错误/无权分别呈现 |
| “生成并预览赛程” | 真实计算和约束反馈，按钮防重复，失败保留输入 |
| “继续正式建赛” | 进入资料核对，不直接付费、伪造冻结或发布示例队伍 |
| “进入正式赛事设置” | 接项目真实创建/报名/规则/场地流程，复用可映射输入 |
| 核对/办理按钮 | 不依据前端成功回调开权益；按原订单与后端capabilities办理 |

免费草稿显示当前设备保存；正式赛事和订单不得使用本机草稿作为权威。已有权益时提示使用该权益；无可售价格/无付款渠道时显示真实状态，不永远固定禁用正常可办理的订单。

## 4. 原生还原要求

WXML/WXSS/JS、rpx与项目既有组件。文字、价格、权益行列、按钮都原生渲染；只有皇冠与门票使用独立PNG。不得整页PNG、canvas或web-view替代。

| 视觉项 | 基准 |
| --- | --- |
| 主字/次字 | #59290F / #77665A |
| 强调/边线 | #DA5B15 / #E9D6C8 |
| 奶油/选中 | #FFF8F2 / #FFF0E4 |
| 页头渐变 | #FFE9D9 → #FACDB6 |
| 主按钮渐变 | #FFE7BD → #F2A16D |
| 主稿内容左右间距 | 16px |
| 两价格卡 | 主稿各174×194px，间距10px |
| 主按钮 | 52px高，胶囊圆角；触控目标至少44px |
| 字体 | Figma Noto Sans SC；原生复用现有字体栈与系统回退 |

精确数值、自动布局和颜色变量从节点读取。沿用已有图标族，不用emoji。素材导出后的建议目标位置为 `apps/wechat/assets/membership-gold/member-crown.png`、`member-ticket.png`，实施前核验/创建，不声称原仓库已存在。

主验收390×844；补查320/360/430。V4本轮提供390稿，窄宽可参考V3 `163:1378`/`163:1602` 的字体换行策略，但必须按V4两卡和新内容适配，不能声称已有V4窄宽原稿。规则、价格、有效期和按钮不得裁切。

OS时间/信号/电池和微信胶囊属于系统区域，不能照画假UI。真实胶囊、安全区按设备计算。固定底栏不遮盖正文；核对页信息区可滚动，办理按钮固定。标题过长时允许系统区域内缩短为“办赛服务”，对照报告注明。

## 5. 实际设计检查与限制

已读取V4长页与新用户入口结构：长页221个后代节点，含87个文字、2个价格卡实例及2个离散图片；图片仅皇冠和门票，不含完整界面截图。字体读取为Noto Sans SC。试排输入/结果和转正式核对为原生可编辑文字、容器和矢量。

实际查看长页、试排输入及核对页截图，已针对核对信息行的高度/裁切做修正。最终设计检查与应用验收分开；本轮没有运行微信小程序、没有原生截图对照或真实支付验收。

交付时由Cursor在同尺寸、同状态、同滚动位置下提供设计/运行并排或叠加图。主布局、字号、颜色、间距、图标、素材与高亮逐项对照；已发现的本轮差异继续修正。不能只凭编译通过称为1:1。
