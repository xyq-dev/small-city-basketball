# C04 UI交接

2026-10-23（Asia/Shanghai），c04_ui；REVIEW / LOCAL_ONLY。独立工作树/workspace/scratch/dc6a786e1a31/c04-ui，分支feat/C04-ui，基线4b489973ce3937f860d4053130e8abe6e598c275。远端原仓库。只修改本任务允许路径；未commit；原node_modules symlink保留并不纳入源码。

## 已实现

原排赛支持SE_SEEDED_V1首轮生成/严格响应校验/多个轮空提示；原分配、冲突校验及初次发布流程复用。新的EventKnockoutPage导出路径knockout/KnockoutPage，以实际服务capabilities控制发布，展示真实签位/轮空/确认/晋级与最终名次（未完成不虚构冠军）。nextRound填写全量场地和中国标准时间，4–500 Unicode码点原因，显式二次核对具体对阵/场地/时间/原因；固定所见eventVersion+sourceHash，任意409阻止重放，关闭后显式刷新，保留输入和原因。切机构/事件重挂组件，late responses不覆盖新上下文。

公开event按format分派（缺format兼容RR）；KO允许rules=null并读取public knockout，不请求RR standings。公开bracket严格精确白名单，拒绝seed/internal IDs/roster/control及嵌套未知字段；始终credentials=omit。公开匹配与既有比分/计时/导出复用；KO导出只含当前正式已发布场次，轮空和未发布签位不造比赛。私有KO排名页只提供晋级入口和原公开授权管理，不显示假RR积分表单。KO记分规则强制OVERTIME并要求明确加时时长；工作台解释下游发布后的源赛果不能重开。

新CSS按窄屏单列、长队名换行，不改原整体架构。真实手机浏览器/桌面/HTTPS/PG由root隔离CI执行，本机JSdom不等于真实浏览器。

## 验证

admin完整tsc --noEmit通过；admin全量Vitest 39文件/363测试全部通过（基线347，净增16），包含旧RR、反向权限、来源409、保留输入/显式刷新、跨机构迟到响应、公开白名单、SE规则和公开format分派。admin vite build成功，有原大入口chunk>500k提示，未为此扩重构；git diff --check通过。最后补充发布确认框具体安排展示后，admin typecheck及KnockoutPage 4项再次通过，root仍需整合后的完整检查。

## 集成入口与selector

root负责App路由/events/:eventId/knockout→EventKnockoutPage({context})。private region淘汰赛签位、淘汰赛最终名次；public第二tab晋级与名次，region公开淘汰赛签位、公开最终名次。下一轮select/input为第N轮第P场 场地/开始时间，textarea晋级发布原因；首按钮核对并发布下一轮，modal发布下一轮，最终按钮确认发布下一轮。原有单淘汰unsupported测试按真实开放范围改成GROUP_KNOCKOUT仍unsupported，并新增KO页面不显示RR积分回归。公开URL迟到响应测试先只读event确定赛制，原迟到拒绝断言保持，读取取消后不继续launch子请求。

## 允许集成的源文件

- apps/admin/src/api/knockout.test.ts
- apps/admin/src/api/knockout.ts
- apps/admin/src/api/scheduling.ts
- apps/admin/src/api/viewing.ts
- apps/admin/src/knockout/Bracket.tsx
- apps/admin/src/knockout/KnockoutPage.test.tsx
- apps/admin/src/knockout/KnockoutPage.tsx
- apps/admin/src/knockout/PublicKnockout.test.tsx
- apps/admin/src/knockout/knockout.css
- apps/admin/src/knockout/test-fixtures.ts
- apps/admin/src/scheduling/PolicyForm.tsx
- apps/admin/src/scheduling/ScheduleEditor.tsx
- apps/admin/src/scheduling/SchedulePages.tsx
- apps/admin/src/scheduling/SchedulingPages.test.tsx
- apps/admin/src/scoring/Management.tsx
- apps/admin/src/scoring/ScoringPages.test.tsx
- apps/admin/src/scoring/Workbench.tsx
- apps/admin/src/viewing/PrivatePages.test.tsx
- apps/admin/src/viewing/PrivatePages.tsx
- apps/admin/src/viewing/PublicExports.tsx
- apps/admin/src/viewing/PublicPages.test.tsx
- apps/admin/src/viewing/PublicPages.tsx
- apps/admin/src/viewing/exports.ts

不复制node_modules、dist或其他生成文件。没有生产操作、新凭据、付费资源、原生OBS/真机测试或发布声明。
