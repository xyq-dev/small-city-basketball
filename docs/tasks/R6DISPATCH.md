# R6DISPATCH：跨城派单实现

状态：IN_PROGRESS；integration：LOCAL_ONLY。负责人：`/root/implement_dispatch`；2026-11-01 Asia/Shanghai。

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
