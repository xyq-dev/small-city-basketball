# UI006 微信原生前端 Figma 重建接续记录

## 2026-11-05T20:27:44+08:00 开工检查点

- 实际目录：`D:\Projects\small-city-basketball`；微信工程：`apps\wechat`。
- 远端：`https://github.com/xyq-dev/small-city-basketball.git`。
- 当前分支：`feat/wechat-figma-rebuild`；基线和当前 HEAD：`ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`。
- 旧 UI005 分支 `feat/ui005-figma-complete` 保留在 `133ba3cd723fc40845c00f8ec0dcd9806c4217fe`，没有 reset、clean、stash、覆盖或删除。
- 47 个未跟踪归档文件仍在原位；外部备份：`D:\Projects\scb-backups\wechat-figma-rebuild-baseline-20261105-202715`，文件数和 SHA-256 全部一致。
- 新任务取消旧模板叠加路线。当前还没有把任何旧 UI005 完成数计入 UI006，也没有修改页面代码。
- 本轮只允许本地分支、前端/测试/截图/记录；禁止 commit、push、merge、pack、上传、部署、Migration、生产写入和后端契约修改。

下一条操作：使用当前 Figma MCP 读取 `63:237`、`40:6871`、`54:46`、`59:54`，再读取首页 `35:38` 与“我的”节点，结合主线 `apps/wechat` 建立全新组件和页面清单。

## 2026-11-05T21:10:00+08:00 视觉基准与并行实施检查点

- Figma MCP 已读取最新交接、索引、交互、响应式、首页、账号、城市选择、搜索及本人资料/保障组节点；截图保存在仓库外 `D:\Projects\scb-ui-review\figma-rebuild\20261105-203325\figma`。
- 共享视觉体系已建立：`styles/figma-system.wxss`、`styles/figma-pages.wxss`、`components/figma-*`、重写后的 `scb-header` 与 `scb-nav`，以及 `assets/figma` 下的画板图标。共享文件只由主 Agent 修改。
- 已完成并接通 4/73 页面：首页、我的、城市选择、搜索。首页和我的已取得当前代码的真实微信截图；逻辑视口 `390×844`、导出 PNG `355×768`，两者未混写。
- 首页/账号的隔离 320/390/430 基线已覆盖；真实首页保留生产公开目录错误，真实账号保留微信能力读取失败/游客状态。未向生产注入原型数据。
- 三个并行执行 Agent 已在互不重叠的页面目录推进：公开赛事与球队 18 页、球员与同城 16 页、办赛与记分媒体 16 页；共享组件、配置、文档和微信工具仍由主 Agent统一处理。
- 主 Agent 当前处理本人资料、保险、资格预审、监护、审核与服务规则组。已读取节点 `36:108`、`36:109`、`36:110`、`36:111`、`36:112`、`36:113`、`36:114`、`39:53`、`39:54`。
- 最近直接测试：共享/首页/账号 99/99；城市/搜索相关 173/173；首页三宽 6/6。全量微信测试尚未在本轮稳定整合点执行。

下一条操作：逐页替换本人资料与保障组的旧 WXML/WXSS，保持现有私有资料、审核、保险原单、防重复提交与结果待核对逻辑；随后审查并行 Agent 结果。

## 2026-11-05T22:20:00+08:00 正文与共享层复查检查点

- 已完成主 Agent 独占的 16 页重建；公开赛事与球队 18 页并行组已返回并完成主审。当前确认完成 34/73，另两组及运营交易组仍在独占写入，未提前计数。
- 新增 `apps/wechat/test/ui006-account-governance.test.cjs`，覆盖 12 个本人保障/账号治理页面的新结构、WXML 事件目标、关键状态语义和 320/390/430 渲染。
- 旧公开页夹具中只绑定旧模板文案/展开方式的断言已改为验证最新 Figma 等价状态；赛事页实际漏掉的最终名次和分组进度兜底已补回。`c10-public` 6/6、`c18-directory` 25/25。
- 共享复查修正两处跨页偏差：`figma-tabs` 选中态改为深蓝底白字；`.figma-page` 显式隔离旧全局按钮外边距。390 隔离测得固定操作栏 65px、滚到底后正文与操作栏间距 15px，未重复计算安全区。
- 12 个长页的 320/390/430 首屏/底部隔离图和 `report.json` 位于 `D:\Projects\scb-ui-review\figma-rebuild\20261105-203325\isolated-main`；36 个视口均无横向溢出，明确属于合成夹具，不是微信运行。
- 已知暂时失败：并行中的 `booking-detail` 一度缺少本地私密状态作用域规则，触发 `native-structure` 1 项；已通知该页负责人恢复规则并复测，主 Agent 不越界并发修改。

下一条操作：等待三个独占组停止写入，审查其返回文件和直接测试；随后生成 73＋17 新覆盖表、执行稳定点全量测试并补微信运行抽样。

## 2026-11-05T23:00:00+08:00 全量集成与真实微信检查点

- 当前确认 73/73 路由完成新原生模板，17/17 状态保留为宿主路由条件分支。外部隔离证据：`isolated-routes-v3` 为 73 场景、219 视口、438 图；`isolated-states-v3` 为 17 场景、51 视口、102 图；全部 320/390/430，0 横向溢出。兼容预览不冒充微信运行或逐像素签收。
- 当前微信工程通过开发工具服务连接到自动化端口 `19420`；运行时 73 页，逻辑 `390×844`，原始 PNG `360×779`。成功证据目录：`D:\Projects\scb-ui-review\figma-rebuild\20261105-203325\wechat-runtime-final-20261105-224114`。
- 首页真实状态为全国、公开目录读取失败、0 条公开赛事；账号真实状态为游客、微信能力未知。邮箱登录面板通过真实 `tap` 展开。未模拟会话、未写生产数据。首页主视觉 y=`154.97px`；账号橙色邮箱按钮宽 `210.06px`，展开后的提交按钮宽 `330.09px`。
- 首页微信实测暴露原生按钮全局样式污染并已修复：首页章节文字入口由约 `183.99px` 深蓝块恢复为 `71.99px` 透明入口；五列位置按钮恢复为 `60.42px`；双列扩展入口恢复为 `159.04px` 白底。对应作用域门禁已加入 `home-layout-guard.test.cjs`。
- 首轮全量测试：1238 项、1184 通过、54 失败。失败已逐项分类，服务/媒体组 32/32、当前 UI006 原生截图工具 17/17、图标门禁 5/5 已通过；球员预约和公开账号报名两组仍在迁移。Windows `symlinkSync` EPERM 保留原安全断言，不能删测或降低断言。
- 精简证据已开始写入 `docs/evidence/ui006/`，完整逐页矩阵见 `COVERAGE.md`。本轮仍未 commit、push、pack、上传、部署、执行 Migration 或生产写入。

下一条操作：收拢剩余两组测试，主 Agent 复查改动并重跑最终 73＋17 当前源码矩阵、`npm run test:wechat` 与 `git diff --check`；最后更新准确结果。

## 2026-11-05T23:02:00+08:00 最终本地交接

- 当前分支仍为 `feat/wechat-figma-rebuild`，HEAD 仍为未产生新提交的基线 `ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`；无 merge/rebase，所有 UI006 成果保持未提交。旧 UI005 分支、47 个归档文件和外部基线备份均未改动。
- 73/73 注册路由完成新原生模板及现有功能接线，17/17 补充状态仍是宿主路由条件分支。最终逐项表在 `docs/evidence/ui006/COVERAGE.md`，不沿用 UI005 数量。
- 最终源码隔离证据：`isolated-routes-final` 为 73 场景、219 个 320/390/430 视口、438 张图；`isolated-states-final` 为 17 场景、51 个视口、102 张图；两组均 0 横向溢出。`isolated-key-final` 另覆盖首页、已登录账号、预约表单、记分台、资格预审 15 个视口、30 张图。它们均为合成夹具兼容预览，不是微信运行或自动逐像素签收。
- 微信真实运行仍只计首页和“我的”两条路由：逻辑 `390×844`、SDK PNG `360×779`。首页保留公开目录真实失败态，“我的”保留游客且微信能力未知态，邮箱面板由真实 `tap` 展开；没有注入会话或写生产数据。
- 直接整合回归 242/242 通过。最终 `npm run test:wechat` 为 1238 项、1237 通过、1 失败；唯一失败是 `native-components.test.cjs` 的安全软链在当前 Windows 权限下 `symlinkSync EPERM`，原测试未跳过、未删减。`git diff --check` 退出码 0，仅有 LF/CRLF 提示。
- 精简证据入口：`docs/evidence/ui006/README.md`；外部完整证据根：`D:\Projects\scb-ui-review\figma-rebuild\20261105-203325`。正式身份、真实业务记录、恢复的地区/公开赛事目录、支付/审核/记分条件、原生键盘与真机是后续运行验收所需外部条件。

下一条操作：在获得新的明确 Git 授权后，先按路径审查 350 余项工作区差异与私有配置，再决定是否提交；在此之前不要 commit、push、切换或清理。微信运行补验应从当前源码和现有真实状态继续，不得把隔离夹具标为真实成功流程。

## 2026-11-06T01:01:34+08:00 最终视觉与运行编译交接

- 实际现场仍为 `D:\Projects\small-city-basketball`、分支 `feat/wechat-figma-rebuild`、HEAD `ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`；无 commit、push、切换、reset、clean、stash、pack、上传、部署、Migration 或生产写入。
- 修改前最新前端与差异备份位于 `D:\Projects\scb-backups\wechat-figma-ui-20261106-000532`；补丁 SHA-256 为 `C72F24FA74CA6C9616EA71D35C46EB18A010EF2B4A1A817585C890F18800F772`。原未跟踪归档仍保留。
- 微信开发者工具实际工程为 `D:\Projects\small-city-basketball\apps\wechat`，自动化端口 `19420`，逻辑视口 `390×844`、SDK PNG `360×779`、SDK `3.17.4`。当前停留在 `pages/home/index?uiPreview=figma`，即编译条件 `Figma UI预览 · 首页`。
- 首页和“我的”游客最终微信内预览对照已写入 `docs/evidence/ui006/comparisons/`；当前代码真实失败态分别保留公开目录读取失败与微信能力未知，没有用合成数据覆盖正常运行链路。
- 六个关键二级页（赛事详情、预约表单、预约详情、记分台、资格预审、交易订单）完成 320/390/430 首屏与底部隔离复核，共 18 视口、36 图、0 横向溢出；代表图在 `docs/evidence/ui006/priority-pages/`。公开媒体作为同类编译风险页一并实测编译。
- 开发者工具日志曾明确报 `pages/scorer/index.wxss(83:23): error at token '*'`。根因是微信 WXSS 不支持 `> *` 通配子选择器；记分台和公开媒体已改用明确子类。随后 7/7 关键路由 `reLaunch` 成功、路由一致、异常数组为空，最终回到首页预览。
- 本轮直接测试 106/106；全量暴露的预约报价字段、赛事关注文案、交易冲突和记分台状态夹具更新后定向测试 62/62。最终 `npm run test:wechat` 为 1244 项、1243 通过、1 失败，唯一失败仍是 Windows 创建测试软链时报 `EPERM`。日志 `D:\Projects\scb-ui-review\figma-rebuild\20261106-000954\test-wechat-final2.log`，SHA-256 `EF2F3D74C0A5B47D2EBCEEDA672425B873C45E3DDF211F5215012E511B0A0713`。
- `git diff --check` 退出码 0；输出仅有行尾转换提示。73/73 路由与 17/17 宿主状态仍通过三宽模板展开测试，但本轮人工高保真复核范围只计首页、“我的”及六个关键二级页，不能把其余 65 页称为本轮逐像素微信签收。

下一条操作：若继续扩大视觉签收，按 `docs/evidence/ui006/COVERAGE.md` 从未人工复核的 65 页逐页读取对应 Figma、采当前源码画面并修正；若只补真实运行验收，则需要恢复的公开目录、测试身份/角色、可读业务样本和真机条件。继续保持隔离预览与真实微信业务状态分开记录。

## 2026-11-06T02:24:19+08:00 最终收口交接

- 实际现场保持 `D:\Projects\small-city-basketball` / `feat/wechat-figma-rebuild` / `ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`；所有成果仍未提交。没有切换、reset、clean、stash、commit、push、pack、上传、部署、Migration 或生产写入。
- 最终当前源码矩阵为 `final-isolated-routes`（73 场景、219 视口、438 图）与 `final-isolated-states`（17 场景、51 视口、102 图），320/390/430 均无横向溢出。矩阵是合成兼容渲染，不是微信实际成功态。
- 完整回归最终为 1249 项、1248 通过、1 失败；唯一失败是 Windows `symlinkSync EPERM`。收口中更新的是已过时的模板文案/资源断言；培训结业与恢复仍使用真实页签、handler、权限、版本、理由和原命令恢复断言。精简记录：`D:\Projects\scb-ui-review\figma-rebuild\20261106-000954\test-wechat-final3-summary.txt`。
- 微信开发者工具当前进程监听 `127.0.0.1:12993`。干净重启后当前实例要求重新登录并返回 `APPID_ERROR`，所以最终 73 路由复编和新截图未执行；未修改私有配置绕过。此前已成功核对实际工程为 `apps/wechat`，并完成首页/账号截图及 7 个关键二级路由编译。
- `project.config.json` 中仍有三个明确隔离入口：`Figma UI预览 · 首页`、`Figma UI预览 · 我的游客`、`Figma UI预览 · 微信读取失败`。首页/账号源码在已存最终微信截图后未再修改；二级页最终证据只计隔离三宽，不能写成微信实际验收。

解除条件：在当前开发者工具中重新登录有权使用该私有 AppID 的微信账号，然后从现有三个 Figma UI 预览入口重新编译；如需真实成功态，还需恢复公开目录接口并提供隔离测试身份、角色与可读业务样本。继续禁止通过生产写入报名、预约、支付、审核或比分数据取得截图。

## 2026-11-06T07:41:19+08:00 五处验收偏差修复交接

- 当前现场仍为 `D:\Projects\small-city-basketball` / `feat/wechat-figma-rebuild` / `ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`；未切换、reset、clean、stash、commit 或 push。开工 584 个既有状态项全部保留，相关文件和补丁已备份到 `D:\Projects\scb-backups\ui006-five-fixes-20261106-072729`。
- 本轮新增代码差异仅涉及 `pages/local/index.wxss`、`pages/watch/index.wxml`、`pages/teams/index.wxml`、`pages/account/index.wxml/.wxss`、`components/navigation/index.wxml/.wxss`、`pages/home/index.wxss` 及定向门禁 `test/c11-shared-ui.test.cjs`；共享页头源码无需修改，赛事/球队直接复用既有 `mode="account"` 品牌模式。
- 五项定向结论：同城四页签由约 184px/项、末项越出视口，修为 358.08px 容器内约 87.27px/项；赛事/球队由纯文本页头变为 28px 品牌图标＋标题；游客协议第二行新增 18px 方形视觉标记且真实认证 checkbox 仍为一个；五主导航为 23px 图标＋11px/16px 文本；首页分区标题为 20px/27px。
- 微信开发者工具实际工程是 `D:\Projects\small-city-basketball\apps\wechat`，服务端口 12993、自动化端口 9420。当前源码完成 9 个场景首屏/底部重编与截图，逻辑窗口 `390×844`、原始 PNG `397×860`，无 AppService 异常；最后恢复至 `pages/home/index?uiPreview=figma`。
- 外部证据根为 `D:\Projects\scb-ui-review\figma-fixes\20261106-072811`：`before-after` 为旧验收画面与当前微信画面的等比例并排图，`comparisons` 为最新 Figma 与当前微信图，`diagnostics/runtime-layout.json` 为计算尺寸，`isolated` 为 320/430 合成兼容预览。隔离图不计真实微信验证。
- 直接相关测试 36/36 通过；Windows 原生组件安全软链测试仍为 17/18，唯一失败是 `symlinkSync EPERM`，测试未修改；`git diff --check` 退出码 0，仅有既有行尾转换提示。其余 68 页和 16 个状态没有新增验收，继续保持“无法判定”。

下一条操作：如继续验收，应先取得可切换到 320/430 的微信模拟器条件，并为赛事、同城、球队提供只读成功态接口/身份，再做同状态正文对照；不要将本轮隔离夹具或真实失败态写成成功态微信验收。

## 2026-11-06T10:57:14+08:00 剩余 68 页与 16 状态收口交接

- 现场仍为 `D:\Projects\small-city-basketball` / `feat/wechat-figma-rebuild` / `ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`，微信开发者工具实际工程为 `D:\Projects\small-city-basketball\apps\wechat`。本轮备份位于 `D:\Projects\scb-backups\ui006-remaining-20261106-074916`；未切换、reset、clean、stash、commit 或 push。
- 当前 Figma 与微信原生隔离样例累计覆盖 73/73 页面、17/17 宿主状态；逻辑视口 `390×844`、原始 PNG `397×860`。每项都有首屏、底部和等比例并排图，逐项表为 `D:\Projects\scb-ui-review\figma-remaining\20261106-074916\acceptance-73-pages-17-states.csv`，总报告为同目录 `REPORT.md`。
- 本轮按批次修复正文、状态与固定操作区；最后复核又修正账号/分账长按钮、分账 `receipt` 图标、访问受限红色错误标题。赛事旧业务夹具暴露“分组/淘汰”子页签未显式进入及最终名次漏显，已补回并保留原有公开数据语义。
- 最终原生重编赛事详情时发现有数据仍残留“暂无已发布赛程/积分待发布”；将该页数组空态改为显式 `length === 0` 后，逻辑 `390×844` 原生画面已与 `36:60` 对齐，复编 0 AppService 异常、0 控制台错误。最终图在 `comparisons/event-final-compile/`。
- UI006 直接回归 49/49，赛事公开视图与路由定向回归 23/23。最终 `npm run test:wechat` 为 1250 项、1249 通过、1 失败；失败仅为 `native-components.test.cjs` 在 Windows 创建测试软链时报 `EPERM`。`git diff --check` 退出码 0，仅有行尾转换提示。
- 相对 `D:\Projects\scb-backups\ui006-remaining-20261106-074916` 的逐文件 SHA-256 对比，本轮实际变化 148 个文件，其中页面文件 133 个（65 个页面目录）、共享组件 4 个、素材 1 个、前端工具 1 个、微信测试 2 个、公开赛事夹具 3 个、UI006 场景清单 2 个、任务/交接 2 个。
- 原生隔离样例只证明同状态 UI；当前源码的真实业务成功流程仍为 0/90、无法判定 90/90。320/430 微信实际截图也为 0/90，因当前自动化连接不能切换逻辑视口；浏览器兼容预览没有计入微信实测。

下一条操作：若补真实业务验收，需要恢复可读目录接口并提供隔离测试身份、角色与只读业务样本；若补设备覆盖，需要可切换 320/430 的微信模拟器或真机。继续禁止用生产写入制造报名、预约、资金、审核或记分成功态。

## 2026-11-06T13:35:00+08:00 提交前阻塞修复交接

- 现场保持 `D:\Projects\small-city-basketball` / `feat/wechat-figma-rebuild` / `ef62cb1d47b3b63d9c854043f07cb5f8d6503b52`；没有切换、暂存、commit、push、reset、clean、stash、pack、上传、部署、Migration 或生产写入。修改前备份在 `D:\Projects\scb-backups\ui006-precommit-fix-20261106-132125`。
- 合成预览入口已集中到 `apps/wechat/utils/figma-preview.js`。首页和账号必须同时取得显式 `uiPreview=figma` 与微信可信 `envVersion=develop` 才进入预览；trial、release、未知、缺失和读取异常全部 fail closed。参数或缓存不能伪造环境，正常会话、权限、认证同意与数据链路未改变。
- 新增 `apps/wechat/test/ui006-preview-gate.test.cjs`；门禁矩阵 6/6、相关组合回归 157/157。开发版无参数及非开发版带参数均走正常流程；预览桩不产生请求、缓存/会话写入、导航或业务动作，测试未访问生产。
- 已按审查指定的 12 页、3 状态和原 Figma 节点重采微信原生隔离样例。逻辑视口 `390×844`，原始 PNG `365×788`，15/15 场景均有首屏、底部、等比例对照和源码 SHA256 指纹；采集期间 0 源码变化、0 AppService 异常、0 控制台错误。证据根：`D:\Projects\scb-ui-review\ui006-precommit-fix\20261106-132125`。
- 历史 `1250/1249` 记录仅有摘要，不能回写为完整原始日志。本次修复稳定后只执行一次完整 `npm run test:wechat`：1256 项、1255 通过、1 失败、0 跳过；唯一失败仍是 Windows `symlinkSync EPERM`，断言未跳过或放宽。完整 stdout SHA256 为 `BE5011C62660FA9B612E41D8E056283EFD2A7A00DC0EFF29DAC5D724990B62AA`，stderr 为空，退出码 1，均在证据根保留。
- 本轮未改任何已验收页面 WXML/WXSS、共享视觉组件或素材。真实业务成功态、320/430 微信实际截图和官方 pack 仍未执行，不得由本轮隔离证据推导为通过。

下一条操作：依据证据根中的最新候选文件清单与 SHA256 做暂存前复核；本轮明确保持未暂存、未提交、未推送。

## 2026-11-07T09:21:54+08:00 首页图标与赛事卡修复交接

- 当前修复现场为 `D:\Projects\scb-worktrees\home-figma-icons` / `fix/home-figma-icons` / `b8ee284adb9714793f8b98dc995a7db530879413`，基于本轮 fetch 后的最新 `origin/main`。原目录 `D:\Projects\small-city-basketball` 仍为 `feat/wechat-figma-rebuild@6fc06983b9d0093268e25354cca89dace79d1dab`，48 个状态项（其中 47 个未跟踪归档）保持原状。
- 已完成最小代码修复：首页“我的球队”使用 Figma `jersey`，底栏球队保持 `teams`；首页模式页头使用节点 `35:41/35:53/35:56/35:60` 的 28/13/22/18px 专用透明矢量；赛事卡节点 `35:102` 校正 14/8 圆角、17/23 标题和 `35:107/35:108` 的 58×20、5px、11/15 状态规格。账号页品牌素材、底栏行为、API、权限和预览门禁未改。
- 资产溯源与最终 SHA-256 写在 `apps/wechat/test/fixtures/home-figma-icons.json`；`home-figma-icons.test.cjs` 同时核对调用槽位、字节指纹、透明背景、jersey/teams 边界和赛事卡规格，旧 `icons.test.cjs` 的错误 `teams` 预期已按本次 Figma 节点修正。直接回归 34/34。
- 完整微信测试为 1624 项、1623 通过、1 个 Windows `symlinkSync EPERM`、0 跳过；原始 stdout/stderr 与退出码位于 `D:\Projects\scb-ui-review\home-figma-fix\20261107-092154`。`git diff --check` 通过。
- 当前微信开发者工具 HTTP 服务端口为 12993。官方 CLI 已明确接收本次工作树工程路径，但项目初始化对私有 AppID和 `touristappid` 都返回 `APPID_ERROR: 需要重新登录`，所以未产生自动化端口和当前源码微信截图。该项必须在开发者工具重新登录后继续；现有 `auxiliary-preview` 是浏览器兼容辅助证据，不得改写为微信实测。
- 下一条操作：开发者工具恢复登录后，打开 `D:\Projects\scb-worktrees\home-figma-icons\apps\wechat`，先采 `pages/home/index` 无参数、`uiPreview=false` 的 390 正常首页，再采开发版 `?uiPreview=figma` 赛事卡；核对五个图标和赛事卡计算值后仍保持本分支未提交，除非获得新的 Git 授权。

## 2026-11-09T16:57:00+08:00 微信复验交接

- 登录已恢复。开发者工具打开 `D:\Projects\scb-worktrees\home-figma-icons\apps\wechat`，不是旧工作树的 `6fc0698`。正常首页无参数、`uiPreview=false`；隔离赛事卡使用开发版 `uiPreview=figma`，并标明微信原生隔离样例。
- 品牌素材改为节点 `35:41` 的整节点 SVG，球衣改为节点 `40:6784` 的 26×26 SVG。页头箭头、消息、搜索与赛事卡规格沿用本次最小修复。账号页旧品牌素材未替换。
- 本机证据目录 `D:\Projects\scb-ui-review\home-figma-fix\20261109-1649` 只在本机可访问，不是已上传附件。正常首页公开赛事保持真实空态。真机、320/430、真实业务成功态和官方 pack 仍未验证。
