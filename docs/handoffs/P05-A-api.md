# P05-A API handoff

- Owner: API agent, branch `feat/P05-scoring-api`, base `fd25051`.
- Scope: contracts, scoring domain/service/controller, migration 004, this handoff.
- Contracts: committed `592a2e5`; root integrated as `9f3dc4c`. Unified MATCH_STATUSES, explicit scoring rules, match staff, lease control, commands, receipts and private snapshots.
- Implementation in progress. Domain and migration delegated on nonoverlapping owned files. Root owns app.ts wiring.
- Additional reads: GET scoring-events and result-confirmations under the match scope, ascending paginated sequence/source version. PUT staff returns workbench; PUT rules returns event scoring. Unprepared snapshot is 409 MATCH_NOT_PREPARED; workbench snapshot is null.
- Clock remainingMs is the stored anchor remaining value. UI derives effective time using serverTime and anchorServerTime; running does not automatically become paused at zero.
- No database migration executed locally. Real PG, restart, and browser acceptance remain root CI gates. No offline queue, rankings, public spectator or OBS implemented.

## Implementation checkpoint

- Added `ScoringService`, `ScoringController` and `SCB_SCORING_SERVICE`; root registers them with the same pool/options as existing services. Existing services and app wiring were not changed here.
- Migration 004 adds `scoring_rulesets`, `match_staff`, `scoring_states`, `scoring_leases`, `scoring_commands`, `scoring_events`, `result_confirmations`. It preserves P04 fixed plan facts, uses tenant-scoped foreign keys, immutable history guards, monotonic lease fences and deferred match/projection version equality.
- Every command rechecks current resource/action authorization before receipt lookup. Successful retries return original appliedVersion and current snapshot without another business write. New commands require CAS and current lease where applicable. Confirmation locks sorted canonical Teams before the negative active leader-grant check, retains historical scorer exclusions, and compares event replay against stored totals.
- Confirmation sourceMatchVersion/lastEventSeq refer to the snapshot reviewed before the confirmation command; the confirmation lifecycle event and receipt appliedVersion are separate. Reopening preserves old confirmation records and requires explicit reconfirmation.
- Additional reads are ascending, default 20/max 100; cursor scope includes organization, actor, match and resource type. Match discovery filters authorization in SQL before pagination and additionally scopes event/status filters.
- Stable errors: locked rules `409 SCORING_RULES_LOCKED`; missing valid scorer `409 SCORER_REQUIRED`; CAS `409 VERSION_CONFLICT`; control `409 LEASE_CONFLICT`; changed reuse `409 IDEMPOTENCY_CONFLICT`; unsupported current command state `409 INVALID_MATCH_STATE`; locked-rule violations `422 RULE_CONFLICT`; invalid/cross-match stat target `422 INVALID_STAT_TARGET`; consumed stat target `409 INVALID_MATCH_STATE`; absent receipt `404 COMMAND_NOT_FOUND`.
- Local validation: API typecheck and build passed; all 87 API source tests passed (69 baseline, 15 scoring domain, 3 scoring HTTP transport). The transport tests isolate controller/validation behavior; they do not claim database authorization/concurrency validation.
- Not executed: migration 004, real PostgreSQL integration/restart, full app wiring and browser tests. These remain root's integration gates. No production migration, deployment or external OBS service was performed.

## Review correction: revoke a previously disabled member

2026-10-22 (Asia/Shanghai), source base `545f76d`. Automatic code review finding `4345763942` correctly identified that unconditional target membership/user activity checks prevented an administrator from disabling an existing match assignment after organization membership had already been disabled.

`updateMatchStaff` now retains the target user/membership SHARE locks before Event/Match locks, requires active membership/user for ACTIVE creation or activation, and permits DISABLED only for an existing assignment in this organization and match. DISABLED uses UPDATE, never inserts a placeholder assignment. Unknown, foreign, or never assigned targets remain 404 RESOURCE_NOT_FOUND. Current manager authorization, match CAS, staff/lease locks, lease invalidation, projection version synchronization and audit remain in the same transaction. DTO and success status are unchanged.

The independent PG owner will add real membership-first revocation regression coverage; no PostgreSQL execution or migration change is performed in this correction worktree. Local checks for this delta are recorded after execution below.

The same correction retains the normalized target UUID returned by resourceId, so uppercase UUID paths match the existing assignment and lease holder consistently. Local API typecheck/build, 87 source tests and formatting/diff checks passed for the revoke delta; the final normalization line was additionally typechecked. Real PG regression remains assigned to the independent PG agent.
