# C05-GROUP-UI 实施与交接

2026-10-24（Asia/Shanghai）；负责人 /root/c05_group_ui；集成人 root。实际目录 `/workspace/scratch/dc6a786e1a31/c05-group-ui`，origin 原 `xyq-dev/small-city-basketball`，分支 `feat/C05-GROUP-UI`，开工 HEAD `ead3a62dd2dc996d11798d356c4ab96ed2b5c845`。开工仅三个依赖 node_modules 符号链接未跟踪，保留所有旧工作树，无 reset/clean。当前 LOCAL_ONLY，待 root 整合；不宣称 main 或生产完成。

## 已写能力

- 沿用后端 `group-knockout.d.ts`：独立 `/groups` 读取、`group-tie-commands` 持久抽签、`group-qualification-commands` 资格首轮、原 `knockout-round-commands` 后轮；明确 pin event version 与 source hash，后轮后重新读取分组投影。
- 2/4/8组及种子队表单，从原权限下冻结报名读取可选球队；每组至少2队、总最多32队、种子不超过组数。发布前只展示服务端按既有 seed 重放的 `draftGroups`，客户端不复制分组算法。
- 分组管理页展示各组有效确认积分、前二顺序、已保存抽签记录；同分抽签与赛程发布分开二次确认；资格/后轮填写全轮场地与UTC+8时间，409保留输入并禁止原决定重放，重新读取后重新确认。
- 公开赛事先读赛制，再分派独立组投影，不调用全届循环榜。逐组积分、前二、固定交叉淘汰签位、最终名次及小组出局；未晋级者没有虚构跨组总名次。公开响应严格白名单，拒绝 seed/内部报名ID/名单/控制等字段。
- 保留单淘汰界面行为，公共淘汰轮次允许组赛后的全局轮号（最大31）；组赛与淘汰合法重逢在球员基础页说明按独立真实场次累计。导出只包含已正式发布的公开比赛，不把尚待发布淘汰场次当缺失。
- 按 root 指派接入媒体作者 `PublicMediaPanel`，传原匿名 fetcher，原比赛404/410/503或离线/stale时卸载媒体。组件自身授权/媒体轮询与文件权限由媒体作者负责；已知第三方外链不能由本站撤回。

## 共享接线

root 需在 `App.tsx` 导入 `EventGroupKnockoutPage` 并接 `/events/:eventId/groups`（原 workspace context）；共享契约须包含最新 `draftGroups`。本分支不修改 App.tsx、contracts/index、后端、Migration、manifest、依赖锁、汇总文档。

`apps/admin/src/media` 与 `apps/admin/src/api/media.ts` 是仅联编用、指向媒体作者工作树的未跟踪符号链接，不提交。整合时 root 应使用媒体作者真实文件，不能把临时链接当交付代码。

## 验证记录

源码 UI 测试使用合成 HTTP fixture，不等于真实 API/PG/桌面手机浏览器。隔离 PG、HTTPS 与真实 API 浏览器由 root 的整合 CI 执行；本分支没有 Docker/PG/生产通道，也未做任何部署、真实账号/商户/媒体操作。

阶段：新增 API 与 UI/原私有排名局部19测试通过；媒体接入前全 admin 43文件376测试通过。首轮发现测试复用同一已消费 Response、时区断言未使用实际UTC+8、媒体新增读取导致旧海报总请求数断言过窄，均按真实语义修正；没有放宽业务授权。媒体接入后局部4文件20测试通过，包括原比赛404/410/503后播放器卸载。最终 typecheck、build、全admin及格式结果见本文件后续检查点。

## 边界与下一步

后端分组归属、资格证明、同分抽签不可重抽、原结果被消费后不能重开、跨机构权限与冲突由后端实现并在真实PG验证；不以这些客户端测试代替。root 下一步按明确文件清单整合本提交与其他作者模块，接完整路由后统一 strict/build/PG/真实API桌面手机验证及独立审查。生产、OBS原生客户端、微信真机与真实支付均未验证。

最终本地检查点：`npm run typecheck --workspace @small-city-basketball/admin` 通过；`npm run build --workspace @small-city-basketball/admin` 通过（沿用构建器大块提示，无报错）；`npm test --workspace @small-city-basketball/admin -- --reporter=dot` 43文件381测试全部通过。此构建不含 root 尚待接线的私有新路由，root 整合后须再构建。格式按本作者明确源码路径检查，不包含媒体作者的临时链接。

## 真实 API 浏览器驱动（已编写，未执行）

按 root 后续指派新增 `tests/api-e2e/groups.spec.ts`。仅显式 `scb_test_*` 隔离 PG SQL 初始化三个合成测试身份（不绕过真实业务权限），随后真实 HTTP 登录；四队报名→独立审核→冻结→锁定组内积分→2组种子分开→浏览器核对原服务端分组→正式组赛→独立确认2场组赛→浏览器二次确认固定交叉资格首轮。验证发布前比赛数不变、发布后4场、旧观众授权404、来源赛果不可重开、新授权公开组榜与签位无私有ID、桌面和手机模拟无横向溢出且无写操作。保留原注册限流，没有新增真实账号或生产写。

`tsc --project tsconfig.tests.json` 通过；本机缺 PG/Docker/对应服务，未运行此真实浏览器驱动。它不是已通过的浏览器证据；root接完路由并跑隔离CI后才可判定。完整5场组赛到决赛/归档/重启恢复由root生产隔离驱动补充，当前测试在资格发布后停止，未声称全商业闭环。

## 追加媒体/商业浏览器重点（已编写，未执行）

2026-10-24 Asia/Shanghai检查点：root追加指派已落为 `tests/api-e2e/media.spec.ts` 和 `commerce.spec.ts`。本轮可复用业务夹具提取到 `helpers/commercial-fixtures.ts`，旧C04 knockout spec保持不动。

媒体：合成PDF经真实浏览器选文件上传为私有保险补充文件（不等于投保或保险资格验真），真实PNG经原API上传并下载hash复核；真实MP4经浏览器上传→私有草稿→原计分事件人工0.1–0.8秒标记→二次显式发布，公开前不可读。公开字节hash及Range206、实际video元数据/64像素/播放时刻推进、桌面/手机模拟布局、媒体撤销后播放器消失及旧GET/Range404均有独立断言。来源 `apps/api/test/media-fixtures.ts` 是媒体作者生成的真实合成文件；当前本树仅临时未跟踪symlink供tsc，root必须整合真实源文件。

商业：两个无机构的独立平台测试用户，用原SQL隔离fixture赋平台角色后真实HTTP登录；浏览器平台路由、报价二次确认/取消不写入、123.45元→12345分不可变v1、另一操作员上下架仅改变catalogVersion、机构负责人平台API403、OFF模式无采购按钮且服务端COMMERCE_DISABLED、无微信支付二维码、真实微信账号页明确未配置均有断言。此驱动保持服务器OFF，不声称覆盖ENFORCED订单双人收款/退款UI；该缺口由root隔离生产HTTPS驱动和真实PG状态机验证单列，不以本OFF页面测试冒充。

两个新增spec与helper执行 `tsc --project tsconfig.tests.json` 和明确路径Prettier检查通过；本机没有PG/Docker/服务/实际浏览器，所有新增真实browser断言仍待CI，不记通过。没有接真实商户、微信AppID、付费资源、生产账号或生产数据库。

## PR13审查P2增量修复

2026-10-24 Asia/Shanghai，root将 PR13 `PRRT_kwDOVTBG086vtpIZ` / comment4362569700 指派本作者修复。`scoring/Management.tsx` 原仅对单淘汰预选并锁定OVERTIME，分组接淘汰界面仍可提交ALLOW_DRAW而被后端RULE_CONFLICT拒绝。增量将GROUP_KNOCKOUT同样纳入固定加时，说明明确覆盖组内赛与淘汰赛，取消修改仍恢复固定策略；原单循环可选平局保持。

新增组件回归 `GroupScoringRules.test.tsx` 覆盖初始GROUP显式加时时长、已存规则与取消恢复、陈旧ALLOW_DRAW不作为合法GROUP选项、RR仍可平局。新增4项与既有ScoringPages合计18项通过，admin typecheck通过；不是服务器或真实浏览器实测。root另修后端错误文案并集成，未修改共享合同/后端/运行CI源树。
