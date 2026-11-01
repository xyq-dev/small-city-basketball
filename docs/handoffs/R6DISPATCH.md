# R6DISPATCH 接续

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
