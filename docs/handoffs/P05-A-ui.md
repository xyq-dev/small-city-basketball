# P05-A UI 交接记录

## 上下文

- 更新：2026-10-22T15:35:40+08:00；负责人 `/root/p01_ui`，接收人root。
- 目录 `/workspace/scratch/93747c9ad2cb/p05-admin`；远端 `https://github.com/xyq-dev/small-city-basketball.git`。
- 分支 `feat/P05-scoring-ui`；开工HEAD `fd25051141185e0843e129e5c9ccc6ae8d5ad440`，开工工作区clean。本地node_modules软链接复用root依赖，不提交。
- 精确共享合同按root指令cherry-pick API `592a2e5df252ab0bb333aeca99ef93777afe49de`，本分支对应 `8a85f80`；集成人已经另行整合该合同，不重复cherry-pick。
- UI已实施并完成本地下述检查，状态 REVIEW；本次代码提交后 BRANCH_ONLY，尚未MAIN。用户授权开发、验证和本地commit；本任务不push、不部署、不执行Migration。
- 唯一写入 `apps/admin/src/scoring/**`、`apps/admin/src/api/scoring.ts`、`apps/admin/src/App.tsx` 及本记录；未改Runtime授权、旧排赛适配或共享合同内容。

## 本次完成

- API机构模式新增 `/scoring`（SQL授权可见场次）、`/events/:eventId/scoring`（显式规则）、`/matches/:matchId/scoring`（本场工作台）。球队模式路由及子页均阻止后台请求，不发送空org；Mock原四页及行为保留。
- 深蓝／橙色界面含规则、场次人员、私有权威快照、球队当节／全场统计、可读事件记录、不可变正式结果历史。16px表单，主得分按钮27px；移动布局在CSS内实现，实际浏览器视觉验证由root接续。
- 规则不填隐式FIBA默认值；显式节数／秒数／允许分值／平局／加时，首次READY后只读。人员以有效机构成员完整用户ID指定角色、状态和match CAS。仅当前资源capabilities提供动作；OWNER不自动取得写分或独立确认资格。
- 得分只在服务端成功ack或权威读取后显示。20秒超时／网络／5xx／不完整响应保留原envelope、commandId与capture时间；停止新写，先查原收据，404仍为待核对。只有控制、版本、权限条件仍满足才允许相同原包重试；不会自动换ID。人工恢复先经过收据核对及明确确认，不自动重发。
- 每tab身份只保存在模块内存，SPA导航保持、整页刷新生成新身份；lease及待核对命令只在工作台内存。10秒续约、30秒TTL，以服务时间与单调elapsed显示；到期、续约失败、撤权及offline均停新写。刷新或销毁后不承诺恢复未确认命令，未使用localStorage/sessionStorage。
- 时钟由服务器锚点插值，归零不自动暂停／换节／结束。准备／开始分别携带event版本；命令携带match版本和需要的control。准备后重新读取最新capabilities，心跳不改变业务版本。
- 有理由补录／撤销／替换、校时和重开均可操作；原STAT记录被STAT_VOIDED引用后不可重复选择。加时规则下待确认修正成平局时明确保留待处理，不提供回LIVE补打或假FINAL。
- 确认框固定打开时的完整snapshot和版本；后台轮询有新版本即标记过期、禁确认，并在提交中使用固定expectedVersion，避免静默确认另一份赛果。
- 所有列表完整分页或整体失败；HTTP严格检查能力、状态、时钟、确认及控制响应，不回Mock。工作台按机构／match key隔离，异步读generation与卸载防线阻止旧响应更新当前界面；无晚导航。

## 验证证据

| 检查 | 实际命令 | 环境与结果 |
|---|---|---|
| 全量admin测试 | `npm run test -w @small-city-basketball/admin` | 本分支未提交工作区，13文件112项通过；原89项及新增23项均保留 |
| 严格类型 | `npm run typecheck -w @small-city-basketball/admin` | TypeScript严格模式通过 |
| 构建 | `npm run build -w @small-city-basketball/admin` | Vite8.3.5构建通过 |
| 格式 | `prettier --check apps/admin/src/scoring apps/admin/src/api/scoring.ts apps/admin/src/App.tsx` | 全部通过 |
| 差异 | `git diff --check`、暂存后`git diff --cached --check` | 无空白错误；仅指定UI源及交接文件 |

新增检查覆盖ack前不加分／重复点击、失ack原收据恢复、404原包重试与版本阻断、断网、10秒续约及失败、同版本新serverTime、卸载晚响应、机构切换晚读取、规则必填／取消／锁定、只读capabilities、确认V5→V6过期、加时平局阻止确认、有效统计修正、分页后页失败、503不退Mock。初轮确认组件测试的fake timer安装顺序错误已修正，最终全量通过。独立只读审阅指出生命周期事件标签使用过去式与API类型不一致，已对齐实际PREPARE_MATCH等键；STAT_RECORDED／STAT_VOIDED保持。

## 接续与边界

- root第一步仅cherry-pick本UI源提交（不重复合同），执行真实PG/API浏览器及1440／390布局检查。root已维护真实E2E和旧排赛状态／入口文案，不在本分支修改。
- 本地尚未执行真实API／PG／浏览器、CI或生产验证，不能将组件模拟当作真实业务验收；没有生产环境、付费服务、公开观赛、正式榜单、可靠离线队列或OBS能力。
- 本UI不涉及Migration编写／执行。待核对命令内存会随页面销毁丢失，界面已明确提示；重新进入以权威快照、事件和收据核对。
- 交付源commit见Git本提交及root消息；未push，尚未PR／MAIN整合。提交后工作区仅保留未跟踪node_modules软链接。

## 原生表单与自动审查修复检查点

2026-10-22T15:50:30+08:00：root报告CI39742003544的既有检查通过，新增记分浏览器流程在“平局处理”精确label选择处超时；本分支未将该报告当成本地浏览器通过。原生嵌套label会混入select选项文本，本delta为全部8个P05 select显式提供aria-label，并为3个理由textarea提供稳定名称。新增精确getByLabelText、combobox可访问名称和选项／模式变化回归，不放宽E2E匹配。

自动CodeReview comments 4345763932、4345763952由root裁定有效：移除MatchCard无条件赛事规则链接，保留本场工作台入口，避免仅场次授权者被导向无权赛事资料；替换统计选择原记录时同步原球队、数值、项目及节次，切换目标或重新进入替换方式重新同步，用户仍可明确修改球队。回归覆盖客队原记录、显式改主队、切换主队犯规目标、模式切换后恢复原值，界面展示保留的原项目／节次。

实际复跑 `npm run test -w @small-city-basketball/admin -- src/scoring/ScoringPages.test.tsx`：单文件13项通过（本delta新增5项）；admin strict typecheck、5个修改源文件的Prettier check和差异检查通过。按root要求未重复全量已通过检查、不改root/E2E/远端；原生Chromium与第二轮CI由root接续。此delta尚未MAIN，无Migration或生产操作。
