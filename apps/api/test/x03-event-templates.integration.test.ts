import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {
  EventRegistrationData,
  EventTemplateCommandReceipt,
  EventTemplateConfiguration,
  EventSetupGuide,
} from '@small-city-basketball/contracts';
import { templatePresets } from '../src/event-template-domain.js';
import { call, data, error } from './support.js';
import {
  blockedPid,
  closeHarness,
  court,
  createHarness,
  frozen,
  policyFor,
  revisionsPath,
} from './p04-support.js';
import type { Harness } from './p04-support.js';
import { command, entry, registrationCommand, roster } from './p03-support.js';

describe('X03 versioned templates and setup guide with real PostgreSQL', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    if (h) await closeHarness(h);
  }, 30000);
  const base = () => `/v1/orgs/${h.owner.orgId}`;
  const execute = (body: Record<string, unknown>) =>
    call(h.api, 'post', base() + '/event-template-commands', { cookie: h.owner.cookie, body });
  const freshEvent = () => ({
    name: '模板草稿 ' + randomUUID().slice(0, 8),
    startDate: `${new Date().getUTCFullYear() + 4}-01-01`,
    endDate: `${new Date().getUTCFullYear() + 4}-01-07`,
    venueName: '新场馆文字',
  });
  const rrConfig = (): EventTemplateConfiguration => {
    const cfg = templatePresets()[0]!.configuration;
    return {
      ...cfg,
      format: 'ROUND_ROBIN',
      expectedTeams: 3,
      registration: { ...cfg.registration, minPlayers: 2, maxPlayers: 2 },
      scheduling: { ...cfg.scheduling, groupCount: null, thirdPlaceMatch: false },
    };
  };
  async function create() {
    return data<EventTemplateCommandReceipt>(
      await execute({
        type: 'CREATE_TEMPLATE',
        clientRequestId: randomUUID(),
        name: '可复用规则',
        configuration: rrConfig(),
      }),
    );
  }
  const instantiate = (t: EventTemplateCommandReceipt['template']) => ({
    type: 'INSTANTIATE',
    clientRequestId: randomUUID(),
    templateId: t.id,
    templateVersionId: t.versionId,
    expectedTemplateVersion: t.version,
    event: freshEvent(),
  });

  test('concurrent identical preset commands create one true template version and one unlocked draft', async () => {
    const body = {
      type: 'INSTANTIATE',
      clientRequestId: randomUUID(),
      presetKey: 'EIGHT_TEAM_GROUP_BRONZE_V1',
      event: freshEvent(),
    };
    const responses = await Promise.all([execute(body), execute(body)]);
    const a = data<EventTemplateCommandReceipt>(responses[0]!),
      b = data<EventTemplateCommandReceipt>(responses[1]!);
    expect(a).toEqual(b);
    expect(a.event).toMatchObject({ status: 'DRAFT', format: 'GROUP_KNOCKOUT' });
    const result = (
      await h.api.pool.query(
        `SELECT e.status,e.locked_ruleset_id,e.locked_scoring_ruleset_id,e.locked_standings_ruleset_id,
      e.current_ruleset_id,e.current_scoring_ruleset_id,e.current_standings_ruleset_id,
      (SELECT count(*)::int FROM entries WHERE event_id=e.id) AS entries,
      (SELECT count(*)::int FROM schedule_publications WHERE event_id=e.id) AS publications
      FROM events e WHERE e.id=$1`,
        [a.event!.id],
      )
    ).rows[0];
    expect(result).toMatchObject({
      status: 'DRAFT',
      locked_ruleset_id: null,
      locked_scoring_ruleset_id: null,
      locked_standings_ruleset_id: null,
      entries: 0,
      publications: 0,
    });
    for (const field of [
      'current_ruleset_id',
      'current_scoring_ruleset_id',
      'current_standings_ruleset_id',
    ])
      expect(result[field]).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int n FROM event_template_commands WHERE org_id=$1 AND actor_id=$2 AND client_request_id=$3',
          [h.owner.orgId, h.owner.id, body.clientRequestId],
        )
      ).rows[0].n,
    ).toBe(1);
    const receipt = data(
      await call(h.api, 'get', base() + '/event-template-commands/' + body.clientRequestId, {
        cookie: h.owner.cookie,
      }),
    );
    expect(receipt).toEqual(a);
    const guide = data<EventSetupGuide>(
      await call(h.api, 'get', base() + `/events/${a.event!.id}/setup-guide`, {
        cookie: h.owner.cookie,
      }),
    );
    expect(guide.template).toMatchObject({ expectedTeams: 8 });
    expect(guide.steps[0]!.blockers).toContain('请设置并锁定积分规则');
  });
  test('new versions and archive preserve old instances and immutable receipts', async () => {
    const original = await create(),
      request = instantiate(original.template),
      instance = data<EventTemplateCommandReceipt>(await execute(request));
    const next = data<EventTemplateCommandReceipt>(
      await execute({
        type: 'UPDATE_TEMPLATE',
        clientRequestId: randomUUID(),
        templateId: original.template.id,
        expectedTemplateVersion: original.template.version,
        name: '新版规则',
        configuration: { ...rrConfig(), expectedTeams: 4 },
      }),
    );
    expect(next.template.version).toBe(original.template.version + 1);
    expect(next.template.versionId).not.toBe(original.template.versionId);
    const snapshot = (
      await h.api.pool.query(
        'SELECT configuration FROM event_template_instances WHERE event_id=$1',
        [instance.event!.id],
      )
    ).rows[0].configuration;
    expect(snapshot.expectedTeams).toBe(3);
    await expect(
      h.api.pool.query('UPDATE event_template_versions SET configuration=$2::jsonb WHERE id=$1', [
        original.template.versionId,
        JSON.stringify(next.template.configuration),
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const archived = data<EventTemplateCommandReceipt>(
      await execute({
        type: 'ARCHIVE_TEMPLATE',
        clientRequestId: randomUUID(),
        templateId: next.template.id,
        expectedTemplateVersion: next.template.version,
        reason: '本届模板已经停用',
      }),
    );
    expect(archived.template.status).toBe('ARCHIVED');
    const rejected = await execute(instantiate(archived.template));
    error(rejected, 409);
    expect(rejected.body.error.code).toBe('TEMPLATE_ARCHIVED');
    expect(data(await execute(request))).toEqual(instance);
    const reused = await execute({ ...request, event: { ...request.event, name: '不同赛事' } });
    error(reused, 409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
  test('current role and organization scope apply before receipt replay', async () => {
    const original = await create();
    error(
      await call(h.api, 'get', base() + '/event-template-commands/' + original.clientRequestId, {
        cookie: h.otherOwner.cookie,
      }),
      403,
    );
    error(
      await call(h.api, 'post', `/v1/orgs/${h.otherOwner.orgId}/event-template-commands`, {
        cookie: h.otherOwner.cookie,
        body: instantiate(original.template),
      }),
      404,
    );
    error(await call(h.api, 'get', base() + '/event-templates', { cookie: h.leader.cookie }), 404);
  });
  test('save from an existing event copies rule configuration only', async () => {
    const f = await frozen(h, h.owner, h.teams.slice(0, 2));
    const scoring = data<{ event: { version: number } }>(
      await call(h.api, 'put', base() + `/events/${f.event.id}/scoring-rules`, {
        cookie: h.owner.cookie,
        body: { expectedEventVersion: f.event.version, ...rrConfig().scoring },
      }),
    );
    const standings = data<{ event: { version: number } }>(
      await call(h.api, 'put', base() + `/events/${f.event.id}/standings-rules`, {
        cookie: h.owner.cookie,
        body: { expectedEventVersion: scoring.event.version, ...rrConfig().standings! },
      }),
    );
    const saved = data<EventTemplateCommandReceipt>(
      await execute({
        type: 'CREATE_FROM_EVENT',
        clientRequestId: randomUUID(),
        eventId: f.event.id,
        expectedEventVersion: standings.event.version,
        name: '从原赛事保存',
        expectedTeams: 2,
        scheduling: rrConfig().scheduling,
      }),
    );
    const copied = JSON.stringify(saved.template.configuration);
    expect(copied).not.toContain(f.event.id);
    for (const e of f.freeze!.entries) expect(copied).not.toContain(e.teamId);
    expect(copied).not.toContain(f.event.startDate);
    const next = data<EventTemplateCommandReceipt>(await execute(instantiate(saved.template)));
    expect(next.event!.status).toBe('DRAFT');
    expect(next.event!.id).not.toBe(f.event.id);
    expect(
      (
        await h.api.pool.query(
          'SELECT count(*)::int n FROM registration_freezes WHERE event_id=$1',
          [next.event!.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  test('actual frozen count mismatch blocks generation and appears in guide', async () => {
    const saved = await create(),
      created = data<EventTemplateCommandReceipt>(await execute(instantiate(saved.template)));
    let current = data<EventRegistrationData>(
      await call(h.api, 'get', base() + `/events/${created.event!.id}/registration`, {
        cookie: h.owner.cookie,
      }),
    );
    current = await registrationCommand(h.api, h.owner, current, 'OPEN_REGISTRATION');
    for (const team of h.teams.slice(0, 2)) {
      let draft = await entry(h.api, h.owner, current.event.id, team, h.leader);
      draft = await roster(h.api, h.owner, draft, h.leader, team.members);
      draft = await command(h.api, h.owner, draft, h.leader, 'SUBMIT');
      await command(h.api, h.owner, draft, h.owner, 'APPROVE');
    }
    current = await registrationCommand(h.api, h.owner, current, 'CLOSE_REGISTRATION');
    current = await registrationCommand(h.api, h.owner, current, 'FREEZE_REGISTRATION');
    const c = await court(h.api, h.owner),
      result = await call(h.api, 'post', revisionsPath(h.owner.orgId, current.event.id), {
        cookie: h.owner.cookie,
        body: {
          expectedEventVersion: current.event.version,
          freezeId: current.freeze!.id,
          algorithmVersion: 'RR_CIRCLE_V1',
          policy: policyFor(current, [c]),
        },
      });
    error(result, 422);
    expect(result.body.error.code).toBe('TEMPLATE_TEAM_COUNT_MISMATCH');
    const guide = data<EventSetupGuide>(
      await call(h.api, 'get', base() + `/events/${current.event.id}/setup-guide`, {
        cookie: h.owner.cookie,
      }),
    );
    expect(guide.steps[3]!.blockers.join(' ')).toContain('实际冻结2支');
    expect(
      (
        await h.api.pool.query('SELECT count(*)::int n FROM schedule_revisions WHERE event_id=$1', [
          current.event.id,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
  test('receipt replay rechecks expiration after waiting for the original command lock', async () => {
    const body = {
      type: 'CREATE_TEMPLATE',
      clientRequestId: randomUUID(),
      name: '过期回执边界',
      configuration: rrConfig(),
    };
    data<EventTemplateCommandReceipt>(await execute(body));
    const sessions = (
      await h.api.pool.query<{ id: string; expires_at: Date }>(
        'SELECT id,expires_at FROM sessions WHERE user_id=$1 AND revoked_at IS NULL',
        [h.owner.id],
      )
    ).rows;
    const blocker = await h.api.pool.connect();
    let pending: ReturnType<typeof execute> | null = null;
    try {
      await blocker.query('BEGIN');
      const pid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
        .pid;
      await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `x03:${h.owner.orgId}:${h.owner.id}:${body.clientRequestId}`,
      ]);
      await h.api.pool.query(
        "UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE user_id=$1 AND revoked_at IS NULL",
        [h.owner.id],
      );
      pending = execute(body);
      await blockedPid(
        h.api.pool,
        pid,
        'Template receipt replay waits on the existing command lock',
      );
      await h.api.pool.query('SELECT pg_sleep(2.1)');
      await blocker.query('COMMIT');
      error(await pending, 401);
      expect(
        (
          await h.api.pool.query(
            'SELECT count(*)::int n FROM event_template_commands WHERE org_id=$1 AND actor_id=$2 AND client_request_id=$3',
            [h.owner.orgId, h.owner.id, body.clientRequestId],
          )
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      if (pending) await pending.catch(() => null);
      for (const s of sessions)
        await h.api.pool.query('UPDATE sessions SET expires_at=$2 WHERE id=$1', [
          s.id,
          s.expires_at,
        ]);
    }
  });
});
