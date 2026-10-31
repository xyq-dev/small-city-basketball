import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const uuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function context(state) {
  assert.ok(
    state && uuid(state.orgId),
    'Template runtime check requires an existing isolated organization',
  );
  assert.ok(
    typeof state.cookie === 'string' && state.cookie.startsWith('scb.sid='),
    'Template runtime check requires a current authorized synthetic session',
  );
  return { root: `/v1/orgs/${state.orgId}`, cookie: state.cookie };
}
/** Call only from the existing isolated acceptance harness, against the restricted runtime API. */
export async function captureEventTemplates({ call, state }) {
  const { root, cookie } = context(state);
  const configuration = {
    format: 'ROUND_ROBIN',
    expectedTeams: null,
    registration: {
      minPlayers: 2,
      maxPlayers: 15,
      zeroAndDoubleZeroDistinct: true,
      requireIdentity: false,
      requireInsurance: false,
      requireParticipantMaterials: false,
    },
    scoring: {
      regulationPeriods: 4,
      periodDurationSeconds: 600,
      allowedScoreValues: [1, 2, 3],
      tiePolicy: 'OVERTIME',
      overtimeDurationSeconds: 300,
    },
    standings: {
      winPoints: 2,
      lossPoints: 1,
      drawPoints: 1,
      tiebreakers: ['SCORE_DIFFERENCE', 'POINTS_FOR'],
    },
    scheduling: {
      dailyStart: '09:00',
      dailyEnd: '21:00',
      slotDurationMinutes: 60,
      minRestMinutes: 30,
      minLocalDayGap: 0,
      groupCount: null,
      thirdPlaceMatch: false,
    },
  };
  const createRequest = {
    type: 'CREATE_TEMPLATE',
    clientRequestId: randomUUID(),
    name: '合成持久化办赛模板',
    configuration,
  };
  const creation = (
    await call(`${root}/event-template-commands`, { method: 'POST', cookie, body: createRequest })
  ).data;
  assert.ok(
    uuid(creation.template.id) && uuid(creation.template.versionId),
    'A true persisted template version is required',
  );
  assert.equal(creation.operation, 'CREATE_TEMPLATE');
  assert.equal(creation.event, null);
  assert.deepEqual(creation.template.configuration, configuration);
  assert.deepEqual(
    (await call(`${root}/event-template-commands`, { method: 'POST', cookie, body: createRequest }))
      .data,
    creation,
    'Create retry must return the permanent original receipt',
  );
  const year = new Date().getUTCFullYear() + 4;
  const instantiateRequest = {
    type: 'INSTANTIATE',
    clientRequestId: randomUUID(),
    templateId: creation.template.id,
    templateVersionId: creation.template.versionId,
    expectedTemplateVersion: creation.template.version,
    event: {
      name: '合成模板实例赛事',
      startDate: `${year}-01-01`,
      endDate: `${year}-01-07`,
      venueName: '合成场馆',
    },
  };
  const instance = (
    await call(`${root}/event-template-commands`, {
      method: 'POST',
      cookie,
      body: instantiateRequest,
    })
  ).data;
  assert.equal(instance.operation, 'INSTANTIATE');
  assert.ok(uuid(instance.event.id));
  assert.equal(instance.event.status, 'DRAFT');
  assert.equal(instance.event.format, 'ROUND_ROBIN');
  assert.deepEqual(
    (
      await call(`${root}/event-template-commands`, {
        method: 'POST',
        cookie,
        body: instantiateRequest,
      })
    ).data,
    instance,
    'Instantiate retry must not create a second draft',
  );
  const saved = { createRequest, instantiateRequest, creation, instance };
  state.x03Templates = saved;
  await verifyEventTemplates({ call, state });
  return saved;
}
/** Read only; use a current session after restart or explicit authorized restore reactivation. */
export async function verifyEventTemplates({ call, state }) {
  const { root, cookie } = context(state),
    saved = state.x03Templates;
  assert.ok(
    saved && uuid(saved.creation?.template?.id) && uuid(saved.instance?.event?.id),
    'Template capture must exist before verify; never invent an empty fixture',
  );
  for (const [request, receipt] of [
    [saved.createRequest, saved.creation],
    [saved.instantiateRequest, saved.instance],
  ]) {
    assert.deepEqual(
      (await call(`${root}/event-template-commands/${request.clientRequestId}`, { cookie })).data,
      receipt,
      'Original immutable template receipt survives restart/restore',
    );
  }
  const catalog = (await call(`${root}/event-templates`, { cookie })).data;
  assert.deepEqual(
    catalog.templates.find((t) => t.id === saved.creation.template.id),
    saved.creation.template,
    'The saved configuration version must remain reachable',
  );
  const event = (await call(`${root}/events/${saved.instance.event.id}`, { cookie })).data;
  assert.deepEqual(
    event,
    saved.instance.event,
    'Untouched draft metadata survives restart/restore',
  );
  const guide = (await call(`${root}/events/${event.id}/setup-guide`, { cookie })).data;
  assert.equal(guide.template.id, saved.creation.template.id);
  assert.equal(guide.template.versionId, saved.creation.template.versionId);
  assert.deepEqual(guide.template.configuration, saved.creation.template.configuration);
  assert.equal(guide.published, false);
  assert.equal(guide.counts.approved, 0);
  assert.equal(guide.counts.frozen, 0);
  assert.equal(guide.counts.fixtures, 0);
  const registration = (await call(`${root}/events/${event.id}/registration`, { cookie })).data;
  const scoring = (await call(`${root}/events/${event.id}/scoring`, { cookie })).data;
  const standings = (await call(`${root}/events/${event.id}/standings`, { cookie })).data;
  assert.ok(
    registration.rules && scoring.rules && standings.rules,
    'All three rule drafts must persist under the restricted runtime grants',
  );
  assert.equal(registration.freeze, null);
  assert.equal(scoring.locked, false);
  assert.equal(standings.locked, false);
  return {
    templateId: saved.creation.template.id,
    templateVersionId: saved.creation.template.versionId,
    eventId: event.id,
  };
}
