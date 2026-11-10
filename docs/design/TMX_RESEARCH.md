# TMX全方位研究与小城市篮球适配

2026-11-10（Asia/Shanghai）；root集成，TMX源码与本项目差异由两位只读协作者并行复核。用户要求研究后加入有价值功能；本记录区分来源事实、适配建议及实现进度。

## 结论

首选补齐**网页后台的权威排程预演**，复用本项目已存在的服务器优化与原保存/校验/发布，再逐步设计场地网格和现场工作台。不能把整个TMX或其网球规则引擎挂入现有篮球平台；不能把研究/设计完成当作功能已经实现。

## 来源与证据等级

- 固定源：[CourtHive/TMX@72ba511](https://github.com/CourtHive/TMX/tree/72ba511ab026f8442886937ad594d9da9d0add88)，tree`1138bf12048236c513ddd75d3747bfcfe741a045`；package版本8.52.0。MIT实际文件[LICENSE.txt](https://github.com/CourtHive/TMX/blob/72ba511ab026f8442886937ad594d9da9d0add88/LICENSE.txt)，Copyright(c)2024 Charles Allen。直接复制实质代码需保留许可；本卡借鉴交互和边界，不引入TMX源码或新依赖。
- Vanilla TypeScript/Vite/Electron、Node≥24、pnpm12.16.1。规则依赖`tods-competition-factory@7.33.0`，UI依赖`courthive-components@7.13.0`，存储Dexie4.4.7，Socket.IO客户端4.8.4。
- 已阅读README、许可证、package、关键实现及对应测试定义。**没有安装、独立运行TMX或执行其测试**；factory内部未审部分不宣称已证明。固定源码比浮动README/历史方案优先。
- 本项目基线`e8c8d735d09f1a35dd4a4cebbb97a6e7de8ba69b`，已逐项读取实际admin/API/原生代码；旧报告不代替本轮验收。

## 能力矩阵

| TMX能力 | 核实到的行为 | 本项目现状 / 适配方向 |
| --- | --- | --- |
| 赛制、签位、多阶段 | elimination/round-robin/tiered由factory管理 | 已有单/双循环、单淘汰、分组接淘汰和逐轮发布，不重复实现 |
| 场地网格 | Grid拖放构造mutation，法院/出场顺序交换 | 当前按轮卡片；新网格应作为原草稿的可视化投影，保留表单/键盘替代 |
| 拖拽时间语义 | TMX交换场地/顺序，但各比赛保留自己的scheduledTime | 篮球时间轴拖放必须另定明确时间语义，不能照搬courtOrder |
| 场次锁 | factory检查位置锁；双场交换需同时检查双方 | 当前只有preserveAssigned保留全部已安排；逐场锁为后续契约，不虚构已具备 |
| 多方案Plan | placements按matchUpId存差量，basedOnHash标记基线，projection预览 | 当前单次preview；先接现有服务器预演，持久命名方案/比较/重基另卡 |
| 批量预览保存 | Grid使用独立BulkScheduleDraft；失败保留原commandId及意图 | 保持明确采用/保存/校验/发布；未知结果核原请求，不重放新写 |
| 资源冲突 | 场地、先后依赖、参与者占用、休息及窗口诊断 | 本项目已做；补查培训占用投影与最终DB守卫的一致性 |
| 开赛就绪 | 排定时间是否可行，与此刻已休息多久分开 | 当前已有比赛状态/服务端计时；聚合面板应显示来源及未知，不推造就绪 |
| 现场Now条 | 每场地正在/待叫场与叫场规划 | 适合后续只读聚合；不得一键接管记分控制权或独立确认 |
| 签到 | 赛事签到与单场到场分开，统计实到/应到 | 复用现有报名/名单及同城履约，不把空名单当已到齐 |
| 裁判分配 | 资格、利益冲突，none/warn/blocked/unknown分层 | 已有REFEREE供给/派单与日历，无赛事裁判板；应复用人员预约体系 |
| 显式公开 | 逐日期order-of-play发布/撤回，部分公开转集合 | 本项目已有逐轮正式发布及独立观赛/OBS授权；不引入公开旁路 |
| 导入 | 列映射、评级解析、草稿合并后提交 | 本项目已有名单导入；可借鉴预览反馈，不重建球员身份或按姓名合并 |
| 多人协作 | own-mutation去重、权威刷新、缺消息stale阻写、冲突提醒 | 继续服务端版本/事务/租约；不能只加Socket就宣称协作完成 |
| 离线恢复 | 源码有local-only/local-first/server-first策略及commandId恢复 | serverConfig默认serverFirst:true；本项目离线边界以既有功能为准，排赛不新增自动离线合并 |
| 报表/PDF | UI包装pdf-factory，依赖CODES与字体 | 已有导出，后续场地卡/签到单先复用原数据和中文字体 |
| 技术/商业部署 | TMX是CourtHive客户端，使用CODES整记录/factory共享执行 | 小城市篮球是React/原生小程序＋服务器权限/PG，不切换架构、数据库或授权体系 |

## 已核源码入口与陷阱

固定SHA下路径；符号及测试用于追溯，不代表本轮执行成功：

- `src/pages/tournament/tabs/scheduleViews/gridDropMethods.ts::buildGridDropMethods`及测试：交换保留各自时间、占用Now单元拒绝、空单元格、双方位置锁。
- `src/services/scheduleScenarios/scheduleScenariosService.ts`及`planMutations.ts`：服务只转发factory方法；`getScenarioProjection/getScenarioStatus`读取，应用/重基经mutationRequest，不在界面造第二份比分。
- `src/pages/tournament/tabs/scheduleViews/gridView.ts`和`planView.ts`：计划投影及显式Make official；测试`e2e/journeys/90-plan-mode-scenarios.spec.ts`覆盖草案、漂移/重基、复制/重命名和应用。factory基线哈希强制检查尚未独立审查。
- `src/services/schedulingWorkspace/README.md`明确：可选queueService bulk模式**无生产调用者**，存在确认前清队列及弃稿覆盖并发的未修限制。真实Grid使用BulkScheduleDraft；草稿**不跨刷新/多标签页持久化**。不能照搬可选service或将其单测当活跃路径。
- `scheduleLocks.ts/scheduleLockActions.ts`：completed/未安排的位置锁无效；交换和批量移动需覆盖所有受影响场次，不能只检拖出的那一场。
- `inspectorReadiness.ts/matchUpReadiness.ts/inspectorRest.ts`：预计与实际结束/休息分开，不能以未来投影伪造已经休息。
- `scheduleIssueSeverity.ts`：隐藏警告装饰不能隐藏硬冲突。
- `startAllRestGuard.collectStartAllRestWarning`只告警后允许确认；`officialConflicts.evaluateCandidate`失败会给unknown且UI可继续。小城市篮球不能据此放宽硬约束、资格、独立确认或权威计时。
- `services/messaging/remoteMutations.ts`、`services/mutation/mutationRequest.ts`及`storage/offlineCustody.ts`：缺消息/会话归属/原commandId恢复是协作与离线前提，不等同于全量离线自动合并。

## 小城市篮球第一切片合同

现成接口：`POST /v1/orgs/:orgId/schedule-revisions/:id/optimization-preview`，`ScheduleOptimizationInput/Preview`位于`packages/contracts/scheduling-completion.d.ts`；实现`apps/api/src/scheduling-service.ts::previewOptimization/optimizeFixturePlan`和`apps/api/src/schedule-optimization-domain.ts::optimizeSchedule`。

服务器校验机构、权限、当前DRAFT和赛事/修订双版本；读取正式场地/球队及同城占用后有界均衡搜索，输出sourceHash、两版本、完整allocations、unassigned和搜索/公平度指标。它是建议，不是场地预留或全局最优证明。小程序`pages/schedule/index.js::autoAssign`已调用两模式；admin仍`AutoScheduleSuggestions→suggestSchedule`纯本地first-fit。

首批网页沿现有组件提供**服务端补排预演 / 全稿均衡预演**，与现有本地补缺明确区分。未保存输入时必须先显式保存或放弃再请求服务器，不能悄悄保存或降级。预演可取消、放弃、比较，采用仅改本地；原“保存全部安排→服务端检查→显式发布”保留。正式/历史/只读不开放，身份、对象、版本、输入及能力变化使结果失效，迟到响应不得覆盖。

静态核验发现：`localReservations/optimizeFixturePlan/validation`未投影培训资源，而`048_r6_shared_boundaries.sql::x12_existing_calendar_guard`会阻止正式场地与active培训冲突。需实际PG复现，按现有guard语义修复，不新增日历或改旧Migration。

## 后续分期与验收门槛

| 顺序 | 范围 | 状态/门槛 |
| --- | --- | --- |
| A | 网页权威预演、显式采用及占用一致性 | 首批代码已本地整合，真实PG/浏览器及同候选CI待验；未合并/上线 |
| B | 场地×真实时间网格、拖拽、可访问替代 | 先效果图确认/Figma；复用原分配和正式改期，不允许拖动已开赛 |
| C | 逐场锁、多方案持久化、变更对比/基线漂移 | 先冻结规则/API/权限；需要新增DDL时单独审查、真实PG及恢复验收 |
| D | 现场全场地Now/就绪、裁判排班及履约 | 先只读聚合；复用原租约、人员资格/派单，新增写操作逐项审查 |
| E | 合作、离线、报表细化 | 按实际缺口另卡，禁止全记录覆盖、猜测资格或伪称可靠离线 |

培训、预约、赛事等资源竞态，权限/跨机构，409后保留输入，未授权/历史/闭赛，取消/迟到/刷新，会话变更，无可排与搜索上限，都要有直接回归。应用单测、真实PG、mock展示、真实浏览器和生产证据分别报告。当前代码与验证进度以[TMX01任务](../tasks/TMX01.md)及[交接](../handoffs/TMX01.md)为准。


## 2026-11-10 首批本地实现检查点

来源后端516c200→根1438cc6，admin312bf78→根4fc40ec；根另扩展真实HTTP浏览器排赛验收，采用/全稿确认均与PG原稿逐次精确比较。新增按钮只沿用现有排赛卡片与样式，没有新网格/Figma改版或第二套比赛状态。组件按机构和用户、源稿/能力/输入及API归属失效，取消立即解除忙状态；新响应解析有43项新增admin回归。后端4项真实PG定义覆盖培训预演/校验、只读不清理、暂停与取消、持久buffer/半开边界和正式改期；**尚未实际通过PG，不将源码审阅或单测充作PG证据**。

root本机全类型、全格式、两端构建、admin678及API1397源码测试通过；最初根浏览器测试文件格式失败，已仅格式化该文件并完整重跑格式/build通过。作者独立后端复核未发现可确认P1/P2；admin独立静态复核通过，精确head隔离CI待完成。基线相关22项与作者相关65/121项是子集，不与2075全源码重复相加。PG实际尝试缺TEST_DATABASE_URL、beforeAll失败/旧11项skip，不能称缺陷红绿已复现。
