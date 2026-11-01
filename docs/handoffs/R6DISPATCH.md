# R6DISPATCH 接续

当前摘要（2026-11-01 14:08 Asia/Shanghai）：**DONE / MAIN（源码与约定隔离验收）**。PR #35 已合入代码基线 `21dc0e6debfaab1358ce2e1eb7abdb754134e1b2`，tree 与CI160测试候选精确一致；三个CI作业全部SUCCESS、原始日志已核验，12条审查全部已解决。正式外部渠道、微信与真机及生产不在本次验收内。详细证据见 [REMAINING6](../tasks/REMAINING6.md)。

## 历史实施与验证记录

以下保留各切片当时的 `LOCAL_ONLY`、`IN_PROGRESS`、测试结果、失败及修复；“当前”“待接线”等字样仅指该记录时点，不代表上方候选状态。

2026-11-01 Asia/Shanghai；IN_PROGRESS / LOCAL_ONLY。独立分支 `work/r6-dispatch`，基线 `c61ab3667c9d3f756244a28046b9ee2395ccac00`。

已读取当前设计、AGENTS、协作规范与X12原源预约、共享日历/资源排斥。root负责源预约事务提取与统一048日历扩展；本卡仅追加045派单模型与独立业务消费者。

当前没有PG/Docker执行通道，PG与migration仅编写后交隔离CI；不得把此记录作为测试通过证据。后续切片在本卡与任务文档记录真实命令、结果和本地提交，由root负责同步GitHub。

Slice 1 API typecheck and 21 focused domain tests passed. Broader API invocation included existing readiness tests, which require the root's combined contiguous migration/privilege snapshot update and are not green in this isolated 045 worktree. No PostgreSQL migration execution or CI pass claimed.

Hook: `DispatchOptions.createLocalBooking(c, actor, input: DispatchSourceInput)` returns `{resourceId,version}`. Root implementation will be `LocalServicesService.createDispatchBookingInTransaction`. It must validate persisted ACCEPTED_HELD offer/hash/merchant/terms, use the same transaction, and create source reservation spanning quote `protectedStartsAt` to `protectedEndsAt`; service verifies this and rolls back if missing. Full precise columns and quote shape are exported in `dispatch-service.ts` and `dispatch.d.ts`.

Native page: `pages/dispatch/index`; helper `utils/dispatch.js`. GET allowlist: `/v1/dispatch`, `/v1/dispatch/capabilities`, `/v1/dispatch/requests/:id`, `/v1/dispatch/offers/:id`, `/v1/dispatch/receipts/:id`. POST: `/v1/dispatch/preferences`, `/v1/dispatch/requests`, `/v1/dispatch/requests/:id/commands`, `/v1/dispatch/offers/:id/commands`. Shared `ui.routes.dispatch`, app registration and Local/account entries are assigned to matching agent.

Focused client tests 7/7 and API typecheck passed. Real PG integration file contains 9 cases; not run without isolated PG. The source bridge must be available as `LocalServicesService.createDispatchBookingInTransaction` (map agent commit 82836ff) before the true-source integration test can pass. Source default is disabled when no injected hook; paid paths additionally require root TradeService snapshot wiring and configured real charge handling.

Initial broad `vitest run src dispatch-domain` result: 1176 passed / 3 readiness failures, all three due to absent 043/044 in this isolated 045 worktree. Do not label full CI passing until combined migration/grants/native registration and isolated PG tests pass.

Final local hardening adds no new table/function names. 045 now freezes quote_hash, travel_verified_by/at and hold_expires_at after first assignment; source-linked CONVERTED offer/hold states must remain CONVERTED. Scope+service-calendar+base-fee eligibility occurs before SQL LIMIT. Parent 048 still owns shared expiration/calendar functions.

Recovery module exports `captureR6Dispatch(context)` → `{proof}` and `verifyR6Dispatch({readPool,saved,quarantined})`. Context additionally requires `registerSynthetic(label)` and `createLocalSource(label,{book:false})` returning an approved personnel listing/slot with `{provider:{id,cookie},region,listingId,slotId,startsAt,endsAt,address}`. Actual runtime services—not manual local_bookings inserts—perform both source flows. Helpers need at least three hours before service starts and nonoverlapping source windows. Prefer capturing dispatch late so its real 10-minute hold remains current during remaining capture work. Verify accepts saved wrapper or raw proof. No external I/O or real payment is issued.

# CI 150 reservation constraint correction

2026-11-01 UTC. Root reported five dispatch and two shared-calendar PostgreSQL failures at the dispatch reservation insert. The old owner XOR was still present: 029's cross-column `ends_at` condition gets PostgreSQL name `local_resource_reservations_check`, while the owner XOR gets `_check1`. 045 now drops `_check1` only, preserving finite interval enforcement and replacing owner XOR with exactly one booking/matchup/dispatch owner. Added real-PG negative checks for infinite bounds, no owner and multiple owners alongside successful dispatch acceptance. No old migration or shared trigger changed; API typecheck and focused formatting passed; local PG unavailable and execution remains pending isolated CI.

CI 151 follow-up: root confirmed the constraint correction and its negative cases passed, with eight dispatch cases passing. The remaining cancellation fixture reused a pre-acceptance offer version and correctly received `VERSION_CONFLICT`. The test now asserts that exact stale-version result, then retries using a different command ID and freshly read current version to separately assert `DISPATCH_EXPIRED`. No production service change or relaxed error matching. Local API typecheck, focused formatting and diff checks passed; real PostgreSQL rerun remains in combined CI.

PR35 review thread `PRRT_kwDOVTBG086yW7tm`: worker fairness corrected using separate bounded invitation/source queues (20 each), an explicit persisted 60-second `next_source_check_at` deadline, lock-time status/deadline rechecks, terminal exclusion, and permanent close protection. 045 adds one nullable finite timestamp and its partial index; root must add `next_source_check_at` to runtime dispatch_requests UPDATE columns. No new table, function or route. Recovery quarantine preserves this timestamp, so existing full/identity hashes continue covering it without weakening immutable proof. Local API typecheck and 23 unit tests passed; one new real-PG case uses 21 canonical bookings, actual held quote expiry, later invitation progress, source rotation and concurrent workers. PG execution remains pending root CI. Map agent independently reviewed scheduling and restore compatibility; no significant blocker found, with shutdown checkpoints incorporated.

PR35 thread `PRRT_kwDOVTBG086yXCae`, baseline root `87a8bcb`: new branch `work/r6-dispatch-training` in `scb-six-dispatch-training` adds training calendar exclusion before the three-person candidate LIMIT. The predicate matches shared 048 person/active/half-open interval semantics and excludes only expired HOLDING learner reservations from blocking; it keeps confirmed duties, includes coach holds with no enrollment, and applies no second training buffer. Runtime already has SELECT permission on the two referenced training tables; no migration or ACL additions. New PG file `r6-dispatch-training.integration.test.ts` drives real services for both coach and learner cases: nine earlier conflicting providers, then expired/released/non-overlapping controls that must all be invited in the first batch. Local typecheck and 23 domain/worker tests passed; PG awaits root CI. No external messages, credentials, production database or remote writes performed by this task.

2026-11-01 管理端续作（未提交）：`fix/ui002-ci` 工作树新增 `/dispatch`。读取 `GET /v1/dispatch`，页面写明这是当前登录账号发出的需求和收到的邀请，不是当前机构全部派单。按 `canManage`、`canConfirm`、`canQuote`、`canReviewTravel`、`canAccept`、`canWithdraw` 提交原命令。后打开的详情作废先发出的响应。开关关闭时不发送。没有新接口或 Migration。管理端单测已覆盖开始邀请、关闭开关、版本冲突、403 和迟到详情；真实 PostgreSQL 与远端 CI 未因本页重跑。

2026-11-01 审查修复：需求详情原先只显示预算，确认按钮却发送 `chargeConsent` 和报价哈希。`DispatchPage.tsx` 现在并列显示预算上限和当前服务方的服务费、交通费、住宿费、平台费用、总额、行程、凭据与条款。同意绑定当前账号、需求、报价和版本；未勾选、重新打开或报价不完整时不发送 `CONFIRM_QUOTE`。交通核验同样先显示行程和凭据。A 的写请求返回时，如果用户已经打开 B 或另一条邀请，只保留 B，不把成功提示或错误写到 B 上。`registration/shared.tsx` 的操作函数在返回 `false` 时不显示成功提示，供这个过期结果使用。回归覆盖预算与报价不同、未确认不发送、重新打开后旧同意失效、延迟请求不能覆盖后打开的邀请，以及核验前能看到凭据。真实 PostgreSQL 与远端 CI 未跑。后端契约未改。

2026-11-01 CI 后续：写操作开始时记下详情代次。刷新请求已经发出后，用户再打开另一条需求，迟到的响应不写回。已打开详情时，列表刷新保留当前页面，不用整页加载盖住新详情。新增回归：A 的刷新等待期间打开 B，放行后页面仍是 B，且不出现 A 的回填地址。管理端 582 项通过。真实 PostgreSQL 未跑。

2026-11-01 打开失败：列表按钮原先在打开请求失败时无条件整页刷新。A 的读取被拒绝时，如果用户已经打开 B，不再刷新，页面保持 B。回归使用可拒绝的 Promise，不使用 sleep。真实 PostgreSQL 未跑。
