# C03 生命周期与历史观赛 UI

2026-10-23（Asia/Shanghai）；负责人 /root/c03_lifecycle_ui；IN_PROGRESS / LOCAL_ONLY。

实际目录 `/workspace/scratch/dc6a786e1a31/c03-lifecycle-ui`，分支 `feat/C03-lifecycle-ui`，HEAD `909fb74`，origin原仓库。开工唯一dirty为root复制的冻结contracts依赖镜像，不由本任务交付。已读AGENTS/当前状态/看板/协作及root C03任务卡。只写新lifecycle模块/API/直接测试、viewing历史授权/标签及本记录；App路由/contracts/全局样式由root负责。

UX：整届完赛与单场确认区分；先显示服务端完赛门槛和阻塞，再按服务端capabilities提供完赛、归档、重开。操作必须输入审计原因并二次确认，固定所见event.version，重开明确不自动改动单场赛果。409不自动重放，保留原因，明确刷新后重核；org/event切换用key销毁旧状态。闭赛后公开入口改为显式历史观赛授权，新键才可读，原活动链接不复活。公开历史只展示原白名单赛事/赛程/比分/排名，个人名单权限不扩大。OBS继续独立。

本地计划：严格API响应验证、命令版本与凭据测试、页面门槛/权限/二次确认/失败与409恢复/跨org陈旧响应、历史授权及公共历史标签测试，相关typecheck/test/build。真实PG/浏览器由root隔离CI整合，未执行不可记为通过。无生产、commit/push。

## 2026-10-23 验证与交接

状态 REVIEW / LOCAL_ONLY；未提交未推送，HEAD仍909fb74。改动11个源码/测试文件加本记录：

- 新 `apps/admin/src/api/lifecycle.ts`。
- 新 `apps/admin/src/lifecycle/LifecyclePage.tsx`、`LifecyclePage.test.tsx`、`api.test.ts`、`test-fixtures.ts`。
- 改 `apps/admin/src/api/viewing.ts`；`apps/admin/src/viewing/PrivatePages.tsx`、`PrivatePages.test.tsx`、`PublicPages.tsx`、`PublicPages.test.tsx`、`api.test.ts`。

实现：使用原同源credentialed client，严格校验事件ID/状态/版本、完赛数据及capabilities；生命周期固定版本+4–500字trim后原因+显式二次确认，门槛中文化，团队context不发整届请求；409保留原因、禁重放并要求重读。org/event key卸载旧页面，忽略旧响应。历史入口使用独立ENABLE_HISTORY命令、旧LIVE授权不复活，HISTORY标记和公共只读历史标签均沿用现有DTO；purpose缺省兼容旧LIVE，非法值（包括数组/对象类型混淆）拒绝。公开页不请求私有session/org，也不新增名单字段。OBS不与历史授权耦合。

实际本地检查（06:14–06:16 UTC）：

- `node node_modules/vitest/vitest.mjs run --root apps/admin src/lifecycle src/viewing`：7文件72测试通过，包含本卡新增26条；API最初复用同一Response造成测试夹具body被消费，已改为每次新Response后通过。
- `node node_modules/vitest/vitest.mjs run --root apps/admin`：34文件320测试全部通过。
- `npm run typecheck --workspace @small-city-basketball/admin`：通过，包含src测试严格类型检查。
- `npm run build --workspace @small-city-basketball/admin`：通过，存在既有500k chunk警告；本工作树未改App路由，新页面尚需root接路由后验证打包/真实浏览器。
- 对上述源码/测试允许路径prettier check及`git diff --check`：通过。

未执行：真实PG、浏览器桌面/手机/可信HTTPS、root路由集成及完整回归由集成人/浏览器作者继续；本任务无Migration、DB或生产操作。使用既有依赖，未安装新包。冻结contracts镜像保持root原样，不包含在交付文件中。

下一位第一步：只复制以上明确的12文件到root；App懒加载`./lifecycle/LifecyclePage`命名导出`EventLifecyclePage`，路径`/events/:eventId/lifecycle`。正式比赛链接使用既有`/events/:eventId/scoring`。API作者统一reason4–500与blocker codes已对齐。浏览器作者已收到准确按钮：确认整届完赛→同名dialog→同名提交；归档赛事→确认归档赛事；重开赛事→确认重开赛事；操作原因textarea；历史授权启用历史观赛→确认启用历史观赛，新链接仍打开公开观赛。
