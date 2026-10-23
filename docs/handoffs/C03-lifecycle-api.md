# C03 lifecycle API handoff

2026-10-23T06:20:30Z; owner `/root/c03_lifecycle_review`; REVIEW / LOCAL_ONLY.

Worktree `/workspace/scratch/dc6a786e1a31/c03-lifecycle-api`, branch
`feat/C03-lifecycle-api`, baseline `909fb74fcc702baded0d70ce5c6cde6d5a7ddddd`;
origin `https://github.com/xyq-dev/small-city-basketball.git`. Initial dirty file
`packages/contracts/index.d.ts` is the root-owned frozen contract dependency mirror.
It is not part of this agent's delivery. AGENTS, CURRENT_STATUS, TASKS,
COLLABORATION and root's C03 task card were read before implementation.

Scope: event lifecycle domain/service/controller, standings LIVE/HISTORY grant
guards, scoring closed-event guards, migration 010 and direct tests. Root owns
app wiring, contracts, runtime manifest, shared scripts and status documentation.
No Git mutations or production operations are performed by this agent.

## Implemented and frozen

- `apps/api/src/event-lifecycle-domain.ts`: explicit COMPLETE/ARCHIVE/REOPEN
  transitions, 4–500 character reason, active/closed status guards, purpose-bound
  public access and completion readiness derived from current confirmed results.
- `apps/api/src/event-lifecycle-service.ts`: lifecycle read and command methods;
  inherited same-transaction helpers with actor → organization → event lock order.
  Event UPDATE serialization precedes result proof reads. No scheduling mutex,
  nested transaction, duplicate score, clock or ranking storage. COMPLETE and
  REOPEN atomically revoke active public grants; ARCHIVE retains explicitly issued
  HISTORY grants. Each mutation advances Event CAS and writes an audit reason.
- `apps/api/src/event-lifecycle-controller.ts`: exports EventLifecycleController,
  EventLifecycleService injection token `SCB_EVENT_LIFECYCLE_SERVICE`; GET lifecycle
  and POST lifecycle-commands under the existing event prefix. Root wires app.ts.
- `apps/api/src/standings-service.ts`: protected helper reuse, immutable LIVE or
  explicit HISTORY publication purpose, matching event status on every public
  read, C02 personal proof validation for history issuance/read. DISABLE remains
  available without validating damaged result projections. Closed ranking rule
  writes are blocked and capabilities agree with command guards.
- `apps/api/src/scoring-service.ts`: active-event guard after action permission
  and before idempotent command receipt replay, plus acquire/renew guards and
  closed capabilities. Dedicated read routes, lease release and staff management
  remain available. No OBS implementation change.
- `apps/api/migrations/010_c03_event_history.sql`: only adds constrained purpose
  LIVE/HISTORY default LIVE to public_event_publications. The existing generic
  JSON comparison trigger automatically makes this new column immutable after
  INSERT. No changes to 001–009 and no new table.
- `apps/api/src/event-lifecycle-domain.test.ts`: 6 source tests for exact command
  schema, every status transition, public purpose/state matrix, deterministic
  source hash, formal/pending source gates and stale/C02 invalid proof.
- `apps/api/test/c03-lifecycle.integration.test.ts`: 10 real PostgreSQL cases
  written for isolated CI. Covers completion prerequisites, org and actual event
  permission boundaries, old keys permanently revoked on all public read routes
  across reopen/recomplete/new HISTORY, archive write denial for all 14 scoring
  command types and existing receipt replay, lease acquire/renew denial with
  release/access revocation allowed, existing registration/scheduling/reschedule
  denial, damaged C02 source gate and safe public revocation/reopening, real
  event-lock waits behind CONFIRM_RESULT and REOPEN_RESULT, concurrent CAS and
  audit-failure atomic rollback, OBS independence, and purpose immutability.

The shared `apps/api/src/confirmed-player-statistics.ts` is copied only as a local
dependency mirror from the summary author's worktree. Root must take that file
from its owner, not this delivery. `packages/contracts/index.d.ts` likewise stays
root-owned. Do not include either mirror in this agent's allowlist.

## Executed checks

- `npm run test --workspace @small-city-basketball/api -- event-lifecycle-domain.test.ts`
  actually selects all `src` tests via the existing npm script: **22 files / 285
  tests passed**. This is local source/HTTP-transport coverage, not PostgreSQL.
- `npm run typecheck --workspace @small-city-basketball/api`: passed, including the
  new PostgreSQL test TypeScript. An initial test typecheck caught incorrect OBS
  DTO member names; corrected to existing currentGrant/credential and rerun passed.
- `npm run build --workspace @small-city-basketball/api`: passed.
- `npx vitest run src/event-lifecycle-domain.test.ts` in apps/api after final reason
  freeze: **1 file / 6 tests passed**.
- `npx prettier --check` for the six owned source files, PG test and this handoff:
  passed before final handoff additions; handoff formatted again afterward.
- `git diff --check`: passed.

## Not executed and next step

Real PostgreSQL/Docker are unavailable in this local environment as verified by
root. The 10 new database cases are **written, not run**. Migration 010 is
**written, not executed here**. Root must integrate its app.ts and runtime INSERT
column manifest changes, then run the real isolated PostgreSQL suite/role checks,
strict project checks, browser/HTTPS and recovery checks in the existing CI.
No Mock result is recorded as database or production evidence. Browser/OBS client
checks are not part of this agent's evidence; actual OBS remains deferred.

Git remains at the baseline above with local uncommitted owned changes. No commit,
push, production operation, account maintenance, secret, paid resource or public
port was created. Root's first continuation: copy exactly the eight owned code/
test/migration files listed above and this handoff, excluding both dependency
mirrors, then run integration checks with its app wiring.
