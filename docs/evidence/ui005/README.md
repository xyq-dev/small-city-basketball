# UI005 可共享评审证据

本目录是 UI005 当前功能分支的精简评审证据。页面仍使用原生 WXML/WXSS、真实数据绑定、权限判断和既有 handler；这里的合成数据只用于隔离视觉检查，不会进入运行默认值或生产服务。

> 2026-11-05 的运行差异复核发现：首页和“我的”虽通过原三宽矩阵，仍存在页头重复避让、主视觉重复暗化、账号原生按钮缩窄和互斥状态堆叠等高保真偏差。两页已定向修复并重新取得微信证据，见[首页与“我的”修复前后](home-account-fix/README.md)。原 1386/1386 只证明模板渲染、布局约束和夹具检查通过，不应外推为 73 页都通过本轮高保真复审。

## 设计入口

- [最新交接 63:237](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=63-237)
- [完整 73 页 + 17 状态索引 40:6871](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=40-6871)
- [交互组件 54:46](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=54-46)
- [首页三宽 59:54](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=59-54)
- 本次读取留档：[最新交接截图](design/latest-handoff-63-237.png)、[首页三宽截图](design/home-widths-59-54.png)

## 覆盖与方法

- [73 页与 17 状态逐项清单](COVERAGE.md)：列出 Figma 节点、实现目录、隔离场景、微信运行证据及剩余边界。
- 原全量隔离矩阵使用原生模板和样式、API 形状一致的合成夹具，在 320/390/430 三宽检查首屏、中段、底部、横向溢出、小点击目标及字段可读性，结果为 1386/1386。该结果是结构与约束证据，不是逐像素相似度或高保真结论，也不是微信运行、真实身份、真实付款、真实记分或生产成功证据。
- 微信开发者工具只读采集覆盖 18/73 路由。报告中的逻辑窗口为 390×844；SDK 导出的 PNG 实际为 355×768。只验证当前工程的路由打开和滚动，不触发写操作，详见 [运行报告](runtime/report.json)。
- [测试摘要](TESTS.md)记录完整命令、通过数、Windows 符号链接失败和未执行项。

## 代表性对照

每张图从左到右为 Figma、390 宽合成隔离态、微信开发者工具运行态。第三栏标题同时标出逻辑宽度和 PNG 实际宽度。

| 范围 | 对照图 |
|---|---|
| 首页 | [本轮修复前后](home-account-fix/home-before-after.png)；[原三栏](comparisons/home.png) |
| 赛事 | [watch](comparisons/watch.png) |
| 同城 | [local](comparisons/local.png) |
| 球队 | [teams](comparisons/teams.png) |
| 我的 | [本轮修复前后](home-account-fix/account-before-after.png)；[原三栏](comparisons/account.png) |
| 赛事详情 | [event-detail](comparisons/event-detail.png) |
| 报名表单 | [entry-form](comparisons/entry-form.png) |
| 创建预约 | [booking-create](comparisons/booking-create.png) |
| 预约详情 | [booking-detail](comparisons/booking-detail.png) |
| 本人资料 | [participant-materials](comparisons/participant-materials.png) |
| 资格预审 | [qualification](comparisons/qualification.png) |
| 记分台 | [scorer](comparisons/scorer.png) |

原 18 路由微信首屏和滚动到底截图保存在 [runtime](runtime/)；它们属于 Draft PR 整合时的运行证据。首页和“我的”的最新修复证据以 [home-account-fix](home-account-fix/) 为准，未重新审查的页面不能因两页修复自动标记为本轮高保真通过。

## 尚未完成的运行验收

- `GET /v1/public/regions` 和公开赛事目录的生产 404 继续阻塞相应真实成功流程；页面保留真实错误、重试和可用入口。
- 缺少相应身份、权限或业务记录的报名、预约、审核、资金、记分流程只完成隔离成功态与微信真实失败/禁用态核对；没有向生产写入测试数据。
- 已执行真实输入框聚焦，但自动化 SDK 未捕获原生键盘画面，因此不标记键盘视觉验收通过。
- 本次没有重新采集当前代码的微信 320/430 运行截图；这两个宽度由隔离矩阵覆盖。
