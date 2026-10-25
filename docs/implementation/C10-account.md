# C10 账号与规划页视觉还原

2026-10-25 Asia/Shanghai；负责人c10_account；本地实现与直接原生回归完成，待root整合后的本轮Chromium截图/几何及微信环境验收。

## 基线、范围与Figma来源

工作树`/workspace/scratch/608836f8d204/c10-account`，分支`feat/c10-account`，起点55d5dd9。仅修改account/planned两页原生文件、本域fixture/回归与本文档。经root明确同意，将native-components.test.cjs原Account导航检查注入已登录合成user，继续完整验证4栏导航；新增未登录footer和无导航重叠回归，未放宽原组件断言。

使用Figma设计转代码技能，读取含截图的高保真上下文后转为原生WXML/WXSS。会话71f6badd-3b96-4943-a920-654d6b83d98b；文件`2jAHpYjdIHqal1nXeoVqm6`。15份原文及原PNG暂存在`/workspace/scratch/608836f8d204/c10-account-reference/`，文件名为节点ID冒号改连字符，供root汇总到整套验收材料。所有所用原稿只有原生文字/卡片/控件，没有静态图片或SVG资产需植入，未把截图用作页面背景。

| 路由/状态 | 原稿节点 | 本轮映射 |
|---|---|---|
| account 已登录主场 | [C20 / 30:2358](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2358) | hero、7个独立满宽44px入口和底部导航；副标题显示当前账号名，平台入口仅真正平台身份可见 |
| account 登录/返回/注册 | [C18 / 30:2288](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2288)、[S00 / 9:476](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-476) | 独立标签/输入/提示、登录footer，未登录不叠加导航；注册严格受原服务端能力控制 |
| account 绑定/已绑/解绑 | [S10 / 9:581](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=9-581)、9:624、9:669、17:320 | 同路由securityOpen纯显示面板，账户信息/重新验证/声明/风险/操作按原稿分区 |
| planned 资金说明 | [F01 / 30:2471](https://www.figma.com/design/2jAHpYjdIHqal1nXeoVqm6?node-id=30-2471) | 先展示报价口径、未启用通知、真实0与费用规则，目录收起避免占满首屏 |
| planned 支付/未知结果 | 30:2504、30:2534 | 原稿notice/hero/内容卡/禁用footer，不展示虚构可支付订单 |
| planned 退款/进度 | 30:2564、30:2597 | 同refund模式内用refundProgress查看纯说明，不产生申请或查单请求 |
| planned 结算/消息/档案 | 30:2624、30:2659、30:2693 | 恢复结算0统计卡、消息分类说明/提醒卡、档案hero/专业数据边界 |

两条路由均为多张原稿合并的动态页面，referenceKind记为derived。原稿字段示例、独立页标题和原型链接不等于现有API能力；不宣称全部状态逐像素一致。资金页没有当前订单上下文，使用报价说明替代原稿静态¥330示例。账号注册能力、声明、身份变化与规划未启用边界均保留。

## 交互与边界

- securityOpen仅切换显示，保留当前密码草稿、声明与未核对消息；busy/commandBusy期间拒绝切换，身份变更关闭面板。已有微信challenge、密码重新验证、会话revision/身份校验与解绑确认未改变。
- 账号读取/任务失败显示错误色调，成功绑定/解绑/退出使用成功反馈。读取时旧私有身份先清空；加载页不继续显示旧账号面板。
- 注册能力撤回但仍处注册表单时，保留返回已有账号登录的路径；注册按钮继续禁用、原register方法继续检查服务端能力，没有开放注册权限。
- account导航传入busy供root的共享disabled属性阻止在途导航；登录footer不与底部导航同时显示。
- planned目录、模式切换、退款进度都是静态展示，只有现有预约/授权/账号内部导航。没有wx.requestPayment、退款/结算/推送请求或可提现余额；实收/退款到账/结算仍为0。

## 合成截图场景

22份本域JSON均仅用于离线真实模板预览；每份有state、figmaNode、expectText。`c10-account-home`与`c10-account-planned-funds`为primary:true，分别作为两个路由默认整套截图。规划页全部static:true，静态页不构造虚假的加载/空记录/错误或权限请求状态。

| 路由 | 场景后缀 | 对应状态 |
|---|---|---|
| account | home | 已登录主场，合成当前账号 |
| account | login、login-return、wechat-disabled | 登录权限入口/带返回/微信未配置 |
| account | loading、read-error | 真实读取加载/失败的UI分支 |
| account | register、registration-disabled | 允许注册/能力已撤回但可返回登录 |
| account | bind-review、bind-checked | 默认未选声明/明确选择 |
| account | binding-connected、unbind-review、busy-lock | 已绑定/解绑复核/在途锁 |
| planned | planned-funds、payment、unknown | 当前资金说明/未来支付/未知交易说明 |
| planned | planned-refund、refund-progress、settlement | 退款与进度纯说明/结算未启用 |
| planned | planned-messages、profile、directory | 消息/长期档案规划/可展开目录 |

## 本地验证与未执行项

- account/planned JS语法检查通过。
- 本域新增6项真实Page/WXML回归：登录footer无nav重叠；已登录4栏与入口；security显示切换/忙锁不改草稿；注册能力撤回仍可回登录；错误清身份/色调；规划静态切换及22fixture三宽真实模板展开、未来动作禁用。所有新增回归通过。
- 既有account/platform/Component/结构相关45项通过；完整原生238/238通过（232基线+6本域新增）。格式和git diff --check通过。
- 22×3=66份本域真实模板成功生成，不等于已执行浏览器几何、截图、微信编译或真机；这些由root在整合候选统一执行并记录。未运行无关Web/API/PG，未push/merge/部署/Migration。
