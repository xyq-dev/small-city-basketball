# UI005 首页与“我的”定向修复证据

本目录只记录 2026-11-05 对首页 `pages/home/index` 和“我的” `pages/account/index` 的定向修复。它不把此前 73 路由 / 17 状态的隔离矩阵解释为本轮高保真复审，也不把隔离合成数据解释为微信真实成功态。

## 设计依据

- [首页 35:38](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=35-38)
- [我的游客 36:116](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-116)
- [我的已登录 36:56](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-56)
- [微信登录状态规范 36:134](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=36-134)
- [首页三宽 59:54](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=59-54)
- [交互组件 54:46](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=54-46)

## 修复前后

| 页面 | Figma / 修复前 / 修复后 | 状态边界对照 |
|---|---|---|
| 首页 | [三栏对照](home-before-after.png) | [Figma 成功态 / 隔离成功态 / 微信真实 404](home-state-context.png) |
| 我的 | [三栏对照](account-before-after.png) | [Figma未开放态 / 隔离未开放态 / 微信真实读取失败态](account-state-context.png) |

原图保留为 [首页 Figma](figma-home-35-38.png)、[首页修复前](wechat-home-before.png)、[首页修复后](wechat-home-after.png)、[我的 Figma](figma-account-guest-36-116.png)、[我的修复前](wechat-account-before.png) 和 [我的修复后](wechat-account-after.png)。运行截图逻辑视口为 390×844，SDK 导出 PNG 实际为 355×768；对照图只按原比例统一缩放，没有拉伸。

## 微信 390 实测尺寸

设计状态栏为 44px，当前模拟器实测为 47px，因此设计纵坐标在当前设备上的预期值增加 3px。

| 项目 | 修复前 | 当前设备目标 | 修复后 |
|---|---:|---:|---:|
| 首页 `.home-top` 高度 | 127.97 | 108 | 107.98 |
| 首页主视觉起点 y | 174.96 | 155 | 154.97 |
| 首页主视觉高度 | 203.99 | 204 | 203.99 |
| 首页尾部预留 | 166 | 84（50 底栏 + 34 安全区） | 84 |
| 我的游客主卡起点 y | 106.99 | 103 | 103.00 |
| 登录卡起点 y | 223.97 | 212 | 211.97 |
| 登录卡高度 | 418.41 | 241 | 240.97 |
| 原生登录行按钮 | 183.99×91.99 | 330×55 | 330.09×55.00 |
| 协议卡 y / 高度 | 662.37 / 218.43 | 465 / 187 | 464.94 / 186.80 |
| 我的尾部预留 | 182 | 84（50 底栏 + 34 安全区） | 84 |

完整数值见 [measurements.json](measurements.json)。当前首页移除了额外 44px 城市范围行，但页头城市按钮及其 `chooseCity` 路由保留；主视觉继续使用同一包内素材，移除了额外 `opacity:.83`、重复蒙层和画板外角标。

## 状态与交互边界

- 微信真实首页仍收到公开赛事目录 404，并显示真实读取失败与重试入口；未注入成功数据。
- 微信真实账号页为游客、`wechatState=unknown`，显示“读取失败”，不再误写为服务“未开放”。`closed`、`unbound`、`failed`、`loginPhase=wechat` 分别在隔离夹具中验证，互斥显示。
- [只读点击记录](readonly-interactions.json)：首页城市进入 `pages/city-select/index`、消息进入 `pages/messages/index`；账号[邮箱面板可展开](wechat-account-email-open.png)、找回账号可进入，重试后真实状态仍为 `unknown`。未触发报名、预约、支付、记分或其他生产写入。
- 首页/账号相关 7 个场景在 320/390/430 共 21 项隔离检查通过；320 登录进行态使用纵向双按钮，完整文案不缩小、不截断。
- 微信 320/430 当前代码截图未执行；这两个宽度只有隔离布局证据。原生键盘仍未被自动化 SDK 捕获，不能标为键盘视觉通过。

## 修正验收口径

此前 1386/1386 矩阵证明原生模板可渲染、三宽约束、触控尺寸和夹具状态检查通过，不等于 73 页都经过本轮逐像素或高保真复审。本轮新的视觉结论只覆盖首页和“我的”；其他页面继续沿用既有证据及其原边界。
