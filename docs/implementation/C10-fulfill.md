# C10 履约与平台页面视觉还原

2026-10-25；作者 c10_fulfill；分支 `feat/c10-fulfill`；本域代码完成，待 root 整合后的新截图和统一验收。

## 现场与范围

- 独立工作树：`/workspace/scratch/608836f8d204/c10-fulfill`，起点 `55d5dd9ac50b07f9cfa4a3cdf484eead1f9a7064`。开工已核验 Git、读取 AGENTS、CURRENT_STATUS、TASKS、COLLABORATION 和 C10 任务卡。
- 仅修改 bookings、booking-detail、platform 三页原生模板/局部样式及必要纯展示 JS、独立 fixture/回归和本文。platform PageVM 未改。
- 未修改共享样式、状态机、API、数据库、费用、命令日志和权限规则；不执行 push、merge、部署或 Migration。

## 原稿来源与 exact / derived 映射

文件 `2jAHpYjdIHqal1nXeoVqm6`。已按 `figma-design-to-code` 技能取得含截图的高保真 `get_design_context`，译为 WXML/WXSS；未用原稿 PNG 作为运行时界面。三页涉及的原稿没有静态图片或 SVG 插槽，不新增资产或临时 Figma URL。

以下的 **exact** 指直接复用已核对的设计组件及几何：20px 页边、16px 白卡内距/圆角/纵距、14/24 正文、18/28 卡片标题、12/20 时间地点、44px 全宽操作。**derived** 指真实 PageVM 必须保留的组合、字段或状态，不能据此宣称整屏像素一致。

| 原生路由                     | 主正常 fixture               | 主参考节点与本地 PNG                                                               | 映射结论                                                                                                                                     |
| ---------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pages/bookings/index`       | `c10-fulfill-bookings-ready` | 30:1027；`/workspace/scratch/608836f8d204/c10-design-context/fulfill-sent.png`     | exact：状态栏、合作上下文、逐场卡；derived：保留完整十种筛选、发出/收到切换、逐单入口、真实费用/支付提示和刷新按钮                           |
| `pages/booking-detail/index` | `c10-fulfill-detail-ready`   | 30:1114；`/workspace/scratch/608836f8d204/c10-design-context/fulfill-detail.png`   | exact：总单摘要与逐场卡；derived：将设计的独立详情/操作画板组合为现有同一路由的明确展开和编辑态，保留恢复、资格、金额快照和资金状态          |
| `pages/platform/index`       | `c10-fulfill-platform-ready` | 30:1535；`/workspace/scratch/608836f8d204/c10-design-context/fulfill-platform.png` | derived：本节点是单项争议处理，实际平台主页还含资料审核和新预约费率，无对应完整画板；复用 L15 的通知、卡片、表单和按钮规范，不声明整屏 exact |

原稿完整响应及原件 PNG 均在 `/workspace/scratch/608836f8d204/c10-design-context/`，文件名均以 `fulfill-` 开头。共21份已实际读取并查看截图的参考：

| 场景                             | 节点                        | 文件后缀                           |
| -------------------------------- | --------------------------- | ---------------------------------- |
| 发出预约 / 收到预约              | 30:1027 / 30:1072           | sent / received                    |
| 合作总单                         | 30:1114                     | detail                             |
| 核对接单 / 拒绝预约 / 球队已接单 | 30:1162 / 30:1196 / 30:1226 | accept / reject / team-accept      |
| 提议变更 / 确认变更              | 30:1263 / 30:1301           | change / change-confirm            |
| 取消单人单场 / 取消后状态        | 30:1330 / 34:3629           | cancel-form / cancelled            |
| 本人到场声明                     | 30:1364                     | arrived                            |
| 确认完成 / 完成后状态            | 30:1396 / 30:1431           | complete-form / completed          |
| 发起争议 / 争议处理中 / 独立处理 | 30:1467 / 30:1501 / 30:1535 | dispute-form / disputed / platform |
| 条件意向 / 激活条件场次          | 30:1570 / 30:1601           | conditional / activate             |
| 请求到期 / 已拒绝 / 刷新冲突     | 30:1641 / 30:1673 / 30:1703 | expired / declined / unknown       |

其中“已到场概览”复用已核对的 30:1364 到场组件，是 derived；未把未读取的 34:3756 写成逐图核对来源。原编号结果待核对复用 30:1703 的冲突反馈规范，具体恢复面板为真实命令日志所需的 derived 内容。loading、empty、error、permission 同样为原有 PageVM 实际分支的派生布局。

## 页面行为与业务边界

- 预约列表恢复紧凑状态栏和逐场白卡；快捷四类委托原筛选方法，“更多”仍可选完整十种状态。收到列表仍经当前 viewer 投影，不显示其他球员的安排。时间展示从原北京时区字段派生，保留跨日日期和非当年年份。
- 合作详情默认展示总单与逐场卡；显式“核对本场约定与操作”只改变 `expandedId`。普通 render、连续输入不会收起，不清草稿、声明、原始报价或恢复记录。busy、pending、打开编辑器、失效令牌、缺失身份或不可见子项时均拒绝切换；隐藏/身份清理时清除展示状态。
- 原11命令、逐场服务器能力、原 appearance ID、原命令 ID/不可变 payload、恢复流程完全沿用。pending 面板始终可达，并强制显示本场上下文；切换展示不触发网络或写入。
- 打开命令编辑器后聚焦当前操作，并保留原条件、接单期限、赛程变化警告、待确认的新时间/地点/原因、本人到场/完成记录、处理原因、资格约定和完整费用。所有操作声明默认未勾选；不会因为“展开”或“输入”自动提交。
- 20分钟请求保留、30分钟场后交通缓冲、独立争议权限均沿用原规则。资料审核不表示实名/保险/参赛资格或实力认证；到场为本人声明；完成不表示已付款。
- 平台审核仍冻结原版本与快照，默认未勾声明；打开审核仅隐藏主区而不丢费率草稿。未新增运营能力或客户端裁定；实际收款/退款到账/结算仍为0，支付与个人分账未启用。

## 合成状态覆盖

目录 `tests/mini-program/fixtures/`；统一前缀 `c10-fulfill-`。共39份，每页仅一个 `primary:true`，其余均 false。正常数据可见“合成”标记；loading/empty 等实际文案不强塞样例标签。详情和列表数据从既有合成订单及真实 PageVM/model 装饰产生，平台使用现有 PageVM 字段，不引入运行时样例。每份fixture带合成快照 `asOf`，到场声明在报到前10分钟；请求快照保持20分钟保留期，终止态总单确定报价为0但逐场历史报价仍保留。

| 路由                        | fixture 后缀                                                                                                                                                                                                                                                                          | 数量 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---: |
| bookings                    | `bookings-ready`、`bookings-received`、`bookings-loading`、`bookings-empty`、`bookings-error`、`bookings-permission`                                                                                                                                                                  |    6 |
| booking-detail 概览及业务态 | `detail-ready`、`detail-requested`、`detail-accepted`、`detail-arrived`、`detail-completed`、`detail-conditional`、`detail-cancelled`、`detail-declined`、`detail-expired`、`detail-disputed`、`detail-change`                                                                        |   11 |
| booking-detail 命令核对     | `detail-form-accept`、`detail-form-decline`、`detail-form-activate`、`detail-form-cancel`、`detail-form-dispute`、`detail-form-accept-change`、`detail-form-reject-change`、`detail-form-propose-change`、`detail-form-arrive`、`detail-form-complete`、`detail-form-resolve-dispute` |   11 |
| booking-detail 读取/恢复    | `detail-recovery`、`detail-loading`、`detail-empty`、`detail-error`、`detail-permission`                                                                                                                                                                                              |    5 |
| platform                    | `platform-ready`、`platform-loading`、`platform-empty`、`platform-error`、`platform-permission`、`platform-review`                                                                                                                                                                    |    6 |

`bookings-permission` 展示实际登录要求，登录后的不可见记录仍由原过滤投影处理；不虚构全局“无预约权限”。`detail-permission`/`platform-permission` 通过实际 error + 无数据分支展示被拒绝读取。`platform-review` 保存原待审版本7、资料快照和未勾声明，`platform-permission` 为无平台运营权限。`detail-recovery` 保存原 UUID、原 ACCEPT payload 与未勾移除确认，不伪装操作成功。

## 验证与交接

- `node --test apps/wechat/test/*.test.cjs`：**242/242 通过**，含新增10条展示状态/真实 PageVM/模板回归。覆盖展开守卫、普通重绘、持续输入、隐藏清理、完整筛选、原 ID 恢复、11命令默认未确认，以及新安排/条件/赛程/履约记录在编辑态的可见性。
- 39份 fixture 均在320/390/430宽度调用真实原生模板兼容器并核验 `expectText`，共117次模板渲染；全部无截图资产注入。此处仅证明模板与内容，不冒充浏览器像素或微信运行结果。
- 直接相关 booking-orders/account-platform/native-structure 65/65 两次通过；JS语法和本域格式检查通过；`git diff --check` 通过。
- 只读复审发现编辑聚焦曾隐藏待确认的新安排等上下文，已补回并加针对回归，随后全量242/242通过。
- 本机辅助 Chromium 自查因 Playwright headless executable 缺失未运行；未另行下载。root 将在隔离 CI 生成整套候选新图并核对。本域不交付旧截图作为本轮实现证据。
- 官方微信开发工具编译、微信样式差异、真机、真实账号联调尚未验证；统一截图验收与集成结果由 root 记录，本文不将代码完成标成整体验收完成。

## 独立复查修正：保留球队与赛事上下文

单场状态 hero 和命令编辑会隐藏普通总单摘要；合法场次名仅为“第一场”时，原先可能看不到所属球队与赛事。改为在有权读取的 order 区域顶部共享显示一行“球队 · 赛事”，移除普通摘要里的重复行，覆盖状态 banner、全部11命令编辑态与 unknown 原编号恢复。

新增真实 PageVM→WXML 回归，以不含球队/赛事的“第一场”核对普通摘要、单场状态、连续编辑的 PROPOSE_CHANGE 和 journal.start 产生的待核对状态，验证球队/赛事各出现一次、原命令ID及payload仍保留；另遍历全部11命令编辑模板防止分支遗漏。 `c10-fulfill`、`booking-orders`、`native-structure` focused tests **64/64通过**，本次新增2条回归；格式/diff检查通过，浏览器/微信验证仍由 root 统一记录。
