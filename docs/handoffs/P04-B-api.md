# P04-B API/DB实施交接

2026-10-23（Asia/Shanghai），负责人`/root/p04b_design_review`。状态为作者本地源码验证通过，等待root真实隔离PG/浏览器/完整恢复及独立review；不是DONE/MAIN。

## 真实现场与允许范围

- worktree：`/workspace/scratch/dc6a786e1a31/p04b-api`；分支`feat/P04-B-api`，开工HEAD`23a49cc5d632f9c15d4607bc7acc6145ce4ccf68`，核验clean。远端原仓库`xyq-dev/small-city-basketball`；没有改建替代架构。
- DTO独立提交`0eb318c29f1a363aee503d165bc92d888ba70f5d`；API/007源码提交`857e32a3532188610558a40215abaec8c2c82b03`。root已接收SHA可串行整合。未自行push/PR/merge。
- 仅写contracts声明、scheduling服务/控制器、新局部domain/源码测试、standings公开分页最小delta、007及本交接。不改UI/PG独立测试/ops/runtime manifest/readiness/根配置及root汇总；原缺失概念PNG的skip-worktree状态未触碰。
- 原授权只沿用开发、本地明确路径commit；生产DB/Migration、生产部署、新凭据、付费和公网禁止；OBS实际验收继续暂缓。

## 变更原因与影响

已有P04-A是一次发布，数据库明确禁止改计划和预约。P04-B增加未开赛单场受控改期，复用published_matches当前事实及现有validateSchedule，不建立第二套比分/计时/名单/赛程状态。发布revision/fixtures/publication/hash保持原快照。

GET单场rescheduling及POST reschedule-commands严格按任务卡DTO。写只允许当前OWNER/ADMIN或本event实际EVENT_MANAGER，当前会话/机构/成员及Origin不放宽。Event SCHEDULED/RUNNING、Match SCHEDULED/READY且无START_MATCH才可改；READY只同步source_version，原clock/统计/流水/receipt/lease/fence及updated_at都不改。无实际court/start变化拒绝。沿用原policy时长/窗口/日期/休息/最小本地日期差，仅目标相关冲突阻止操作。

锁沿context→org mutex→Event UPDATE→Match UPDATE→scoring state/Court稳定顺序。全本event的当前published_matches重建fixtures，替换目标后检查内部关系；外部预约排除本publication，仅返回必要冲突提示。不可变history、当前plan、1 Court/2 Team预约、Event/Match/source版本及audit同事务。audit action为`MATCH_RESCHEDULED`，resource为`match`。

007新增match_reschedules（root另同步第40表manifest），含old/new计划、from/to Event/Match版本、reason、actor、创建时间及xid8。INSERT guard核对精确当前old plan/状态/noSTART及当前事务，match/预约仅允许同xid8精确proof变更；身份替换/DELETE/改写历史禁止，deferred核对完整new plan、三预约及版本。DB只承担关系、完整性、proof及原排他硬门，窗口/休息等策略仍由原应用validator负责，按root明确裁定不复制第二套SQL算法。

私有matches游标scope加Event.version；公开scope只加本event改期历史COUNT，不泄露内部ID。形状、父公开身份和status先在开库前检查；已有Event SHARE锁内核对COUNT，改期前旧游标明确拒绝。

## 作者本地验证

- `npm run typecheck --workspace @small-city-basketball/api`通过。
- `npm run test --workspace @small-city-basketball/api -- --run`：19文件、260项全部通过（原230＋30新增domain/HTTP），最终退出0。
- `npm run build --workspace @small-city-basketball/api`、所改TS的Prettier检查及git diff检查均通过，退出0。
- 首轮typecheck发现unknown Court参数，已改严格类型/UUID解析。首轮源码回归发现旧公开跨父cursor必须在DB前拒绝；已修成前置scope形状检查＋锁内精确版本检查，未删改原回归，最终全部通过。
- HTTP/source测试使用无数据库transport或mock方法，仅证明解析/路由/Origin/固定status/envelope，不冒充真实权限/事务/数据库验收。

## 未执行与接续

007仅已编写，未在本地或生产执行；001–006未修改。本地没有真实PG/Docker。并发、排他、DBtrigger、audit/deferred回滚、READY/旧命令/public/Overlay、重启和完整隔离恢复须由root的独立PG/浏览器/CI验证。root另负责最小权限manifest/readiness/重启40表清单及恢复脚本，不能漏更。

源码review由独立agent进行，最新源SHA已通知；作者验证不等于独立CLEAR。下一条操作：root整合857e32a和独立PG测试，核对最小权限后在隔离CI执行007与既有回归，针对真实失败最小修复；满足任务卡全部证据并PR整合后才标DONE。
