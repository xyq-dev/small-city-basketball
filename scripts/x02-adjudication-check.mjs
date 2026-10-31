import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const uuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const digest = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
function references(saved) {
  for (const k of [
    'orgId',
    'eventId',
    'matchId',
    'rulesId',
    'adjudicationId',
    'proposerId',
    'reviewerId',
    'proposalCommandId',
    'reviewCommandId',
  ])
    assert.ok(uuid(saved?.[k]), `X02 fixture requires an exact ${k} reference`);
  for (const k of ['rulesVersion', 'headVersion', 'requestVersion'])
    assert.ok(Number.isInteger(saved[k]) && saved[k] > 0, `X02 fixture requires a retained ${k}`);
  for (const k of ['rules', 'head', 'request', 'receipts'])
    assert.ok(digest(saved.hashes?.[k]), `X02 fixture requires a retained ${k} digest`);
}
/** Invoke only from the isolated harness immediately after event creation, before registration opens. */
export async function configureX02AdjudicationRules({ call, state, event }) {
  assert.ok(uuid(state?.orgId) && uuid(event?.id) && typeof state.cookie === 'string');
  assert.equal(
    event.status,
    'DRAFT',
    'Exception rules must be configured before registration, never after publication',
  );
  assert.ok(Number.isInteger(event.version) && event.version > 0);
  const commandId = randomUUID();
  const result = (
    await call(`/v1/orgs/${state.orgId}/events/${event.id}/exception-rules`, {
      method: 'PUT',
      cookie: state.cookie,
      body: {
        clientRequestId: commandId,
        expectedEventVersion: event.version,
        expectedVersion: 0,
        forfeitWinPoints: 2,
        forfeitLossPoints: 0,
        cancellationPolicy: 'EXCLUDE_FROM_TABLE',
      },
    })
  ).data;
  assert.ok(uuid(result.rulesId));
  assert.equal(result.version, 1);
  assert.equal(result.eventVersion, event.version + 1);
  return {
    rulesId: result.rulesId,
    rulesVersion: result.version,
    eventVersion: result.eventVersion,
    commandId,
  };
}
async function retained(readPool, saved) {
  const result = await readPool.query(
    `SELECT
  encode(sha256(convert_to(to_jsonb(rules)::text,'UTF8')),'hex') AS rules_hash,
  encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex') AS head_hash,
  encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS request_hash,
  (SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(rc) ORDER BY rc.user_id,rc.client_request_id),'[]'::jsonb)::text,'UTF8')),'hex') FROM match_exception_receipts rc WHERE rc.org_id=$1 AND rc.event_id=$2) AS receipts_hash,
  (SELECT count(*)::int FROM match_exception_receipts rc WHERE rc.org_id=$1 AND rc.event_id=$2) AS receipt_count,
  rules.version AS rules_version,h.version AS head_version,r.version AS request_version,
  h.active_request_id,r.status,r.operation,r.kind,r.forfeiting_side,
  r.proposed_by,r.reviewed_by,r.reviewed_by<>r.proposed_by AS independent,
  ((r.forfeiting_side='HOME' AND r.winner_entry_id=m.away_entry_id AND r.loser_entry_id=m.home_entry_id) OR (r.forfeiting_side='AWAY' AND r.winner_entry_id=m.home_entry_id AND r.loser_entry_id=m.away_entry_id)) AS original_opponents,
  m.status AS match_status,
  (SELECT count(*)::int FROM scoring_events se WHERE se.org_id=m.org_id AND se.match_id=m.id) AS scoring_event_count,
  (SELECT count(*)::int FROM scoring_states ss WHERE ss.org_id=m.org_id AND ss.match_id=m.id) AS scoring_state_count,
  (SELECT count(*)::int FROM result_confirmations cf WHERE cf.org_id=m.org_id AND cf.match_id=m.id) AS confirmation_count
 FROM match_exception_rules rules
 JOIN match_exception_heads h ON h.org_id=rules.org_id AND h.event_id=rules.event_id AND h.match_id=$3
 JOIN match_exception_requests r ON r.org_id=h.org_id AND r.event_id=h.event_id AND r.match_id=h.match_id AND r.id=h.active_request_id
 JOIN published_matches m ON m.org_id=h.org_id AND m.event_id=h.event_id AND m.id=h.match_id
 WHERE rules.org_id=$1 AND rules.event_id=$2 AND rules.id=$4 AND r.id=$5`,
    [saved.orgId, saved.eventId, saved.matchId, saved.rulesId, saved.adjudicationId],
  );
  assert.equal(
    result.rows.length,
    1,
    'X02 rules, historical adjudication and active head must retain their exact original links',
  );
  return result.rows[0];
}
const hashes = (r) => ({
  rules: r.rules_hash,
  head: r.head_hash,
  request: r.request_hash,
  receipts: r.receipts_hash,
});
function decision(r, saved) {
  assert.equal(r.rules_version, saved.rulesVersion);
  assert.equal(r.head_version, saved.headVersion);
  assert.equal(r.request_version, saved.requestVersion);
  assert.equal(r.active_request_id, saved.adjudicationId);
  assert.equal(r.status, 'APPROVED');
  assert.equal(r.operation, 'DECLARE');
  assert.equal(r.kind, 'FORFEIT');
  assert.equal(r.forfeiting_side, 'HOME');
  assert.equal(r.proposed_by, saved.proposerId);
  assert.equal(r.reviewed_by, saved.reviewerId);
  assert.equal(r.independent, true);
  assert.equal(r.original_opponents, true);
  assert.equal(r.match_status, 'SCHEDULED');
  assert.equal(r.scoring_event_count, 0);
  assert.equal(r.scoring_state_count, 0);
  assert.equal(r.confirmation_count, 0);
  assert.ok(
    r.receipt_count >= 3,
    'Rules, proposal and approval must retain their real idempotent receipts',
  );
}
/** Creates a real approved head only on the separate, already-published unprepared X02 fixture. */
export async function captureX02Adjudication({ call, state, readPool }) {
  assert.match(
    (await readPool.query('SELECT current_database() AS name')).rows[0].name,
    /^scb_test_[A-Za-z0-9_]+$/,
    'X02 capture refuses a non-isolated database',
  );
  const orgId = state.orgId,
    eventId = state.x02Scheduling?.workspace?.event?.id,
    proposer = state.commerce?.operators?.[0];
  assert.ok(uuid(orgId) && uuid(eventId) && uuid(state.userId) && uuid(proposer?.userId));
  assert.ok(typeof state.cookie === 'string' && typeof proposer.cookie === 'string');
  assert.notEqual(
    proposer.userId,
    state.userId,
    'The administrative reviewer must be another synthetic person',
  );
  const reviewerSession = (await call('/v1/auth/session', { cookie: state.cookie })).data;
  const proposerSession = (await call('/v1/auth/session', { cookie: proposer.cookie })).data;
  assert.equal(reviewerSession.user.id, state.userId);
  assert.equal(proposerSession.user.id, proposer.userId);
  const eventBase = `/v1/orgs/${orgId}/events/${eventId}`;
  const configured = (await call(eventBase + '/exception-rules', { cookie: state.cookie })).data;
  assert.ok(
    configured.rules && uuid(configured.rules.id),
    'DRAFT exception-rule hook must run before the X02 event is frozen',
  );
  assert.equal(configured.rules.forfeitWinPoints, 2);
  assert.equal(configured.rules.forfeitLossPoints, 0);
  assert.equal(configured.rules.cancellationPolicy, 'EXCLUDE_FROM_TABLE');
  const matches = (await call(eventBase + '/matches', { cookie: state.cookie })).data;
  assert.ok(Array.isArray(matches));
  const match = matches.find((m) => m.status === 'SCHEDULED' && !m.adjudication);
  assert.ok(match, 'X02 requires an original unprepared fixture');
  const base = `/v1/orgs/${orgId}/matches/${match.id}/exceptions`;
  const current = (await call(base, { cookie: proposer.cookie })).data;
  assert.equal(current.match.status, 'SCHEDULED');
  assert.equal(current.active, null);
  assert.equal(current.capabilities.canPropose, true);
  const proposalCommandId = randomUUID();
  const proposed = (
    await call(base + '/proposals', {
      method: 'POST',
      cookie: proposer.cookie,
      body: {
        clientRequestId: proposalCommandId,
        expectedEventVersion: current.event.version,
        expectedMatchVersion: current.match.version,
        operation: 'DECLARE',
        kind: 'FORFEIT',
        forfeitingSide: 'HOME',
        reason: '合成隔离恢复：保留真实单场弃权裁定',
      },
    })
  ).data;
  assert.ok(uuid(proposed.requestId));
  const pending = (await call(base, { cookie: state.cookie })).data,
    request = pending.requests.find((r) => r.id === proposed.requestId);
  assert.ok(request);
  assert.equal(request.status, 'PENDING');
  assert.equal(pending.capabilities.canReview, true);
  const reviewCommandId = randomUUID();
  const approved = (
    await call(base + '/' + request.id + '/review', {
      method: 'POST',
      cookie: state.cookie,
      body: {
        clientRequestId: reviewCommandId,
        expectedEventVersion: pending.event.version,
        expectedMatchVersion: pending.match.version,
        expectedRequestVersion: request.version,
        type: 'APPROVE',
        reason: '合成隔离恢复：另一名管理员独立复核',
      },
    })
  ).data;
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.requestId, request.id);
  const active = (await call(base, { cookie: state.cookie })).data;
  assert.equal(active.active.id, request.id);
  assert.equal(active.active.status, 'APPROVED');
  assert.equal(active.active.kind, 'FORFEIT');
  assert.equal(active.match.status, 'SCHEDULED');
  assert.equal(active.capabilities.canPropose, false);
  const saved = {
    orgId,
    eventId,
    matchId: match.id,
    rulesId: configured.rules.id,
    rulesVersion: configured.rules.version,
    adjudicationId: request.id,
    requestVersion: active.active.version,
    headVersion: request.sourceHeadVersion + 1,
    proposerId: proposer.userId,
    reviewerId: state.userId,
    proposalCommandId,
    reviewCommandId,
  };
  const snapshot = await retained(readPool, saved);
  decision(snapshot, saved);
  const result = { ...saved, hashes: hashes(snapshot) };
  references(result);
  return result;
}
/** Administrative history and its effective head are facts, not credentials or send jobs. */
export async function verifyX02Adjudication({ readPool, saved }) {
  references(saved);
  const current = await retained(readPool, saved);
  decision(current, saved);
  assert.deepEqual(
    hashes(current),
    saved.hashes,
    'Restore must retain the exact approved adjudication, locked rules, head and receipts',
  );
}
export async function verifyX02AdjudicationQuarantine({ readPool, saved }) {
  // Quarantine disables the institution and public capabilities elsewhere; it must never forge a REVOKE.
  await verifyX02Adjudication({ readPool, saved });
}
