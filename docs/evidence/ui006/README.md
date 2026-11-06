# UI006 微信原生前端重建证据

本目录记录 UI006 从零重建后的精简可共享证据。旧 UI005 的完成数、预览和截图没有继承到本任务；完整逐页截图保存在仓库外，仓库内只保留覆盖表、代表性对照图和当前微信运行证据。

## 设计依据

- [开发交接 63:237](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=63-237)
- [73 页面＋17 状态索引 40:6871](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=40-6871)
- [交互组件 54:46](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=54-46)
- [首页三宽 59:54](https://www.figma.com/design/QpKOskViUwHFVqSG3uYR9X?node-id=59-54)
- [73 路由与 17 状态逐项表](COVERAGE.md)

## 当前覆盖

| 验收层 | 覆盖 | 结论 |
| --- | --- | --- |
| 原生 UI 实现 | 73/73 注册路由、17/17 宿主状态 | 新 WXML/WXSS 与有作用域共享组件已落地；17 状态未额外注册为页面 |
| 功能接线 | 73/73 路由 | 现有 API、会话、权限、防重复提交、未知结果与恢复语义保留；不代表每条生产成功流程已运行 |
| 隔离视觉 | 73 路由 × 3 宽度，17 状态 × 3 宽度 | 最终源码共 270 个视口、540 张首屏/底部 PNG，320/390/430 均无横向溢出；属于合成夹具兼容渲染，不是微信真机或自动逐像素签收 |
| 本轮高保真复核 | 首页、“我的”游客、赛事详情、预约表单、预约详情、记分台、资格预审、交易订单 | 首页/账号为微信内 Figma UI 预览实拍；六个二级页为 18 个三宽隔离视口、36 张 PNG |
| 微信实际运行 | 2/73 路由 | 首页真实公开目录失败态、“我的”真实游客且微信能力未知态；逻辑视口 390×844，SDK 原始 PNG 360×779 |

## 代表性对照

- 2026-11-06 当前代码微信基准：[尺寸、状态、关键页与验证说明](CURRENT-BASELINE-20261106.md)；[首页 Figma / 微信 Figma UI 预览最终对照](comparisons/home-figma-vs-wechat-final-20261106.png)；[“我的”游客最终对照](comparisons/account-guest-figma-vs-wechat-final-20261106.png)
- 首页：[Figma 与隔离成功态](comparisons/home-figma-vs-isolated-success.png)；[Figma 与微信真实目录失败态](comparisons/home-figma-vs-wechat-real-error.png)
- “我的”：[Figma 与隔离游客态](comparisons/account-figma-vs-isolated-guest.png)；[Figma 与微信真实能力未知态](comparisons/account-figma-vs-wechat-real-unknown.png)
- 关键业务页 390 当前首屏：[赛事详情](priority-pages/event-390-top-20261106.png)、[预约表单](priority-pages/booking-create-390-top-20261106.png)、[预约详情](priority-pages/booking-detail-390-top-20261106.png)、[记分台](priority-pages/scorer-390-top-20261106.png)、[资格预审](priority-pages/qualification-precheck-390-top-20261106.png)、[交易订单](priority-pages/trade-order-390-top-20261106.png)
- 最新 Figma 原图样例：[首页](references/home-35-38.png)、[球员目录](references/players-36-76.png)、[球员详情](references/player-36-77.png)、[球员对比](references/compare-36-78.png)、[预约表单](references/booking-create-36-79.png)、[预约列表](references/bookings-36-80.png)
- 当前微信原图：[首页首屏](wechat-runtime/home-top.png)、[首页底部](wechat-runtime/home-bottom.png)、[账号首屏](wechat-runtime/account-top.png)、[账号底部](wechat-runtime/account-bottom.png)、[邮箱面板真实点击展开](wechat-runtime/account-email-expanded.png)；采集详情见 [report.json](wechat-runtime/report.json)

对照图只做保持比例的并排排版，没有拉伸微信 PNG 冒充 390 像素文件。隔离图均标注合成环境，不能替代真实业务成功态。

2026-11-06 的重新核对只把首页和“我的”计为本轮最新 Figma / 微信实际视觉基准；此前 73 路由与 17 状态矩阵仍用于证明当前模板可渲染、状态可覆盖和三宽约束，不自动等同于本轮逐页高保真微信签收。

## 验证结果

- 最终受影响套件已逐项复跑通过；其中收口批次覆盖 75/75 的赛事/培训/报名工作流与 32/32 的关注/图标门禁。
- `npm run test:wechat` 最新完整原始执行：1256 项，1255 通过，1 失败，0 跳过。唯一失败为 `apps/wechat/test/native-components.test.cjs` 在当前 Windows 权限下创建外部项目软链时报 `symlinkSync EPERM`；安全测试没有被删除、跳过或放宽。
- `git diff --check`：退出码 0；仅输出 LF 将来可能转换为 CRLF 的工作区提示。
- 历史精简记录 `D:\Projects\scb-ui-review\figma-rebuild\20261106-000954\test-wechat-final3-summary.txt` 只对应 1249 项摘要，不冒充完整 stdout；此前 1250/1249 记录同样没有完整原始流。本次完整 stdout、stderr 与退出码位于 `D:\Projects\scb-ui-review\ui006-precommit-fix\20261106-132125\test-wechat.*`，stdout SHA256 为 `BE5011C62660FA9B612E41D8E056283EFD2A7A00DC0EFF29DAC5D724990B62AA`。
- 完整视觉证据根：`D:\Projects\scb-ui-review\figma-rebuild\20261106-000954`；最终 73 路由与 17 状态矩阵位于 `final-isolated-routes`、`final-isolated-states`，首页/账号微信证据位于 `wechat-runtime-current`，关键页三宽证据位于 `isolated-priority-final2`。
- `project.config.json` 配置 `Figma UI预览 · 首页`、`Figma UI预览 · 我的游客` 与 `Figma UI预览 · 微信读取失败`。运行时还必须由 `apps/wechat/utils/figma-preview.js` 从微信可信账号信息确认 `envVersion=develop`；trial、release、未知、缺失和读取异常均关闭预览。URL 参数、缓存和用户输入不能单独开启合成模型，正常运行不会以合成数据作为失败兜底。
- 2026-11-06 提交前定向重采覆盖审查指定的 12 页、3 状态；15/15 均为当前源码的微信原生隔离样例，逻辑 `390×844`、原始 PNG `365×788`，且附采集前后源码 SHA256。完整原图和对照位于 `D:\Projects\scb-ui-review\ui006-precommit-fix\20261106-132125`；这仍不是登录、支付、报名等真实业务成功流程。

## 尚需外部条件

- 地区目录和公开赛事目录的生产 404 阻塞对应真实成功流程；当前运行保留真实失败和重试入口。
- 其余 71 页的微信运行、登录后角色工作台、真实业务记录、支付/退款/审核/记分以及原生键盘与真机行为尚未执行。
- 补验需要可用测试身份与业务样本、恢复的公开接口、相应角色权限和真机/开发者工具条件；不得通过生产写入合成报名、预约、资金、审核或比分记录取得截图。

本轮分支为 `feat/wechat-figma-rebuild`，HEAD 仍是基线 `ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`，成果全部未提交；未执行 commit、push、pack、上传、部署、Migration 或生产数据修改。
