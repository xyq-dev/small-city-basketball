import { describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { PublicArchivesService } from './public-archives-service.js';
import { PosterService } from './poster-service.js';
import {
  createYouthLiveConsentGuard,
  createYouthPublicationGuard,
} from './youth-guardians-publication.js';
import type {
  YouthPublicationDecision,
  YouthPublicationGuard,
} from './youth-guardians-publication.js';
const allowed: YouthPublicationDecision = {
  required: true,
  ready: true,
  blockers: [],
  snapshot: null,
  trustedAdult: false,
  qualificationId: 'qualification',
};
const profile = {
  id: 'profile',
  kind: 'PLAYER',
  owner_user_id: 'child',
  public_key: 'A'.repeat(43),
  display_name: '合成青年',
  consented_at: '2026-10-31T00:00:00Z',
};
const source = (id: string, youth: boolean) => ({
  id,
  profile_id: profile.id,
  profile_kind: 'PLAYER',
  owner_user_id: 'child',
  youth_enabled: youth,
  org_id: 'org',
  event_id: id,
  team_id: 'team',
  member_id: 'member',
  consented_at: '2026-10-31T00:00:00Z',
});
class ArchiveProbe extends PublicArchivesService {
  async permitted(c: PoolClient, p = profile) {
    return this.currentArchiveSources(c, [p]);
  }
  async projected(c: PoolClient, p = profile) {
    return this.projection(c, p, '2026-10-31T00:00:00Z');
  }
}
function fixture({
  known = true,
  rows = [source('legacy', false), source('youth', true)],
  decision = allowed,
  adultReconsent = true,
}: {
  known?: boolean;
  rows?: any[];
  decision?: YouthPublicationDecision;
  adultReconsent?: boolean;
} = {}) {
  const queries: { sql: string; args: any[] }[] = [],
    guard: YouthPublicationGuard = async () => decision;
  const service = new ArchiveProbe({} as Pool, {
    databaseUrl: 'postgresql://localhost/scb_test_unit',
    appOrigin: 'http://localhost:5173',
    youthPublicationGuard: guard,
  });
  const c = {
    query: async (sql: string, args: any[] = []) => {
      queries.push({ sql, args });
      if (sql.startsWith('SELECT g.*,p.kind')) return { rows };
      if (sql.startsWith('SELECT EXISTS(SELECT 1 FROM youth_guardian_preconsents'))
        return { rows: [{ known }] };
      if (sql.includes('FROM public_archive_sources s JOIN youth_event_policies'))
        return { rows: [], rowCount: 0 };
      if (sql.includes('FROM participant_qualification_prechecks'))
        return { rows: adultReconsent ? [{}] : [], rowCount: adultReconsent ? 1 : 0 };
      if (sql.includes('FOR SHARE NOWAIT')) return { rows: [{ id: 'locked' }], rowCount: 1 };
      if (sql.startsWith('SELECT g.id AS source_id')) return { rows: [] };
      throw new Error('Unexpected E08 projection query');
    },
  } as unknown as PoolClient;
  return { service, c, queries };
}
describe('E08 current publication purposes', () => {
  it('does not reuse a minor-era portrait consent as the newly adult subject permission', async () => {
    const material: any = {
      material_id: 'material',
      material_version: 1,
      member_id: 'member',
      user_id: 'child',
      status: 'APPROVED',
      publicity_consent: true,
      reservation_active: true,
      reviewed_start_date: '2026-11-10',
      reviewed_end_date: '2026-11-11',
      head_key_id: 'key',
      revision_id: 'revision',
      roster_revision_id: 'roster',
      ruleset_id: 'rules',
      jersey_no: '1',
      terms_version: 'registration-materials-v1',
      has_signature: true,
      portrait_sha256: 'hash',
      portrait_bytes: 3,
      purged_at: null,
      key_id: 'key',
      material_consent_date: '2026-10-31',
    };
    const seen: string[] = [],
      service = new PosterService({} as Pool, {
        databaseUrl: 'postgresql://localhost/scb_test_unit',
        appOrigin: 'http://localhost:5173',
        youthPublicationGuard: async (_c, _i, purpose) => {
          seen.push(purpose);
          return {
            ...allowed,
            required: false,
            trustedAdult: true,
            adultConsentAfter: '2026-11-01',
          };
        },
      }) as any;
    service.publication = async () => ({
      id: 'publication',
      public_event_id: 'public',
      revoked_at: null,
    });
    service.publicBundle = async () => ({
      event: {
        name: '合成青年杯',
        start_date: '2026-11-10',
        end_date: '2026-11-11',
        venue_name: null,
      },
      pub: { id: 'publication' },
      plan: {
        source: {
          entries: [
            {
              entryId: 'entry',
              teamId: 'team',
              teamName: '合成球队',
              rosterRevisionId: 'roster',
              players: [{ memberId: 'member', name: '合成青年', jerseyNo: '1' }],
            },
          ],
        },
      },
    });
    const c = {
      query: async (sql: string) => ({
        rows: sql.includes('SELECT m.id AS material_id') ? [material] : [],
      }),
    } as unknown as PoolClient;
    const access = { ctx: { orgId: 'org' }, event: { id: 'event', locked_ruleset_id: 'rules' } },
      input = { kind: 'ROSTER', entryId: 'entry', memberIds: [], includePortraits: false };
    const old = await service.recipe(c, access, input);
    expect(old.players).toEqual([]);
    expect(old.omittedPlayerCount).toBe(1);
    material.material_consent_date = '2026-11-01';
    const current = await service.recipe(c, access, input);
    expect(current.players).toHaveLength(1);
    expect(seen).toEqual(['PUBLICITY', 'PUBLICITY']);
    material.publicity_consent = false;
    expect((await service.recipe(c, access, input)).players).toEqual([]);
  });
  it('known youth cannot regain a public identity through legacy adult-only source consent', async () => {
    const f = fixture({ decision: { ...allowed, ready: false } });
    expect(await f.service.permitted(f.c)).toEqual([]);
    const projection = await f.service.projected(f.c);
    expect(projection.authorizedSourceCount).toBe(0);
    expect(f.queries.find((q) => q.sql.startsWith('SELECT g.id AS source_id'))?.args[1]).toEqual(
      [],
    );
  });
  it('filters unauthorized sources before proof LIMIT and recounts only current youth-purpose grants', async () => {
    const f = fixture();
    const projection = await f.service.projected(f.c);
    expect(projection.authorizedSourceCount).toBe(1);
    const proof = f.queries.find((q) => q.sql.startsWith('SELECT g.id AS source_id'))!;
    expect(proof.args[1]).toEqual(['youth']);
    expect(proof.sql.indexOf('g.id=ANY($2::uuid[])')).toBeLessThan(proof.sql.indexOf(' LIMIT '));
  });
  it('an adult after a youth context needs fresh trusted qualification and a later explicit source purpose grant', async () => {
    const decision = {
      ...allowed,
      required: false,
      trustedAdult: true,
      adultConsentAfter: '2026-01-01',
    };
    const stale = fixture({ decision, adultReconsent: false });
    expect(await stale.service.permitted(stale.c)).toEqual([]);
    const f = fixture({ decision, adultReconsent: true });
    expect((await f.service.permitted(f.c)).map((s) => s.id)).toEqual(['youth']);
    expect(
      f.queries.find((q) => q.sql.includes('FROM participant_qualification_prechecks'))?.args[2],
    ).toBe('2026-01-01');
  });
  it('keeps legacy adult archives and pure team aggregation available without expanding youth permission', async () => {
    const legacy = fixture({ known: false, rows: [source('legacy', false)] });
    expect((await legacy.service.permitted(legacy.c)).map((s) => s.id)).toEqual(['legacy']);
    const team = fixture({
      known: true,
      rows: [{ ...source('team', true), profile_kind: 'TEAM' }],
      decision: { ...allowed, ready: false },
    });
    expect(
      (await team.service.permitted(team.c, { ...profile, kind: 'TEAM' })).map((s) => s.id),
    ).toEqual(['team']);
  });
  it('fails closed for youth publications without a qualification reader/key, while disabled policies stay compatible', async () => {
    let enabled = true;
    const c = { query: async () => ({ rows: [{ enabled }] }) } as unknown as PoolClient;
    const guard = createYouthPublicationGuard();
    expect(
      (
        await guard(
          c,
          { orgId: 'org', eventId: 'event', teamId: 'team', memberId: 'member' },
          'PUBLICITY',
        )
      ).ready,
    ).toBe(false);
    enabled = false;
    expect(
      (
        await guard(
          c,
          { orgId: 'org', eventId: 'event', teamId: 'team', memberId: 'member' },
          'PUBLICITY',
        )
      ).ready,
    ).toBe(true);
  });
  it('checks all published home/away players for LIVE_RECORDING and closes on any unverified participant', async () => {
    let enabled = true,
      players = 0;
    const seen: string[] = [];
    const c = {
      query: async (sql: string, args: any[] = []) => {
        if (sql.includes('AS youth_processing_date'))
          return { rows: [{ youth_processing_date: '2026-10-31' }] };
        if (sql.includes('youth_event_policies'))
          return { rows: [{ enabled, version: 1, guardian_age_threshold: 18 }] };
        if (sql.includes('FROM published_matches'))
          return {
            rows: [
              {
                home_entry_id: 'home',
                away_entry_id: 'away',
                home_roster_revision_id: 'r1',
                away_roster_revision_id: 'r2',
                home_team_id: 't1',
                away_team_id: 't2',
              },
            ],
          };
        if (sql.includes('entry_roster_players')) {
          players++;
          return { rows: [{ member_id: args[1] === 'home' ? 'adult' : 'unknown' }] };
        }
        if (sql.includes('FROM entries en'))
          return {
            rows: [
              {
                id: args[2] === 't1' ? 'home' : 'away',
                roster_revision_id: args[2] === 't1' ? 'r1' : 'r2',
                ruleset_id: 'rules',
                start_date: '2026-10-31',
              },
            ],
          };
        return { rows: [] };
      },
    } as unknown as PoolClient;
    const gate = createYouthLiveConsentGuard(undefined, async (_c, scope) => {
      seen.push(scope.memberId);
      return {
        ready: scope.memberId === 'adult',
        subjectUserId: scope.memberId,
        materialId: 'm',
        materialRevisionId: 'r',
        qualificationId: 'q',
        birthDate: '1990-01-01',
      };
    });
    expect(await gate(c, { orgId: 'org', eventId: 'event', matchId: 'match' })).toEqual({
      ready: false,
    });
    expect(players).toBe(2);
    expect(seen).toEqual(['adult', 'unknown']);
    enabled = false;
    expect(await gate(c, { orgId: 'org', eventId: 'event', matchId: 'match' })).toEqual({
      ready: true,
    });
  });
});
