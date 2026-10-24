# C09 小程序视觉修正证据

2026-10-25 Asia/Shanghai。用户未接受C08展示视觉；本轮修正四个已展示的核心页面及全局原生控件/排版。功能回归通过不视为用户视觉签收。

本证据保存在`evidence/c09-mini-ui-fidelity`，与PR16候选应用代码相同，只追加文档/原图；避免为了保存截图而重启在途PR检查。当前未合并main，完整CI及统一视觉签收仍待办。

## 当前候选与执行

- 本地source `09d0780ff5f576597363c7e99b71f1cd9bd81ff1`；GitHub source `21994add691918a30774322e48e2e306e80ddbc6`；相同tree `7bae5137c714721c9515117472f4e2a99e12051c`，Git Data写入后已精确核对。
- [PR16](https://github.com/xyq-dev/small-city-basketball/pull/16)、[CI40117324334](https://github.com/xyq-dev/small-city-basketball/actions/runs/40117324334)。本次读取：admin及隔离production job SUCCESS，api job仍in_progress，不把阶段结果写成完整CI通过。
- admin原始日志实际读取：Web512/API534源码、原生VM232、format/typecheck/build通过；96原生兼容布局+14 Web Mock=110 passed，96个重复mobile矩阵skip，不跳过原mobile Web用例。实际文件守卫96组JSON/PNG通过，无重试。
- Chromium前安装Noto Sans CJK普通与额外字重，修正中文衬线回退；本机未能安装Chromium（空/损坏ZIP），没有把本机模板生成当浏览器验收。
- 没有改后端、数据、Migration或正式环境；真实微信编译/真机、真实支付等边界保持。

## 新截图及原件核验

下载artifact `12569556719`（15,140,411 bytes），ZIP SHA256 `9e482bc33038c80838860f96e501a85b8da39b6a733a12bbae7df8f5d1a38f95` 与GitHub digest一致。实际读取96份JSON与96张PNG，320/390/430各32例，均为对应宽度×844；无所检查的页面溢出、小按钮或不可读输入。6张新代表图按原字节提取，没有后期重绘；来源/哈希见[screenshots.json](screenshots.json)，全部诊断见[layouts.json](layouts.json)。

这些图片是当前真实WXML/WXSS经离线Chromium兼容层渲染，全部合成数据；**不是微信开发者工具或真机截图**。原生头部、字体、系统控件与安全区存在近似，不能将这些图称作21页/99状态逐像素或官方验收。

| 场景 | 原Figma参考 | 本轮代码渲染 |
|---|---|---|
| 首页 | [原稿](reference-home.png) | [390px](home-390.png) |
| 球员列表收起筛选 | [原稿](reference-players.png) | [390px](players-390.png) |
| 最多3人比较 | [原稿](reference-compare.png) | [390px](compare-390.png)、[320px](compare-320.png) |
| 预约填写与安排 | [单场稿](reference-booking-single.png)、[整届稿](reference-booking-tournament.png) | [整届/多人填写](booking-create-390.png) |
| 核对费用/未勾声明 | [原稿](reference-booking-review.png) | [整届/多人核对](booking-review-390.png) |

原稿已从Figma高保真上下文重新读取，节点home30:35、players30:78、compare30:333、single30:552、tournament30:638、review30:806。原稿中的单人/单场示例不是本轮真实产品数据。代码不灌入虚构首页订单，也不把零值改成示例8.4分；金额仍精确到分，真实资格/保险未验证说明和多位球员/条件项保留。原Figma图仅供对照，没有用作运行界面的背景或控件。

## 视觉与交互复核范围

- 首页390：20px页边、118px hero、350×44 CTA、124px预约卡等坐标与原稿一致；恢复独立满宽按钮。球员390：80px提示、44px筛选按钮、y332起/246px信息卡与原稿对应；保留展开筛选场景，新增收起结果场景。
- 比较320/390：100px固定指标、125px球员列、64px表头/56px行，核心7指标优先。已实际看首屏、第三列横滑及底部原图，费用、授权来源说明和逐人操作可达。较原稿保留完整提示，提示卡多约20px且语义标题不同；不是逐像素相同。
- 预约：已实际看填写/核对首屏与底部，条件费用单列，声明默认未勾且提交禁用。五类合作、原commandId恢复、报价快照与身份/写锁未改变。填完首字/首次选择导致编辑器意外折叠的P2已修复，新增2条真实Page回归并独立重放原缺陷通过。
- 独立只读复核实际看4张首页/列表对照图和7张比较/窄屏/底部图，所列范围无可见阻塞；用户视觉签收仍待反馈。没有逐图签收所有21页/99业务状态，也没有微信工具、手机系统控件或真实弱网测试。
