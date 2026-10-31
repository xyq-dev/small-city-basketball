import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { StreamingService } from '../src/streaming-service.js';
import type { LiveExecutor, MediaExecutor, RelayRun } from '../src/live-media-executor.js';
import type { RelayObserved } from '../../../packages/contracts/streaming.js';
import { closeHarness, createScoringHarness, published } from './p05-support.js';
import type { Harness } from './p05-support.js';
import { ORIGIN, eventually } from './support.js';
import { readStreamingClosureBlockers } from '../src/streaming-privacy.js';
class ControlledExecutor implements LiveExecutor, MediaExecutor {
  readonly enabled = true;
  states = new Map<string, RelayObserved>();
  runs: RelayRun[] = [];
  stopKnown = true;
  starts = 0;
  hold: Promise<void> | undefined;
  async start(run: RelayRun) {
    this.starts++;
    this.runs.push(run);
    await run.readScore();
    if (this.hold) await this.hold;
    this.states.set(run.operationKey, 'CONNECTED');
  }
  async stop(key: string) {
    if (!this.stopKnown || !this.states.has(key)) return false;
    this.states.set(key, 'STOPPED');
    return true;
  }
  async observe(key: string) {
    return this.states.get(key) ?? 'UNKNOWN';
  }
  async record(): Promise<never> {
    throw Error('No synthetic recording result');
  }
  async transform(): Promise<never> {
    throw Error('No synthetic artifact result');
  }
  async probe(): Promise<never> {
    throw Error('No synthetic probe');
  }
  async file(): Promise<never> {
    throw Error('No synthetic file');
  }
  async discard() {}
}
describe(
  'E01 durable intent and physical generation fences on isolated real PostgreSQL',
  { concurrent: false },
  () => {
    let h: Harness;
    const services: StreamingService[] = [];
    beforeAll(async () => {
      h = await createScoringHarness();
    }, 60000);
    afterAll(async () => {
      for (const s of services) await s.onModuleDestroy();
      if (h) await closeHarness(h);
    }, 30000);
    async function setup() {
      const fixture = await published(h, h.teams.slice(0, 2)),
        match = fixture.matches[0]!.id;
      await h.api.pool.query(
        "INSERT INTO event_staff(org_id,event_id,user_id,role) VALUES($1,$2,$3,'STREAMER')",
        [h.owner.orgId, fixture.event.event.id, h.otherOwner.id],
      );
      const executor = new ControlledExecutor();
      let sourceStopped = true;
      const service = new StreamingService(
        h.api.pool,
        { databaseUrl: h.databaseUrl, appOrigin: ORIGIN },
        {
          encryptionKey: Buffer.alloc(32, 7).toString('base64'),
          capabilitiesVerified: true,
          authorizeRecording: async () => true,
          baseFenPerMinute: 1,
          templates: [
            {
              key: 'test',
              orgId: h.owner.orgId,
              platform: 'BILIBILI',
              host: 'relay.example.com',
              appPath: 'live',
              accountSlot: randomUUID(),
              verifiedUntil: new Date(Date.now() + 3600000).toISOString(),
              fenPerMinute: 1,
            },
          ],
          ingress: {
            enabled: true,
            lease: (name, at) => ({
              pushUrl: 'rtmp://push.example.com/live/' + name,
              pullUrl: 'https://pull.example.com/live/' + name + '.flv',
              expiresAt: at.toISOString(),
            }),
            revoke: async () => sourceStopped,
          },
          executor,
        },
      );
      services.push(service);
      const channel = (
        await service.channelCommand(h.owner.cookie, h.owner.orgId, {
          clientRequestId: randomUUID(),
          type: 'CREATE',
          templateKey: 'test',
          label: '合成频道',
          publishKey: 'synthetic-key',
        })
      ).id;
      const create = {
        clientRequestId: randomUUID(),
        type: 'CREATE',
        channelIds: [channel],
        maximumSeconds: 60,
        budgetFen: 20,
        record: false,
      };
      const first = await service.command(h.otherOwner.cookie, h.owner.orgId, match, create);
      const replay = await service.command(h.otherOwner.cookie, h.owner.orgId, match, create);
      expect(replay.session.id).toBe(first.session.id);
      const approve = await service.command(h.owner.cookie, h.owner.orgId, match, {
        clientRequestId: randomUUID(),
        type: 'APPROVE',
        sessionId: first.session.id,
        expectedVersion: first.session.version,
      });
      const start = {
        clientRequestId: randomUUID(),
        type: 'START',
        sessionId: first.session.id,
        expectedVersion: approve.session.version,
        deviceId: randomUUID(),
      };
      return {
        service,
        executor,
        match,
        start,
        session: first.session.id,
        setSourceKnown: (v: boolean) => {
          sourceStopped = v;
        },
      };
    }
    test('same START receipt returns the same source generation, never duplicates a job or stores raw push credentials', async () => {
      const f = await setup(),
        a = await f.service.command(h.otherOwner.cookie, h.owner.orgId, f.match, f.start),
        b = await f.service.command(h.otherOwner.cookie, h.owner.orgId, f.match, f.start);
      expect(b.source).toEqual(a.source);
      expect(a.source?.sourceEpoch).toBe(1);
      const rows = await h.api.pool.query(
        'SELECT result FROM stream_command_receipts WHERE id=$1',
        [f.start.clientRequestId],
      );
      expect(JSON.stringify(rows.rows)).not.toContain('pushUrl');
      await f.service.drain();
      await f.service.drain();
      expect(f.executor.starts).toBe(1);
      expect(
        (await f.service.workspace(h.otherOwner.cookie, h.owner.orgId, f.match)).sessions[0]!
          .targets[0],
      ).toMatchObject({ state: 'CONNECTED', platformState: 'UNKNOWN' });
      await expect(
        f.service.workspace(h.leader.cookie, h.owner.orgId, f.match),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        h.api.pool.query("UPDATE stream_command_receipts SET result='{}' WHERE id=$1", [
          f.start.clientRequestId,
        ]),
      ).rejects.toThrow('append only');
    });
    test('STOP is committed while START is in flight; a late successful child is cleaned and cannot revive the terminal intent', async () => {
      const f = await setup();
      let release!: () => void;
      f.executor.hold = new Promise<void>((r) => {
        release = r;
      });
      const started = await f.service.command(h.otherOwner.cookie, h.owner.orgId, f.match, f.start);
      const drain = f.service.drain();
      await eventually(
        async () => f.executor.starts,
        (n) => n === 1,
        'START did not reach executor',
      );
      const stopped = await f.service.command(h.otherOwner.cookie, h.owner.orgId, f.match, {
        clientRequestId: randomUUID(),
        type: 'STOP',
        sessionId: f.session,
        expectedVersion: started.session.version,
        reason: '显式结束本场',
      });
      expect(stopped.session.desired).toBe('STOPPED');
      release();
      await drain;
      await f.service.drain();
      const row = (
        await h.api.pool.query(
          'SELECT desired,observed,source_stopped FROM broadcast_sessions WHERE id=$1',
          [f.session],
        )
      ).rows[0];
      expect(row).toMatchObject({ desired: 'STOPPED', observed: 'ENDED', source_stopped: true });
      expect(
        (
          await h.api.pool.query('SELECT slot_held FROM live_relays WHERE session_id=$1', [
            f.session,
          ])
        ).rows[0]!.slot_held,
      ).toBe(false);
      await expect(
        f.service.command(h.otherOwner.cookie, h.owner.orgId, f.match, {
          ...f.start,
          clientRequestId: randomUUID(),
          expectedVersion: stopped.session.version,
        }),
      ).rejects.toThrow();
    });
    test('an unknown target stop or unconfirmed remote forbid holds the source and external slot', async () => {
      const f = await setup(),
        started = await f.service.command(h.otherOwner.cookie, h.owner.orgId, f.match, f.start);
      await f.service.drain();
      f.executor.stopKnown = false;
      f.setSourceKnown(false);
      await f.service.command(h.otherOwner.cookie, h.owner.orgId, f.match, {
        clientRequestId: randomUUID(),
        type: 'PAUSE',
        sessionId: f.session,
        expectedVersion: started.session.version,
        reason: '断流后核对停止',
      });
      await f.service.drain();
      expect(
        (
          await h.api.pool.query(
            'SELECT source_stopped,observed FROM broadcast_sessions WHERE id=$1',
            [f.session],
          )
        ).rows[0],
      ).toMatchObject({ source_stopped: false, observed: 'STOPPING' });
      expect(
        (
          await h.api.pool.query('SELECT slot_held FROM live_relays WHERE session_id=$1', [
            f.session,
          ])
        ).rows[0]!.slot_held,
      ).toBe(true);
      const c = await h.api.pool.connect();
      try {
        await c.query('BEGIN');
        expect(await readStreamingClosureBlockers(c, h.otherOwner.id)).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'STREAMING_STOP_UNCONFIRMED' })]),
        );
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
      const current = (await f.service.workspace(h.owner.cookie, h.owner.orgId, f.match))
        .sessions[0]!;
      await expect(
        f.service.command(h.otherOwner.cookie, h.owner.orgId, f.match, {
          ...f.start,
          clientRequestId: randomUUID(),
          expectedVersion: current.version,
        }),
      ).rejects.toMatchObject({ code: 'STREAM_STOP_UNCONFIRMED' });
    });
    test('membership revocation invalidates score reads immediately and drain erects a stop barrier', async () => {
      const f = await setup();
      await f.service.command(h.otherOwner.cookie, h.owner.orgId, f.match, f.start);
      await f.service.drain();
      await h.api.pool.query(
        "UPDATE event_staff SET status='DISABLED' WHERE org_id=$1 AND event_id=(SELECT event_id FROM published_matches WHERE id=$2) AND user_id=$3",
        [h.owner.orgId, f.match, h.otherOwner.id],
      );
      await expect(f.executor.runs[0]!.readScore()).rejects.toMatchObject({
        code: 'STREAM_WORKER_FENCED',
      });
      await f.service.drain();
      expect(
        (await h.api.pool.query('SELECT desired FROM broadcast_sessions WHERE id=$1', [f.session]))
          .rows[0]!.desired,
      ).toBe('PAUSED');
    });
  },
);
