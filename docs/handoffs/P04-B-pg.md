# P04-B 独立 PostgreSQL 回归交接

2026-10-23（Asia/Shanghai），`/root/p04b_pg_tests`。**REVIEW / LOCAL_ONLY**；尚无真实PG运行结果，不标DONE。

工作树`/workspace/scratch/dc6a786e1a31/p04b-tests`，分支`test/P04-B-postgres`，起点`23a49cc5d632f9c15d4607bc7acc6145ce4ccf68`且clean。共享DTO `0eb318c`已按root要求cherry-pick为`2f7902f`。没有修改既有实现、旧测试/support、Migration、CI或汇总文档。4张未物化概念PNG的skip-worktree保持，未触碰。

新增且仅新增：

- `apps/api/test/p04-rescheduling.integration.test.ts`：20项真实HTTP/PG契约。
- `apps/api/test/p04-rescheduling-resources.integration.test.ts`：5项真实资源及计分锁竞争。
- `apps/api/test/p04-rescheduling-support.ts`：复用已有harness的专用夹具、快照、实际预约检查与受限审计故障。

25项覆盖：当前计划/两版本/三预约/audit与不可变原发布；连续改期使用最新安排；同Court名称快照/无变化拒绝；最近20条及截断；严格输入、原窗口/日期/停用及外机构Court；内部Court/Team、半开相邻/30分钟休息/上海日历日期间隔；实际赛事role与撤权/跨机构/Origin；CAS并发仅一胜；状态边界及实际LIVE→待确认→FINAL→重开拒绝；已有START历史即使被标READY仍拒绝；READY原始时钟、比分/规则、流水、receipt、lease不变，旧版本新commandId拒绝、已接受PREPARE receipt可核对、新版本能继续START；audit失败全回滚；直接SQL孤立proof和漏Team预约在INSERT/UPDATE成功后真实COMMIT被deferred guard拒绝；无本事务proof改计划/预约、删除预约或改/删历史拒绝；公开ID/Overlay授权保持而当前时间/版本更新，两类旧schedule cursor失效；跨event不可读冲突不泄密、canonical Team不同Court并发、改期vs新publish、Court停用及PREPARE/START双队列顺序。

已只读核对API/007提交`857e32a3532188610558a40215abaec8c2c82b03`的实际列、触发器及状态/错误合同。SQL完整性测试使用该真实`match_reschedules`列及`pg_current_xact_id()`默认值，显式BEGIN并要求INSERT/UPDATE成功后COMMIT实际失败，避免把早期语法/输入拒绝误写为deferred验收。所有固定SQL标识符或故障函数名来自源码/本地randomUUID；仅合成scb_test_*库可执行，原support在建连接前做限制。

本地实际：API完整`tsc --noEmit`已通过；新增三文件Prettier及`git diff --check`通过。测试环境没有PostgreSQL/Docker，**未执行25项PG、未执行007、未执行浏览器**；不得将编写/静态通过写成真实数据库通过。预计由root把本commit三文件和本交接整合到完整API/007候选，在既有独立GitHub Actions执行并记录确切run/job/source；root另负责40表重启/完整隔离恢复和真实API浏览器。

允许本地commit，未push/PR/merge，未修改生产/新凭据/付费/公网；下一位先核验实际Git与root候选源码，再运行规定真实隔离PG，不创建Mock替代。
