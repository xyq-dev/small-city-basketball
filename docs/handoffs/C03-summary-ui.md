# C03 私有球员数据榜 UI

2026-10-23（Asia/Shanghai），负责人 `/root/c03_summary_ui`，IN_PROGRESS / LOCAL_ONLY。

现场：`/workspace/scratch/dc6a786e1a31/c03-summary-ui`，origin=`https://github.com/xyq-dev/small-city-basketball.git`，分支 `feat/C03-summary-ui`，HEAD `909fb74fcc702baded0d70ce5c6cde6d5a7ddddd`。初始仅冻结 contracts 依赖镜像 dirty，保留且不交付该镜像。

授权路径仅 `apps/admin/src/player-summary/**`、`apps/admin/src/api/player-statistics.ts` 及本记录；App 路由、contracts、全局样式与汇总文档由 root 集成。不 commit/push，不执行生产操作。

UX：页面为机构内只读资料，球队上下文不请求整届数据。沿用原 panel/view-table 与手机卡片布局；榜单按服务端有效确认得分排名，同分共同名次，不以犯规暗破同分。单列总场、已计入 PLAYER_BASIC、TEAM_ONLY 与待确认，显示采集覆盖和归属完整性；固定名单计数文案为“采集名单场次”，不声称真实出场。未采集高级指标明确“未统计”，不生成个人公开导出。无正式赛程、零已确认、错误、撤权以及机构切换均不能回落 Mock 或保留另一机构资料。刷新清除旧资料后重读；重开比赛退出榜单以最新服务端结果体现。

计划验证：严格 API 白名单与错误路径，页面空态/覆盖/并列/未归属/刷新/错误恢复/跨机构迟到响应；admin typecheck、相关单测与 build。本地浏览器/真实 PG 与真实 API 交 root 整合隔离 CI；不得把单测称为独立浏览器验收。

## 2026-10-23 14:16（Asia/Shanghai）本地实现交接

状态 REVIEW / LOCAL_ONLY，未提交/推送。已实现严格响应适配器与只读页面：DTO/嵌套名单白名单、未知算法/事件状态/非法计数与覆盖声明拒绝；绑定返回 event.id 与请求赛事。页面按机构+赛事 key 重建，刷新或撤权失败清除旧资料，不泄露迟到的旧机构响应。采集与归属单列；无逐人有效确认样本时归属完整性未计算，attributionComplete=false（root/API作者已同意）；同分不以犯规分胜负。

交付文件（仅下列，排除 contracts 依赖镜像）：

- `apps/admin/src/api/player-statistics.ts`
- `apps/admin/src/player-summary/PlayerStatisticsPage.tsx`
- `apps/admin/src/player-summary/PlayerStatisticsPage.test.tsx`
- `apps/admin/src/player-summary/api.test.ts`
- `apps/admin/src/player-summary/test-fixtures.ts`
- `docs/handoffs/C03-summary-ui.md`

真实执行：`npm run typecheck --workspace @small-city-basketball/admin` PASS；`npm run test --workspace @small-city-basketball/admin -- src/player-summary` 2文件/23测试 PASS；全admin单测34文件/317测试 PASS；`npm run build --workspace @small-city-basketball/admin` PASS（已有主chunk略超500k警告，未改依赖或全局结构）；针对交付代码 `prettier --check` PASS；`git diff --check` PASS。build尚未接入新路由，新增页面由typecheck覆盖，集成后需要root再次构建。

未执行：真实浏览器/手机/HTTPS/真实PG，不能将 jsdom 测试当成这些证据。root已安排 browser agent 集成真实API回归。无迁移，无生产账号/数据/部署操作。远端未更新，基线不变。

root下一步：复制上述允许路径，App.tsx lazy import `./player-summary/PlayerStatisticsPage` 的 `EventPlayerStatisticsPage`，路由 `/events/:eventId/player-statistics` 传 RegistrationWorkspace；集成相关 API 并执行隔离CI。h1「本届球员基础数据」，稳定aria区域「采集范围与完整性」「球员得分与犯规榜」「球队归属核对」「数据来源」，刷新按钮「刷新球员数据」。

14:17（Asia/Shanghai）独立审查反馈已补：无样本真实API shape仍保留两支球队0聚合，适配器接受 attributionComplete=false 且拒绝true；页面无逐人确认样本不显示球队0值卡，避免误作采集结果。部分覆盖时球队区域明确数字仅已纳入样本累计，零值不代表整届实际零。事件响应与请求ID绑定亦已补回归。最终相关2文件/24测试 PASS；全admin317为此前23项版本的全量结果，新追加负向/正向仅跑相关范围，最终全量由root集成验证。最后代码prettier通过，diff check通过。
