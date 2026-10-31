import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApi } from '../src/app.js';
import { posterChineseFontsAvailable } from '../src/poster-domain.js';
import { ORIGIN, call, data, error } from './support.js';
import {
  command,
  entry,
  getEntry,
  openRegistration,
  participant,
  registration,
  registrationCommand,
  roster,
  team,
  teamPath,
} from './p03-support.js';
import { allocate, court, fullAllocations, publish, revision } from './p04-support.js';
import {
  closeHarness,
  confirmMatch,
  createScoringHarness,
  disable,
  enable,
  published,
  reopen,
  savePublishRules,
} from './p05b-support.js';
import type { Harness } from './p05b-support.js';
type Row = Record<string, any>;
describe(
  'X05 authorized posters against current PostgreSQL provenance',
  { concurrent: false },
  () => {
    let h: Harness, fonts: boolean;
    beforeAll(async () => {
      h = await createScoringHarness(2);
      await h.api.app.close();
      await h.api.pool.end();
      h.api = await createApi({
        databaseUrl: h.databaseUrl,
        appOrigin: ORIGIN,
        participantDataKey: createHash('sha256')
          .update('synthetic-c23-restart:' + new URL(h.databaseUrl).pathname.slice(1))
          .digest('base64'),
      });
      fonts = await posterChineseFontsAvailable();
      expect(
        fonts,
        'X05 poster PG suite requires installed Chinese fonts; missing-font behavior is tested separately',
      ).toBe(true);
    }, 90000);
    afterAll(async () => {
      if (h) await closeHarness(h);
    }, 30000);
    const base = (event: string) => `/v1/orgs/${h.owner.orgId}/events/${event}/posters`;
    const get = async (event: string) =>
      data<Row>(await call(h.api, 'get', base(event), { cookie: h.owner.cookie }));
    const generate = async (event: string, kind: string, extra: Row = {}) => {
      const w = await get(event);
      const body = {
        clientRequestId: randomUUID(),
        expectedEventVersion: w.event.version,
        kind,
        ...extra,
      };
      return {
        body,
        response: await call(h.api, 'post', base(event), { cookie: h.owner.cookie, body }),
      };
    };
    test('matchup uses formal public fixture and private PNG export revocation is permanent', async () => {
      const f = await published(h, h.teams),
        event = f.event.event.id;
      const unpublished = await generate(event, 'MATCHUP', { matchId: f.matches[0]!.id });
      error(unpublished.response, 410);
      await savePublishRules(h, event);
      await enable(h, event);
      const generated = await generate(event, 'MATCHUP', { matchId: f.matches[0]!.id });
      if (!fonts) {
        error(generated.response, 503);
        expect(generated.response.body.error.code).toBe('POSTER_FONT_UNAVAILABLE');
        return;
      }
      const poster = data<Row>(generated.response, 201).poster,
        path = base(event) + `/${poster.id}/content`;
      error(await call(h.api, 'get', path), 401);
      error(await call(h.api, 'get', path, { cookie: h.leader.cookie }), 404);
      const content = await call(h.api, 'get', path, { cookie: h.owner.cookie });
      expect(content.status).toBe(200);
      expect(content.headers['cache-control']).toBe('private, no-store');
      expect(content.headers['content-type']).toMatch(/^image\/png/);
      expect(await sharp(content.body as Buffer).metadata()).toMatchObject({
        format: 'png',
        width: 1080,
        height: 1440,
      });
      data(
        await call(h.api, 'post', base(event) + `/${poster.id}/revoke`, {
          cookie: h.owner.cookie,
          body: { clientRequestId: randomUUID(), reason: '合成宣传撤销' },
        }),
      );
      error(await call(h.api, 'get', path, { cookie: h.owner.cookie }), 410);
      error(
        await call(h.api, 'post', base(event), { cookie: h.owner.cookie, body: generated.body }),
        410,
      );
    });
    test('old result confirmation and revoked public source cannot authorize a new download', async () => {
      const f = await published(h, h.teams),
        event = f.event.event.id;
      await savePublishRules(h, event);
      await enable(h, event);
      error((await generate(event, 'RESULT', { matchId: f.matches[0]!.id })).response, 410);
      await confirmMatch(h, f, 0, 3, 1);
      const generated = await generate(event, 'RESULT', { matchId: f.matches[0]!.id });
      if (!fonts) {
        error(generated.response, 503);
        return;
      }
      const poster = data<Row>(generated.response, 201).poster,
        path = base(event) + `/${poster.id}/content`;
      expect((await call(h.api, 'get', path, { cookie: h.owner.cookie })).status).toBe(200);
      await reopen(h, f.matches[0]!.id);
      error(await call(h.api, 'get', path, { cookie: h.owner.cookie }), 410);
      error(
        await call(h.api, 'post', base(event), { cookie: h.owner.cookie, body: generated.body }),
        410,
      );
      await disable(h, event);
      error((await generate(event, 'MATCHUP', { matchId: f.matches[0]!.id })).response, 410);
    });
    test('roster uses only exact current approved photo consent; withdrawal blocks old artifact and private originals remain protected', async () => {
      const reg = await openRegistration(h.api, h.owner, 'X05本人照片宣传', undefined, {
          requireParticipantMaterials: true,
          requireIdentity: false,
          requireInsurance: false,
          minPlayers: 2,
          maxPlayers: 2,
        }),
        event = reg.event.id;
      const png = {
        fileName: 'synthetic-photo.png',
        contentType: 'image/png',
        base64: (
          await sharp({ create: { width: 64, height: 64, channels: 3, background: '#3b70b5' } })
            .png()
            .toBuffer()
        ).toString('base64'),
      };
      let selected: Row | undefined;
      for (let n = 0; n < 2; n++) {
        const target = await team(h.api, h.owner, 'X05合成照片队' + n, h.leader, [
          '合成甲' + n,
          '合成乙' + n,
        ]);
        const actors = [];
        for (let i = 0; i < 2; i++) {
          const actor = await participant(h.api, 'x05-photo-' + n + '-' + i);
          actors.push(actor);
          const claim = data<Row>(
            await call(
              h.api,
              'post',
              `${teamPath(h.owner.orgId, target.id)}/members/${target.members[i]!.id}/claims`,
              { cookie: h.leader.cookie, body: { targetUserId: actor.id } },
            ),
            201,
          );
          data(
            await call(h.api, 'post', `/v1/me/member-claims/${claim.claimId}/accept`, {
              cookie: actor.cookie,
              body: {},
            }),
          );
        }
        let draft = await entry(h.api, h.owner, event, target, h.leader);
        draft = await roster(h.api, h.owner, draft, h.leader, target.members);
        for (let i = 0; i < 2; i++) {
          const actor = actors[i]!,
            materialBase = `/v1/orgs/${h.owner.orgId}/entries/${draft.id}/participant-materials`;
          let material = data<Row>(
            await call(h.api, 'put', materialBase + '/mine', {
              cookie: actor.cookie,
              body: {
                clientRequestId: randomUUID(),
                expectedVersion: 0,
                realName: '合成测试本人' + n + i,
                portrait: png,
                acceptedTerms: true,
                publicityConsent: n === 0 && i === 0,
              },
            }),
          ).material;
          material = data<Row>(
            await call(h.api, 'post', materialBase + '/mine/submit', {
              cookie: actor.cookie,
              body: { expectedVersion: material.version },
            }),
          ).material;
          material = data<Row>(
            await call(h.api, 'post', materialBase + `/${target.members[i]!.id}/review`, {
              cookie: h.owner.cookie,
              body: {
                expectedVersion: material.version,
                decision: 'APPROVE',
                reason: '独立核对合成资料',
                identityChecked: true,
                portraitChecked: true,
                insuranceChecked: true,
              },
            }),
          );
          if (n === 0 && i === 0)
            selected = {
              entryId: draft.id,
              material,
              materialBase,
              actor,
              memberId: target.members[i]!.id,
            };
        }
        draft = await getEntry(h.api, h.owner, draft.id);
        draft = await command(h.api, h.owner, draft, h.leader, 'SUBMIT');
        await command(h.api, h.owner, draft, h.owner, 'APPROVE');
      }
      let current = await registration(h.api, h.owner, event);
      current = await registrationCommand(h.api, h.owner, current, 'CLOSE_REGISTRATION');
      current = await registrationCommand(h.api, h.owner, current, 'FREEZE_REGISTRATION');
      const resource = await court(h.api, h.owner, 'X05宣传场地');
      let plan = await revision(h.api, h.owner, current, [resource]);
      plan = await allocate(
        h.api,
        h.owner,
        plan,
        fullAllocations(plan, resource, `${current.event.startDate}T09:00:00+08:00`),
      );
      data(await publish(h.api, h.owner, plan));
      await savePublishRules(h, event);
      await enable(h, event);
      const generated = await generate(event, 'ROSTER', { entryId: selected!.entryId });
      if (!fonts) {
        error(generated.response, 503);
        return;
      }
      const result = data<Row>(generated.response, 201),
        poster = result.poster;
      expect(result.omittedPlayerCount).toBe(1);
      const stored = (
        await h.api.pool.query('SELECT source,input FROM poster_exports WHERE id=$1', [poster.id])
      ).rows[0]!;
      expect(stored.source.players).toHaveLength(1);
      expect(stored.source.players[0].memberId).toBe(selected!.memberId);
      for (const secret of [
        png.base64,
        '合成测试本人00',
        'payload_ciphertext',
        'identityNumber',
        'insurance',
      ])
        expect(JSON.stringify(stored)).not.toContain(secret);
      const path = base(event) + `/${poster.id}/content`;
      expect((await call(h.api, 'get', path, { cookie: h.owner.cookie })).status).toBe(200);
      error(
        await call(h.api, 'get', selected!.materialBase + `/${selected!.memberId}/files/portrait`, {
          cookie: h.leader.cookie,
        }),
        404,
      );
      data(
        await call(h.api, 'post', selected!.materialBase + '/mine/publicity-withdraw', {
          cookie: selected!.actor.cookie,
          body: { expectedVersion: selected!.material.version },
        }),
      );
      error(await call(h.api, 'get', path, { cookie: h.owner.cookie }), 410);
      error(
        await call(h.api, 'post', base(event), { cookie: h.owner.cookie, body: generated.body }),
        410,
      );
      const next = data<Row>(
        (await generate(event, 'ROSTER', { entryId: selected!.entryId })).response,
        201,
      );
      expect(next.omittedPlayerCount).toBe(2);
    });
  },
);
