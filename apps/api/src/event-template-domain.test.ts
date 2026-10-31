import { describe, expect, test } from 'vitest';
import { ApiError } from './errors.js';
import {
  configurationHash,
  deriveSetupGuide,
  parseTemplateCommand,
  parseTemplateConfiguration,
  templatePresets,
} from './event-template-domain.js';
import type { GuideFacts } from './event-template-domain.js';
const id = '10000000-0000-4000-8000-000000000001';
const configuration = () => templatePresets()[0]!.configuration;
const facts = (): GuideFacts => ({
  eventVersion: 7,
  status: 'DRAFT',
  format: 'GROUP_KNOCKOUT',
  canManage: true,
  registrationRules: false,
  scoringRules: false,
  standingsLocked: false,
  registrationBlocked: false,
  template: null,
  frozen: false,
  revision: false,
  published: false,
  conflicts: 0,
  counts: { approved: 0, submitted: 0, changesRequested: 0, frozen: 0, fixtures: 0, assigned: 0 },
});
describe('X03 reusable template configuration boundaries', () => {
  test('preset preserves eight-team bronze intent without any previous event identities', () => {
    const p = templatePresets()[0]!;
    expect(p.configuration).toMatchObject({
      format: 'GROUP_KNOCKOUT',
      expectedTeams: 8,
      scheduling: { groupCount: 2, thirdPlaceMatch: true },
    });
    const value = JSON.stringify(p);
    for (const key of ['teamId', 'playerId', 'courtId', 'startDate', 'orgId', 'phone', 'token'])
      expect(value).not.toContain(key);
    expect(configurationHash(parseTemplateConfiguration(p.configuration))).toBe(
      configurationHash(p.configuration),
    );
    p.configuration.registration.minPlayers = 1;
    expect(templatePresets()[0]!.configuration.registration.minPlayers).toBe(5);
  });
  test.each(['orgId', 'teams', 'players', 'courtId', 'startDate', 'staff', 'publicEventId'])(
    'refuses copying forbidden top-level %s',
    (field) => {
      expect(() => parseTemplateConfiguration({ ...configuration(), [field]: id })).toThrow(
        ApiError,
      );
    },
  );
  test.each([
    (c: any) => ({ ...c, registration: { ...c.registration, expectedVersion: 3 } }),
    (c: any) => ({
      ...c,
      scoring: { ...c.scoring, tiePolicy: 'ALLOW_DRAW', overtimeDurationSeconds: null },
    }),
    (c: any) => ({ ...c, expectedTeams: 3 }),
    (c: any) => ({ ...c, expectedTeams: 33 }),
    (c: any) => ({ ...c, expectedTeams: 8.5 }),
    (c: any) => ({ ...c, scheduling: { ...c.scheduling, groupCount: '2' } }),
    (c: any) => ({ ...c, scheduling: { ...c.scheduling, dailyStart: '21:00', dailyEnd: '09:00' } }),
    (c: any) => ({ ...c, scheduling: { ...c.scheduling, courtId: id } }),
    (c: any) => ({ ...c, scheduling: { ...c.scheduling, slotDurationMinutes: 800 } }),
  ])('rejects invalid or identity-bearing nested configuration %#', (change) =>
    expect(() => parseTemplateConfiguration(change(configuration()))).toThrow(ApiError),
  );
  test('supports a generic double round robin without bronze or group configuration', () => {
    const c = configuration();
    const value = {
      ...c,
      format: 'DOUBLE_ROUND_ROBIN',
      expectedTeams: null,
      scheduling: { ...c.scheduling, groupCount: null, thirdPlaceMatch: false },
    };
    expect(parseTemplateConfiguration(value)).toMatchObject({
      format: 'DOUBLE_ROUND_ROBIN',
      expectedTeams: null,
    });
    expect(() =>
      parseTemplateConfiguration({
        ...value,
        scheduling: { ...value.scheduling, thirdPlaceMatch: true },
      }),
    ).toThrow(ApiError);
  });
  test('instantiation takes fresh event fields and a pinned version, never an override format', () => {
    const raw = {
      type: 'INSTANTIATE',
      clientRequestId: id,
      templateId: id,
      templateVersionId: id,
      expectedTemplateVersion: 1,
      event: { name: ' 新赛事 ', startDate: '2030-01-01', endDate: '2030-01-07' },
    };
    expect(parseTemplateCommand(raw)).toMatchObject({
      event: { name: '新赛事', venueName: null },
      type: 'INSTANTIATE',
    });
    for (const field of ['format', 'status', 'teams', 'courtId'])
      expect(() => parseTemplateCommand({ ...raw, event: { ...raw.event, [field]: id } })).toThrow(
        ApiError,
      );
    expect(() => parseTemplateCommand({ ...raw, presetKey: 'EIGHT_TEAM_GROUP_BRONZE_V1' })).toThrow(
      ApiError,
    );
    expect(() => parseTemplateCommand({ ...raw, actorId: id })).toThrow(ApiError);
    expect(() => parseTemplateCommand({ ...raw, expectedTemplateVersion: 0 })).toThrow(ApiError);
  });
  test('save-from-event command canonicalizes schedule before opening a transaction', () => {
    const raw = {
      type: 'CREATE_FROM_EVENT',
      clientRequestId: id,
      eventId: id,
      expectedEventVersion: 2,
      name: '复用配置',
      expectedTeams: null,
      scheduling: configuration().scheduling,
    };
    expect(parseTemplateCommand(raw)).toMatchObject({
      type: 'CREATE_FROM_EVENT',
      expectedTeams: null,
      scheduling: { groupCount: 2 },
    });
    expect(() =>
      parseTemplateCommand({ ...raw, scheduling: { ...raw.scheduling, courtId: id } }),
    ).toThrow(ApiError);
    expect(() => parseTemplateCommand({ ...raw, expectedTeams: '8' })).toThrow(ApiError);
  });
});
describe('X03 fact-derived blocking setup guide', () => {
  test('starts with missing rules and leaves later work waiting', () => {
    const guide = deriveSetupGuide(facts());
    expect(guide.steps[0]).toMatchObject({ state: 'BLOCKED' });
    expect(guide.steps[0]!.blockers).toHaveLength(3);
    expect(guide.steps[1]!.state).toBe('WAITING');
  });
  test('advances through registration and identifies pending review and freeze separately', () => {
    const f = { ...facts(), registrationRules: true, scoringRules: true, standingsLocked: true };
    expect(deriveSetupGuide(f).steps[1]!.state).toBe('CURRENT');
    f.status = 'REGISTRATION_CLOSED';
    f.counts.submitted = 1;
    const guide = deriveSetupGuide(f);
    expect(guide.steps[1]!.state).toBe('COMPLETE');
    expect(guide.steps[2]!.state).toBe('BLOCKED');
    expect(guide.steps[2]!.blockers.join(' ')).toContain('待审核');
  });
  test('blocks a frozen six-team instance of the eight-team preset', () => {
    const f = {
      ...facts(),
      registrationRules: true,
      scoringRules: true,
      standingsLocked: true,
      status: 'REGISTRATION_CLOSED',
      frozen: true,
      template: { id, versionId: id, expectedTeams: 8, configuration: configuration() },
      counts: { ...facts().counts, frozen: 6 },
    };
    expect(deriveSetupGuide(f).steps[3]).toMatchObject({ state: 'BLOCKED' });
    expect(deriveSetupGuide(f).steps[3]!.blockers[0]).toContain('实际冻结6支');
  });
  test('assigned slots remain blocked by real conflicts, and a published event does not invent saved rules', () => {
    const f = {
      ...facts(),
      registrationRules: true,
      scoringRules: true,
      standingsLocked: true,
      status: 'REGISTRATION_CLOSED',
      frozen: true,
      revision: true,
      conflicts: 2,
      counts: {
        approved: 8,
        submitted: 0,
        changesRequested: 0,
        frozen: 8,
        fixtures: 12,
        assigned: 12,
      },
    };
    expect(deriveSetupGuide(f).steps[4]!.state).toBe('BLOCKED');
    expect(deriveSetupGuide(f).steps[5]!.state).toBe('WAITING');
    const g = deriveSetupGuide({
      ...f,
      status: 'SCHEDULED',
      published: true,
      conflicts: 0,
      scoringRules: false,
    });
    expect(g.steps[0]!.state).toBe('BLOCKED');
    expect(g.steps[5]!.state).toBe('COMPLETE');
  });
});
