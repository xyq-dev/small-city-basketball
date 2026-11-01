# R6DISPATCH：跨城派单实现

状态：REVIEW；integration：BRANCH_ONLY。负责人：`/root/implement_dispatch`；2026-11-01 Asia/Shanghai。

基线：`c61ab3667c9d3f756244a28046b9ee2395ccac00`；目录 `/workspace/scratch/aad368826b09/scb-six-dispatch`；分支 `work/r6-dispatch`；开工工作区干净，origin 为目标 GitHub 仓库。

允许：派单领域/持久服务/控制器、独立契约、045迁移、小程序派单页面与测试、本任务交接。共享入口、源订单事务和048共享日历整合由root负责。旧迁移、生产、真实资金/外发、外部凭据均禁止修改。

目标：双侧许可、有限邀请批次、报价审核、客户确认、单赢家/共享档期锁、同事务源订单转换、差旅保护、撤回过期、幂等恢复及角色UI。

计划验证：领域/权限/状态单测、小程序VM、API类型检查；真实PG并发和HTTP集成测试编写交隔离CI。当前未执行测试或迁移，未推送/合并。

### Slice 1 — 2026-11-01

- Added strict contracts/domain, durable dispatch service/controller, migration 045 and independent travel-review/quote-hold state machine.
- API typecheck passed. Focused `../../node_modules/.bin/vitest run src/dispatch-domain.test.ts` passed **21/21**.
- PostgreSQL/migration execution not available locally. Source hook remains injected and fail-closed until root wires `LocalServicesService.createDispatchBookingInTransaction`.
- Next: native workflow/recovery, PostgreSQL lifecycle/concurrency tests, root shared registration/048/least-privilege grants.

### Slice 2 — native workflow and real-PG test specification

- Added `/pages/dispatch/index` and strict client repository: customer scope/budget/request controls; actual provider quote; independent travel evidence review; single-person hold; customer current-hash/fee consent; source reservation/payment links; opt-in preferences.
- Unknown writes persist the original actor-scoped command; refresh, receipt miss and retry retain the same content/UUID. Session changes scrub route/quote/forms and invalidate late results.
- Invitation expiry/withdrawal/supply revocation remove exact route details from provider/reviewer views. Confirm capability checks hold deadline; source-conversion-disabled remains fail-closed.
- Native functional/template tests passed **7/7**, API typecheck passed. Added **9** real-PostgreSQL lifecycle tests (disabled default, independent approval, concurrent replay/single hold, calendar conflicts, source rollback guard, true source conversion, supply revocation, bounded/manual fallback and deadline release). **Not executed locally**: no PostgreSQL service/TEST_DATABASE_URL. Real source test calls the shared canonical transaction method; no fake local-bookings insert or skipped success.
- Shared page registration, routes and HTTP allowlist delegated to matching agent/root; canonical source method delegated to map agent/root. Tests currently use an explicit structural source-method type while baseline class awaits that shared integration commit.

### Slice 3 — final boundaries and recovery evidence

- Moved all regional eligibility, current availability and base-fee ceilings into SQL before the batch limit; distinct real people are selected after scope checks, preventing the former pre-filter scan cap from falsely reporting no supply.
- Tightened 045: one invitation per person per request, immutable quote hash/independent travel approval/deadline, finite bounded travel holds, and source-link consistency for converted offers/holds. Shared quarantine must retain converted facts and release only ACTIVE holds.
- Added `scripts/r6-recovery-dispatch.mjs`: runtime services create real ACCEPTED_HELD and converted+CONFIRMED canonical-source examples; all seven new tables are nonempty; saved output contains references and hashes. Restart checks exact state; quarantine checks permissions off, no new batch/person, immutable quote/receipt/evidence retained, holds/resources released, converted source retained with existing X12 cancellation.
- Rechecked API typecheck, native **7/7**, and recovery-script syntax successfully. Recovery runtime/PostgreSQL tests remain unexecuted locally; root runs combined isolated CI.
- Source bridge review sent to map agent: cap canonical pending-acceptance deadline to dispatch departure time as well as the ordinary service deadline.

### Lifecycle follow-up and independent review

- Added `onModuleDestroy()` to stop dispatch timer during Nest shutdown before pool closure; API typecheck passed.
- Completed requested read-only ADS review; three concrete P1 findings with suggested tests are recorded in `docs/handoffs/R6DISPATCH_ADS_REVIEW.md` and sent to root/ADS owner. No ADS code modified.

### Isolated CI 150 follow-up — reservation owner constraint

- CI 150 exposed a migration error: PostgreSQL names 029's cross-column finite end-time check `local_resource_reservations_check`, and the booking/matchup owner XOR `local_resource_reservations_check1`. 045 had dropped the former, so dispatch-only holds still failed the old owner XOR.
- Corrected 045 to replace only `_check1`. The existing finite ordered time bounds and the new exactly-one-of-booking/matchup/dispatch constraint both remain enforced. 001–042 and shared calendar triggers are untouched.
- Extended the existing real PostgreSQL acceptance case with invalid infinite-end, zero-owner and multiple-owner inserts. Local API typecheck and focused formatting passed; PostgreSQL execution remains delegated to the next isolated CI run.

### Isolated CI 151 follow-up — distinguish stale version from ended invitation

- Root reported that the reservation correction passed real PostgreSQL acceptance, including the new negative constraints; eight dispatch cases passed and one fixture still expected `DISPATCH_EXPIRED` while sending its pre-acceptance offer version after cancellation.
- The cancelled-offer test now verifies two separate gates: the stale original version must produce `VERSION_CONFLICT`; a new command with the freshly read ended-offer version must produce `DISPATCH_EXPIRED`. Application behavior is unchanged, and no broad alternate-error acceptance was added. Local API typecheck, focused formatting and diff checks passed; next combined CI provides PostgreSQL execution evidence.

2026-11-01 root整合检查点：本卡源码已纳入feat/remaining-six及PR #35。CI152已完成该次候选的新域真实PG阶段；后续补课/广告真实退款/runtime等增量纳入下一轮，当前HEAD整套验收仍待完成。子任务上文“LOCAL_ONLY/尚未执行”保留为历史时点，当前统一依据为REMAINING6验收文档。保险真实供应商、真实商户及真机边界不因此变更。
### PR35 review follow-up — fair bounded worker queues

- Fixed source-sync starvation: each tick selects up to 20 due invitation/quote deadlines and a separate maximum of 20 source checks. Invitation priority uses the actual batch, request and held-quote deadlines. Ongoing source bookings can no longer consume the invitation quota.
- 045 adds nullable finite `dispatch_requests.next_source_check_at` and a partial due index. Every source check, including unchanged state, schedules the next check 60 seconds later; ordering by the prior deadline fairly reaches later sources. Terminal sources leave the queue. The existing request history guard permits the new scheduling column with its required version increment. Root owns adding this column to the runtime UPDATE ACL manifest.
- Row status and source deadline are rechecked under the existing organization/calendar/request locks, so independent workers cannot repeat a just-completed check. Closing the worker permanently stops future ticks and prevents a queued tick from beginning further work after shutdown.
- Added a real PostgreSQL regression with 21 actual canonical source bookings (only their dispatch scheduling envelopes are SQL-synthetic), a later due invitation, an actual accepted quote expiring, source rotation, and concurrent worker terminal reconciliation. Added two worker lifecycle unit tests. API typecheck, focused formatting and all 23 dispatch domain/worker unit tests passed; the expanded PG suite awaits isolated CI, not executed locally.

### PR35 review follow-up — training calendars before invitation LIMIT

- Baseline `87a8bcbe869b93844805143ef33b85c1a1b9e221`, branch `work/r6-dispatch-training`, isolated checkout `scb-six-dispatch-training`; root remains integrator. Read-only review thread `PRRT_kwDOVTBG086yXCae` identified that training conflicts were deferred until ACCEPT, allowing busy people to consume the finite invitation batches.
- Added the shared adult coach/learner calendar exclusion before `DISTINCT ON` and `LIMIT`: same person key, active reservation, half-open overlap against service time plus its existing 30-minute protection. Released reservations and only genuinely expired HOLDING enrollments are excluded from blocking; CONFIRMED duties remain blocking even after their former hold deadline. No new schema, ACL, role, API or external side effect.
- Added two real PostgreSQL regressions with 12 explicitly authorized, reviewed providers ordered by UUID. The first nine have real coach or learner reservations; the later three are an expired HOLDING learner, a genuinely released reservation, and a non-overlapping boundary reservation. Both cases require the first batch to invite all three later valid people and none of the nine busy people. Training, publication, consent, enrollment, confirmation and cancellation/leave use production services; only historical hold timestamps are synthesized.
- API typecheck, focused formatting, diff checks and 23 dispatch domain/worker unit tests passed. PostgreSQL execution remains pending isolated CI; no local PostgreSQL is available.
