import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ApplicationService, isAdministrator } from './service.js';
import type { ApiOptions, OrgActor } from './service.js';
import { forbidden, notFound } from './errors.js';
import { objectInput, resourceId, text } from './validation.js';
import {
  liveFail,
  openStreamSecret,
  parseStreamingCommand,
  scoreText,
  sealStreamSecret,
  streamHash,
  streamKey,
  endpoint,
  channelEndpoint,
  highlightIntervals,
} from './streaming-domain.js';
import type { IngressProvider } from './streaming-provider.js';
import type { LiveExecutor, MediaExecutor, ArtifactResult } from './live-media-executor.js';
import type {
  LiveMediaWorkspace,
  LiveSessionData,
  MediaArtifactData,
  MediaJobData,
  StreamingCommandResult,
  StreamingWorkspace,
} from '../../../packages/contracts/streaming.js';
type Row = Record<string, any>;
export interface StreamingTargetTemplate {
  key: string;
  orgId: string;
  platform: 'DOUYIN' | 'WECHAT_CHANNELS' | 'KUAISHOU' | 'BILIBILI';
  host: string;
  appPath: string;
  accountSlot: string;
  verifiedUntil: string;
  fenPerMinute: number;
}
export interface StreamingOptions {
  encryptionKey?: string;
  templates?: StreamingTargetTemplate[];
  ingress?: IngressProvider;
  executor?: LiveExecutor & MediaExecutor;
  capabilitiesVerified?: boolean;
  baseFenPerMinute?: number;
  autoDispatch?: boolean;
  authorizeRecording?: (
    c: PoolClient,
    input: { orgId: string; eventId: string; matchId: string; purpose: 'LIVE_RECORDING' },
  ) => Promise<boolean>;
}
type Access = { ctx: OrgActor; event: Row; match: Row; manager: boolean; execute: boolean };
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
export class StreamingService extends ApplicationService {
  private readonly key: Buffer | null;
  private readonly config: StreamingOptions;
  private draining = false;
  private closing = false;
  private drainCompletion: Promise<void> | undefined;
  private readonly mediaTasks = new Set<Promise<void>>();
  private readonly localRelayKeys = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly mediaControllers = new Set<AbortController>();
  constructor(pool: Pool, options: ApiOptions, config: StreamingOptions = {}) {
    super(pool, options);
    this.config = config;
    this.key = config.encryptionKey ? streamKey(config.encryptionKey) : null;
    for (const t of config.templates ?? []) {
      resourceId(t.orgId);
      endpoint('rtmps://' + t.host + '/' + t.appPath, 'rtmps:', [t.host]);
      if (
        !/^[A-Za-z0-9_-]{1,60}$/.test(t.key) ||
        !/^\/[A-Za-z0-9/_-]{1,100}$/.test('/' + t.appPath) ||
        !t.accountSlot ||
        t.accountSlot.length > 100 ||
        !Number.isInteger(t.fenPerMinute) ||
        t.fenPerMinute < 0 ||
        !Number.isFinite(Date.parse(t.verifiedUntil))
      )
        throw Error('Invalid streaming target configuration');
    }
  }
  /** Explicitly called only after the enclosing application has initialized successfully. */
  startWorker() {
    if (this.closing || this.timer || !this.config.autoDispatch) return;
    this.timer = setInterval(() => {
      if (this.draining || this.closing) return;
      this.drainCompletion = this.drain().catch(() => {});
    }, 1000);
    this.timer.unref();
  }
  private ready() {
    return (
      !!this.key &&
      this.config.capabilitiesVerified === true &&
      !!this.config.authorizeRecording &&
      this.config.ingress?.enabled === true &&
      this.config.executor?.enabled === true &&
      Number.isInteger(this.config.baseFenPerMinute) &&
      Number(this.config.baseFenPerMinute) >= 0
    );
  }
  private async access(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    match: string,
    write = false,
  ): Promise<Access> {
    const ctx = await this.lockOrganization(c, await this.lockActor(c, cookie), org);
    resourceId(match);
    const route = (
      await c.query<Row>('SELECT event_id FROM published_matches WHERE org_id=$1 AND id=$2', [
        ctx.orgId,
        match,
      ])
    ).rows[0];
    if (!route) throw notFound();
    const event = (
      await c.query<Row>(
        `SELECT * FROM events WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`,
        [ctx.orgId, route.event_id],
      )
    ).rows[0]!;
    const staff = (
      await c.query<Row>(
        "SELECT role FROM event_staff WHERE org_id=$1 AND event_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE",
        [ctx.orgId, event.id, ctx.user.id],
      )
    ).rows[0];
    const manager = isAdministrator(ctx.role) || staff?.role === 'EVENT_MANAGER',
      execute = manager || staff?.role === 'STREAMER';
    if (!execute) throw notFound();
    const m = (
      await c.query<Row>(
        `SELECT * FROM published_matches WHERE org_id=$1 AND id=$2 FOR ${write ? 'UPDATE' : 'SHARE'}`,
        [ctx.orgId, match],
      )
    ).rows[0]!;
    return { ctx, event, match: m, manager, execute };
  }
  private async liveSession(c: PoolClient, a: Access, id: string, write = false) {
    const s = (
      await c.query<Row>(
        `SELECT * FROM broadcast_sessions WHERE org_id=$1 AND match_id=$2 AND id=$3 FOR ${write ? 'UPDATE' : 'SHARE'}`,
        [a.ctx.orgId, a.match.id, resourceId(id)],
      )
    ).rows[0];
    if (!s) throw notFound();
    return s;
  }
  private async sessionDto(c: PoolClient, s: Row, actor?: OrgActor): Promise<LiveSessionData> {
    const targets = (
      await c.query<Row>(
        'SELECT r.*,a.platform,a.label FROM live_relays r JOIN live_channel_accounts a ON a.org_id=r.org_id AND a.id=r.channel_id WHERE r.org_id=$1 AND r.session_id=$2 ORDER BY r.id',
        [s.org_id, s.id],
      )
    ).rows;
    return {
      id: s.id,
      matchId: s.match_id,
      version: s.version,
      epoch: s.epoch,
      sourceEpoch: s.source_epoch,
      desired: s.desired,
      observed: s.observed,
      sourceExpiresAt: iso(s.source_expires_at),
      leaseOwned:
        !!actor && s.source_owner_id === actor.user.id && s.source_session_id === actor.sessionId,
      approved: !!s.approved_at && !s.rights_revoked_at,
      recordingApproved: !!s.recording_approved_at && !s.rights_revoked_at,
      maximumSeconds: s.maximum_seconds,
      budgetFen: s.budget_fen,
      startedAt: iso(s.started_at),
      targets: targets.map((r) => ({
        channelId: r.channel_id,
        platform: r.platform,
        label: r.label,
        epoch: r.epoch,
        state: r.state,
        observedAt: iso(r.observed_at),
        platformState: 'UNKNOWN',
      })),
    };
  }
  async workspace(
    cookie: string | undefined,
    org: string,
    match: string,
  ): Promise<StreamingWorkspace> {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, match);
      const sessions = (
        await c.query<Row>(
          'SELECT * FROM broadcast_sessions WHERE org_id=$1 AND match_id=$2 ORDER BY created_at DESC LIMIT 30',
          [org, match],
        )
      ).rows;
      const channels = (
        await c.query<Row>(
          'SELECT id,platform,label,version,verified_until,revoked_at FROM live_channel_accounts WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100',
          [org],
        )
      ).rows;
      const result = {
        match: { id: match, eventId: a.event.id, status: a.match.status },
        channels: channels.map((x) => ({
          id: x.id,
          platform: x.platform,
          label: x.label,
          version: x.version,
          verifiedUntil: iso(x.verified_until)!,
          revoked: !!x.revoked_at,
        })),
        sessions: await Promise.all(sessions.map((x) => this.sessionDto(c, x, a.ctx))),
        capabilities: {
          canManage: a.manager,
          canExecute: a.execute,
          providerReady: this.ready(),
          blockers: this.ready() ? [] : ['直播主体/渠道能力、云入口与执行配置未验收，不能真实开播'],
        },
      };
      await this.ensureFreshSession(c, a.ctx);
      return result;
    });
  }
  async channels(cookie: string | undefined, org: string) {
    return this.transaction(async (c) => {
      const ctx = await this.lockOrganization(c, await this.lockActor(c, cookie), org);
      if (!isAdministrator(ctx.role)) throw forbidden();
      const options = (this.config.templates ?? [])
        .filter((x) => x.orgId === org)
        .map((x) => ({ key: x.key, platform: x.platform, verifiedUntil: x.verifiedUntil }));
      await this.ensureFreshSession(c, ctx);
      return { templates: options };
    });
  }
  async channelCommand(cookie: string | undefined, org: string, raw: unknown) {
    const b = objectInput(raw, [
      'clientRequestId',
      'type',
      'id',
      'expectedVersion',
      'templateKey',
      'label',
      'publishKey',
    ]);
    resourceId(String(b.clientRequestId));
    return this.transaction(async (c) => {
      const ctx = await this.lockOrganization(c, await this.lockActor(c, cookie), org);
      if (!isAdministrator(ctx.role)) throw forbidden();
      if (b.type === 'CREATE') {
        if (!this.key) liveFail('STREAMING_DISABLED', '直播凭据安全配置未就绪', 503);
        const t = (this.config.templates ?? []).find(
          (x) => x.key === b.templateKey && x.orgId === org,
        );
        if (!t || Date.parse(t.verifiedUntil) <= Date.now())
          liveFail('STREAM_TARGET_UNVERIFIED', '外站账号/渠道尚未核验', 422);
        const label = text(b.label, 'label', 1, 80),
          publish = text(b.publishKey, 'publishKey', 1, 1024);
        if (/[\u0000-\u0020\\#]/.test(publish))
          liveFail('STREAM_ENDPOINT_INVALID', '推流参数不合法', 422);
        const id = resourceId(String(b.clientRequestId)),
          target = channelEndpoint(t!.host, t!.appPath, publish);
        const old = (await c.query<Row>('SELECT * FROM live_channel_accounts WHERE id=$1', [id]))
          .rows[0];
        const cipher = sealStreamSecret(this.key!, id, target.toString());
        if (old) {
          if (
            old.org_id !== org ||
            old.template_key !== t!.key ||
            old.label !== label ||
            openStreamSecret(this.key!, id, old.credential_ciphertext) !== target.toString()
          )
            liveFail('STREAM_REQUEST_CONFLICT');
        } else
          await c.query(
            'INSERT INTO live_channel_accounts(id,org_id,template_key,platform,label,slot_key,credential_ciphertext,verified_until,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [
              id,
              org,
              t!.key,
              t!.platform,
              label,
              streamHash(t!.platform + ':' + t!.accountSlot),
              cipher,
              t!.verifiedUntil,
              ctx.user.id,
            ],
          );
        await this.ensureFreshSession(c, ctx);
        return { id };
      }
      if (b.type !== 'REVOKE') liveFail('INVALID_STREAM_COMMAND', '无效渠道命令', 422);
      const channel = (
        await c.query<Row>(
          'SELECT * FROM live_channel_accounts WHERE org_id=$1 AND id=$2 FOR UPDATE',
          [org, resourceId(String(b.id))],
        )
      ).rows[0];
      if (!channel) throw notFound();
      if (channel.version !== b.expectedVersion) liveFail('VERSION_CONFLICT');
      await c.query(
        'UPDATE live_channel_accounts SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',
        [channel.id],
      );
      await this.ensureFreshSession(c, ctx);
      return { id: channel.id };
    });
  }
  private sourceToken(s: Row) {
    return createHmac('sha256', this.key!)
      .update([s.id, s.source_epoch, s.source_session_id, s.source_device_id].join(':'))
      .digest('hex');
  }
  private async response(
    c: PoolClient,
    a: Access,
    s: Row,
    includeSource = false,
  ): Promise<StreamingCommandResult> {
    const result: StreamingCommandResult = { session: await this.sessionDto(c, s, a.ctx) };
    if (
      includeSource &&
      this.ready() &&
      s.desired === 'RUNNING' &&
      s.source_owner_id === a.ctx.user.id &&
      s.source_session_id === a.ctx.sessionId &&
      new Date(s.source_expires_at).getTime() > Date.now()
    ) {
      const lease = this.config.ingress!.lease(s.source_stream_name, new Date(s.source_expires_at));
      result.source = {
        pushUrl: lease.pushUrl,
        leaseToken: this.sourceToken(s),
        expiresAt: lease.expiresAt,
        sourceEpoch: s.source_epoch,
      };
    }
    await this.ensureFreshSession(c, a.ctx);
    return result;
  }
  private async enqueue(
    c: PoolClient,
    s: Row,
    r: Row | null,
    kind: 'START' | 'STOP' | 'STOP_SOURCE',
    epoch = s.epoch,
    targetEpoch = r?.epoch,
  ) {
    const id = randomUUID(),
      key = [s.id, epoch, r?.id ?? s.source_stream_name, targetEpoch ?? s.source_epoch, kind].join(
        ':',
      );
    await c.query(
      'INSERT INTO stream_jobs(id,org_id,session_id,relay_id,kind,epoch,target_epoch,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(operation_key) DO NOTHING',
      [id, s.org_id, s.id, r?.id ?? null, kind, epoch, targetEpoch ?? null, key],
    );
  }
  private async stopRelayJob(c: PoolClient, s: Row, r: Row) {
    const start = (
      await c.query<Row>(
        "SELECT epoch,target_epoch FROM stream_jobs WHERE relay_id=$1 AND kind='START' ORDER BY target_epoch DESC,epoch DESC LIMIT 1",
        [r.id],
      )
    ).rows[0];
    if (start) await this.enqueue(c, s, r, 'STOP', start.epoch, start.target_epoch);
    else
      await c.query(
        "UPDATE live_relays SET state='STOPPED',desired='STOPPED',slot_held=false WHERE id=$1",
        [r.id],
      );
  }
  private async halt(c: PoolClient, s: Row, desired: 'PAUSED' | 'STOPPED') {
    const relays = (
      await c.query<Row>('SELECT * FROM live_relays WHERE org_id=$1 AND session_id=$2 FOR UPDATE', [
        s.org_id,
        s.id,
      ])
    ).rows;
    for (const r of relays) {
      if (r.slot_held || ['STARTING', 'CONNECTED', 'UNKNOWN', 'STOPPING'].includes(r.state)) {
        await this.stopRelayJob(c, s, r);
        await c.query(
          "UPDATE live_relays SET desired='STOPPED',state='STOPPING',epoch=epoch+1 WHERE id=$1",
          [r.id],
        );
      } else
        await c.query(
          "UPDATE live_relays SET desired='STOPPED',state='STOPPED',epoch=epoch+1 WHERE id=$1",
          [r.id],
        );
    }
    if (s.source_stream_name && !s.source_stopped) await this.enqueue(c, s, null, 'STOP_SOURCE');
    return (
      await c.query<Row>(
        "UPDATE broadcast_sessions SET desired=$2,observed=CASE WHEN source_stopped AND NOT EXISTS(SELECT 1 FROM live_relays WHERE session_id=$1 AND slot_held) THEN CASE WHEN $2='STOPPED' THEN 'ENDED' ELSE 'INTERRUPTED' END ELSE 'STOPPING' END,epoch=epoch+1,source_token_hash=NULL,source_expires_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
        [s.id, desired],
      )
    ).rows[0]!;
  }
  async command(
    cookie: string | undefined,
    org: string,
    match: string,
    raw: unknown,
  ): Promise<StreamingCommandResult> {
    const b = parseStreamingCommand(raw),
      fingerprint = streamHash(JSON.stringify(b));
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, match, true);
      const receipt = (
        await c.query<Row>('SELECT * FROM stream_command_receipts WHERE id=$1', [b.clientRequestId])
      ).rows[0];
      if (receipt) {
        if (
          receipt.actor_id !== a.ctx.user.id ||
          receipt.org_id !== org ||
          receipt.request_hash !== fingerprint
        )
          liveFail('STREAM_REQUEST_CONFLICT');
        const current = await this.liveSession(c, a, receipt.session_id);
        return this.response(c, a, current, b.type === 'START' || b.type === 'HEARTBEAT');
      }
      let s: Row;
      if (b.type === 'CREATE') {
        if (!['SCHEDULED', 'RUNNING'].includes(a.event.status)) liveFail('STREAM_EVENT_CLOSED');
        const channelIds = b.channelIds as string[],
          channels = (
            await c.query<Row>(
              'SELECT * FROM live_channel_accounts WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR SHARE',
              [org, channelIds],
            )
          ).rows;
        if (
          channels.length !== channelIds.length ||
          channels.some((x) => x.revoked_at || new Date(x.verified_until).getTime() <= Date.now())
        )
          liveFail('STREAM_TARGET_UNVERIFIED');
        if (
          (
            await c.query(
              "SELECT id FROM broadcast_sessions WHERE org_id=$1 AND match_id=$2 AND observed<>'ENDED'",
              [org, match],
            )
          ).rowCount
        )
          liveFail('STREAM_MATCH_OCCUPIED');
        const id = randomUUID();
        s = (
          await c.query<Row>(
            'INSERT INTO broadcast_sessions(id,org_id,event_id,match_id,created_by,maximum_seconds,budget_fen,record_enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
            [id, org, a.event.id, match, a.ctx.user.id, b.maximumSeconds, b.budgetFen, b.record],
          )
        ).rows[0]!;
        for (const channel of channels)
          await c.query(
            'INSERT INTO live_relays(id,org_id,session_id,channel_id,slot_key) VALUES($1,$2,$3,$4,$5)',
            [randomUUID(), org, id, channel.id, channel.slot_key],
          );
      } else {
        s = await this.liveSession(c, a, String(b.sessionId), true);
        if (s.version !== b.expectedVersion)
          liveFail('VERSION_CONFLICT', '直播资料已更新，请重新读取');
        if (b.type === 'APPROVE') {
          if (!a.manager) throw forbidden();
          if (
            s.desired === 'STOPPED' ||
            s.rights_revoked_at ||
            !['SCHEDULED', 'RUNNING'].includes(a.event.status)
          )
            liveFail('STREAM_EVENT_CLOSED');
          s = (
            await c.query<Row>(
              "UPDATE broadcast_sessions SET approved_by=$2,approved_at=clock_timestamp(),approval_expires_at=clock_timestamp()+($3::text||' seconds')::interval,recording_approved_by=CASE WHEN record_enabled THEN $2 ELSE NULL END,recording_approved_at=CASE WHEN record_enabled THEN clock_timestamp() ELSE NULL END,version=version+1 WHERE id=$1 RETURNING *",
              [s.id, a.ctx.user.id, s.maximum_seconds + 60],
            )
          ).rows[0]!;
        } else if (b.type === 'START') {
          await this.recordingEligibility(c, s);
          if (!this.ready()) liveFail('STREAMING_DISABLED', '直播准入与云执行配置未就绪', 503);
          if (
            !s.approved_at ||
            s.rights_revoked_at ||
            new Date(s.approval_expires_at).getTime() <= Date.now() ||
            s.approved_by === a.ctx.user.id
          )
            liveFail('STREAM_APPROVAL_REQUIRED', '须独立批准并由另一名有权直播人员开始');
          if (
            !['DRAFT', 'PAUSED'].includes(s.desired) ||
            !s.source_stopped ||
            !['SCHEDULED', 'RUNNING'].includes(a.event.status) ||
            (await c.query('SELECT id FROM live_relays WHERE session_id=$1 AND slot_held', [s.id]))
              .rowCount
          )
            liveFail('STREAM_STOP_UNCONFIRMED', '原源或外站停流尚未确认');
          const relays = (
            await c.query<Row>(
              'SELECT r.*,a.template_key,a.revoked_at,a.verified_until FROM live_relays r JOIN live_channel_accounts a ON a.id=r.channel_id WHERE r.session_id=$1 ORDER BY r.id FOR UPDATE OF r',
              [s.id],
            )
          ).rows;
          const templates = relays.map((r) =>
            (this.config.templates ?? []).find((t) => t.key === r.template_key && t.orgId === org),
          );
          if (
            relays.some(
              (r, i) =>
                r.revoked_at ||
                new Date(r.verified_until).getTime() <= Date.now() ||
                !templates[i] ||
                Date.parse(templates[i]!.verifiedUntil) <= Date.now(),
            )
          )
            liveFail('STREAM_TARGET_UNVERIFIED');
          const reserve =
            Math.ceil(s.maximum_seconds / 60) *
            (Number(this.config.baseFenPerMinute) +
              templates.reduce((n, t) => n + t!.fenPerMinute, 0));
          const used = Number(
            (
              await c.query<Row>(
                "SELECT COALESCE(sum(quantity),0) AS used FROM stream_usage_ledger WHERE session_id=$1 AND unit='RESERVED_FEN'",
                [s.id],
              )
            ).rows[0]!.used,
          );
          if (used + reserve > s.budget_fen)
            liveFail('STREAM_BUDGET_EXCEEDED', '费用保守预留超过上限');
          const streamName = 'scb-' + randomUUID() + '-' + (s.source_epoch + 1);
          s = (
            await c.query<Row>(
              "UPDATE broadcast_sessions SET desired='RUNNING',observed='STARTING',epoch=epoch+1,source_epoch=source_epoch+1,source_stream_name=$2,source_owner_id=$3,source_session_id=$4,source_device_id=$5,source_expires_at=clock_timestamp()+interval '30 seconds',source_heartbeat_at=clock_timestamp(),source_stopped=false,started_at=COALESCE(started_at,clock_timestamp()),version=version+1 WHERE id=$1 RETURNING *",
              [s.id, streamName, a.ctx.user.id, a.ctx.sessionId, b.deviceId],
            )
          ).rows[0]!;
          await c.query('UPDATE broadcast_sessions SET source_token_hash=$2 WHERE id=$1', [
            s.id,
            streamHash(this.sourceToken(s)),
          ]);
          for (const r of relays) {
            const updated = (
              await c.query<Row>(
                "UPDATE live_relays SET desired='RUNNING',state='STARTING',epoch=epoch+1,slot_held=true,provider_id=NULL,worker_token=NULL,worker_until=NULL,error_code=NULL WHERE id=$1 RETURNING *",
                [r.id],
              )
            ).rows[0]!;
            await this.enqueue(c, s, updated, 'START');
          }
          await c.query(
            "INSERT INTO stream_usage_ledger(id,org_id,session_id,source_key,unit,quantity) VALUES($1,$2,$3,$4,'RESERVED_FEN',$5)",
            [randomUUID(), org, s.id, s.id + ':' + s.epoch + ':reserve', reserve],
          );
          if (s.record_enabled) {
            await this.mediaCapacity(c, org);
            if (!s.recording_approved_at) liveFail('STREAM_RECORDING_APPROVAL_REQUIRED');
            await c.query(
              "INSERT INTO live_media_jobs(id,org_id,session_id,created_by,kind,source_epoch) VALUES($1,$2,$3,$4,'RECORDING',$5)",
              [randomUUID(), org, s.id, a.ctx.user.id, s.source_epoch],
            );
          }
        } else if (b.type === 'HEARTBEAT') {
          if (!(await this.workerSource(c, s.id))?.authorized) liveFail('STREAM_SOURCE_FENCED');
          if (
            s.desired !== 'RUNNING' ||
            s.source_owner_id !== a.ctx.user.id ||
            s.source_session_id !== a.ctx.sessionId ||
            s.source_device_id !== b.deviceId ||
            s.source_token_hash !== streamHash(String(b.leaseToken))
          )
            liveFail('STREAM_SOURCE_FENCED', '采集已被接管或停止');
          const renewed = (
            await c.query<Row>(
              "UPDATE broadcast_sessions SET source_expires_at=clock_timestamp()+interval '30 seconds',source_heartbeat_at=clock_timestamp() WHERE id=$1 AND source_expires_at>clock_timestamp() AND approval_expires_at>clock_timestamp() AND started_at+maximum_seconds*interval '1 second'>clock_timestamp() RETURNING *",
              [s.id],
            )
          ).rows[0];
          if (!renewed) liveFail('STREAM_SOURCE_EXPIRED', '采集已过期，请核对停流后显式恢复');
          s = renewed;
        } else if (['PAUSE', 'STOP', 'REVOKE'].includes(String(b.type))) {
          if (s.desired === 'STOPPED') liveFail('STREAM_TERMINAL');
          if (!a.manager && s.source_owner_id !== a.ctx.user.id) throw forbidden();
          if (b.type === 'REVOKE' && !a.manager) throw forbidden();
          s = await this.halt(c, s, b.type === 'PAUSE' ? 'PAUSED' : 'STOPPED');
          if (b.type === 'REVOKE')
            s = (
              await c.query<Row>(
                'UPDATE broadcast_sessions SET rights_revoked_at=clock_timestamp() WHERE id=$1 RETURNING *',
                [s.id],
              )
            ).rows[0]!;
        } else {
          if (!a.manager && s.source_owner_id !== a.ctx.user.id) throw forbidden();
          const relay = (
            await c.query<Row>(
              'SELECT * FROM live_relays WHERE session_id=$1 AND channel_id=$2 FOR UPDATE',
              [s.id, b.channelId],
            )
          ).rows[0];
          if (!relay) throw notFound();
          if (b.type === 'STOP_TARGET' && relay.desired === 'STOPPED') {
            // Already stopping/stopped: preserve the original target generation cleanup.
          } else if (b.type === 'STOP_TARGET') {
            await this.stopRelayJob(c, s, relay);
            await c.query(
              "UPDATE live_relays SET desired='STOPPED',state='STOPPING',epoch=epoch+1 WHERE id=$1",
              [relay.id],
            );
          } else {
            if (
              s.desired !== 'RUNNING' ||
              !s.approved_at ||
              s.rights_revoked_at ||
              new Date(s.approval_expires_at).getTime() <= Date.now() ||
              relay.slot_held ||
              relay.state !== 'STOPPED'
            )
              liveFail('STREAM_STOP_UNCONFIRMED');
            if (!this.ready() || !(await this.workerSource(c, s.id))?.authorized)
              liveFail('STREAM_SOURCE_EXPIRED');
            const channel = (
              await c.query<Row>('SELECT * FROM live_channel_accounts WHERE id=$1 FOR SHARE', [
                relay.channel_id,
              ])
            ).rows[0]!;
            const template = (this.config.templates ?? []).find(
              (t) => t.key === channel.template_key && t.orgId === org,
            );
            if (
              channel.revoked_at ||
              new Date(channel.verified_until).getTime() <= Date.now() ||
              !template ||
              Date.parse(template.verifiedUntil) <= Date.now()
            )
              liveFail('STREAM_TARGET_UNVERIFIED');
            const reserve =
              Math.ceil(
                Math.max(
                  0,
                  s.maximum_seconds - (Date.now() - new Date(s.started_at).getTime()) / 1000,
                ) / 60,
              ) * template.fenPerMinute;
            const used = Number(
              (
                await c.query<Row>(
                  "SELECT COALESCE(sum(quantity),0) AS used FROM stream_usage_ledger WHERE session_id=$1 AND unit='RESERVED_FEN'",
                  [s.id],
                )
              ).rows[0]!.used,
            );
            if (used + reserve > s.budget_fen) liveFail('STREAM_BUDGET_EXCEEDED');
            await c.query(
              "INSERT INTO stream_usage_ledger(id,org_id,session_id,source_key,unit,quantity) VALUES($1,$2,$3,$4,'RESERVED_FEN',$5)",
              [randomUUID(), org, s.id, String(b.clientRequestId) + ':reserve', reserve],
            );
            const r = (
              await c.query<Row>(
                "UPDATE live_relays SET desired='RUNNING',state='STARTING',epoch=epoch+1,slot_held=true,provider_id=NULL,worker_token=NULL,worker_until=NULL WHERE id=$1 RETURNING *",
                [relay.id],
              )
            ).rows[0]!;
            await this.enqueue(c, s, r, 'START');
          }
          s = (
            await c.query<Row>(
              'UPDATE broadcast_sessions SET version=version+1 WHERE id=$1 RETURNING *',
              [s.id],
            )
          ).rows[0]!;
        }
      }
      await this.audit(c, a.ctx.user.id, org, 'STREAM_' + String(b.type), 'broadcast', s.id, {
        epoch: s.epoch,
      });
      await c.query(
        'INSERT INTO stream_command_receipts(id,org_id,actor_id,request_hash,session_id,result) VALUES($1,$2,$3,$4,$5,$6)',
        [b.clientRequestId, org, a.ctx.user.id, fingerprint, s.id, { sessionId: s.id }],
      );
      return this.response(c, a, s, b.type === 'START' || b.type === 'HEARTBEAT');
    });
  }
  async receipt(cookie: string | undefined, org: string, match: string, id: string) {
    return this.transaction(async (c) => {
      const a = await this.access(c, cookie, org, match);
      const r = (
        await c.query<Row>(
          'SELECT * FROM stream_command_receipts WHERE id=$1 AND actor_id=$2 AND org_id=$3',
          [resourceId(id), a.ctx.user.id, org],
        )
      ).rows[0];
      if (!r) throw notFound();
      return this.response(c, a, await this.liveSession(c, a, r.session_id));
    });
  }
  private async workerSource(c: PoolClient, id: string) {
    const route = (
      await c.query<Row>('SELECT org_id,event_id FROM broadcast_sessions WHERE id=$1', [id])
    ).rows[0];
    if (!route) return undefined;
    await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE NOWAIT', [
      route.org_id,
      route.event_id,
    ]);
    const value = (
      await c.query<Row>(
        `SELECT s.*,m.home_team_name,m.away_team_name,m.version AS match_version,clock_timestamp() AS sampled_at,to_jsonb(st) AS scoring,
  (s.desired='RUNNING' AND s.rights_revoked_at IS NULL AND s.approval_expires_at>clock_timestamp() AND s.source_expires_at>clock_timestamp() AND s.started_at+s.maximum_seconds*interval '1 second'>clock_timestamp()
  AND o.status='ACTIVE' AND ev.status IN('SCHEDULED','RUNNING') AND u.status='ACTIVE' AND se.user_id=u.id AND se.revoked_at IS NULL AND se.expires_at>clock_timestamp() AND se.created_at>COALESCE(u.credential_reset_at,'-infinity'::timestamptz)
  AND om.status='ACTIVE' AND (om.role IN('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff f WHERE f.org_id=s.org_id AND f.event_id=s.event_id AND f.user_id=u.id AND f.status='ACTIVE' AND f.role IN('EVENT_MANAGER','STREAMER')))
  AND EXISTS(SELECT 1 FROM users au JOIN organization_memberships am ON am.user_id=au.id AND am.org_id=s.org_id WHERE au.id=s.approved_by AND au.status='ACTIVE' AND am.status='ACTIVE' AND (am.role IN('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff af WHERE af.org_id=s.org_id AND af.event_id=s.event_id AND af.user_id=au.id AND af.role='EVENT_MANAGER' AND af.status='ACTIVE')))) AS authorized
  FROM broadcast_sessions s JOIN organizations o ON o.id=s.org_id JOIN events ev ON ev.org_id=s.org_id AND ev.id=s.event_id JOIN published_matches m ON m.org_id=s.org_id AND m.id=s.match_id
  LEFT JOIN scoring_states st ON st.org_id=m.org_id AND st.match_id=m.id LEFT JOIN users u ON u.id=s.source_owner_id LEFT JOIN sessions se ON se.id=s.source_session_id LEFT JOIN organization_memberships om ON om.org_id=s.org_id AND om.user_id=u.id WHERE s.id=$1`,
        [id],
      )
    ).rows[0];
    if (value?.authorized) {
      try {
        await this.recordingEligibility(c, value);
      } catch {
        value.authorized = false;
      }
    }
    return value;
  }
  private async workerScore(job: Row, token: string) {
    return this.transaction(async (c) => {
      const s = await this.workerSource(c, job.session_id);
      if (!s?.authorized || s.epoch !== job.epoch || !this.ready())
        liveFail('STREAM_WORKER_FENCED');
      const relay = (
        await c.query<Row>(
          `UPDATE live_relays r SET worker_until=clock_timestamp()+interval '20 seconds' FROM live_channel_accounts a WHERE r.id=$1 AND r.channel_id=a.id AND a.revoked_at IS NULL AND a.verified_until>clock_timestamp() AND r.epoch=$2 AND r.desired='RUNNING' AND r.worker_token=$3 AND r.worker_until>clock_timestamp() RETURNING r.*,a.template_key`,
          [job.relay_id, job.target_epoch, token],
        )
      ).rows[0];
      const template = (this.config.templates ?? []).find(
        (t) => t.key === relay?.template_key && t.orgId === s.org_id,
      );
      if (!relay || !template || Date.parse(template.verifiedUntil) <= Date.now())
        liveFail('STREAM_WORKER_FENCED');
      if (s.scoring && s.scoring.source_version !== s.match_version)
        liveFail('STREAM_SCORE_INVALID');
      return scoreText(
        s.home_team_name,
        s.away_team_name,
        s.scoring,
        new Date(s.sampled_at).getTime(),
      );
    });
  }
  private async reconcile() {
    await this.transaction(async (c) => {
      const sessions = (
        await c.query<Row>(
          "SELECT id,org_id,event_id FROM broadcast_sessions WHERE desired='RUNNING' OR observed IN('STOPPING','UNKNOWN') ORDER BY id LIMIT 100",
        )
      ).rows;
      for (const candidate of sessions) {
        if (
          !(
            await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE SKIP LOCKED', [
              candidate.org_id,
              candidate.event_id,
            ])
          ).rowCount
        )
          continue;
        let s = (
          await c.query<Row>(
            'SELECT * FROM broadcast_sessions WHERE id=$1 FOR UPDATE SKIP LOCKED',
            [candidate.id],
          )
        ).rows[0];
        if (!s) continue;
        if (s.desired === 'RUNNING') {
          const source = await this.workerSource(c, s.id);
          if (!source?.authorized || !this.ready()) {
            s = await this.halt(c, s, 'PAUSED');
          } else {
            const bad = (
              await c.query<Row>(
                `SELECT r.* FROM live_relays r JOIN live_channel_accounts a ON a.id=r.channel_id WHERE r.session_id=$1 AND r.desired='RUNNING' AND (a.revoked_at IS NOT NULL OR a.verified_until<=clock_timestamp() OR (r.worker_until<=clock_timestamp() AND r.state IN('STARTING','CONNECTED','UNKNOWN'))) ORDER BY r.id FOR UPDATE OF r`,
                [s.id],
              )
            ).rows;
            for (const r of bad) {
              await this.stopRelayJob(c, s, r);
              await c.query(
                "UPDATE live_relays SET desired='STOPPED',state='STOPPING',epoch=epoch+1 WHERE id=$1",
                [r.id],
              );
            }
          }
        }
        const relays = (
          await c.query<Row>('SELECT * FROM live_relays WHERE session_id=$1 ORDER BY id', [s.id])
        ).rows;
        if (
          s.desired !== 'RUNNING' &&
          s.source_stopped &&
          relays.every((r) => !r.slot_held && ['IDLE', 'STOPPED'].includes(r.state))
        ) {
          await c.query(
            "UPDATE broadcast_sessions SET observed=$2,ended_at=CASE WHEN desired='STOPPED' THEN COALESCE(ended_at,clock_timestamp()) ELSE ended_at END WHERE id=$1",
            [s.id, s.desired === 'STOPPED' ? 'ENDED' : 'INTERRUPTED'],
          );
        } else if (s.desired === 'RUNNING') {
          const connected = relays.filter((r) => r.state === 'CONNECTED').length;
          await c.query('UPDATE broadcast_sessions SET observed=$2 WHERE id=$1', [
            s.id,
            connected === relays.length ? 'LIVE' : connected ? 'PARTIAL' : 'STARTING',
          ]);
        }
      }
    });
  }
  private async streamJob() {
    const token = randomUUID();
    const job = await this.transaction(async (c) => {
      const r = (
        await c.query<Row>(
          "SELECT * FROM stream_jobs WHERE (state IN('PENDING','UNKNOWN') OR (state='RUNNING' AND lease_until<=clock_timestamp())) AND next_attempt_at<=clock_timestamp() ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
      ).rows[0];
      if (!r) return null;
      return (
        await c.query<Row>(
          "UPDATE stream_jobs SET state='RUNNING',attempt=attempt+1,lease_token=$2,lease_until=clock_timestamp()+interval '20 seconds' WHERE id=$1 RETURNING *",
          [r.id, token],
        )
      ).rows[0]!;
    });
    if (!job) return;
    let ok = false,
      unknown = false,
      dispatched = false;
    try {
      if (job.kind === 'START') {
        if (job.attempt > 1) {
          const state = await this.config.executor!.observe(job.operation_key);
          if (state === 'UNKNOWN') {
            unknown = true;
          } else if (state === 'CONNECTED' || state === 'STARTING') {
            ok = true;
          } else {
            await this.pool.query(
              "UPDATE stream_jobs SET error_code='CONFIRMED_STOPPED' WHERE id=$1 AND lease_token=$2",
              [job.id, token],
            );
            ok = true;
          }
        } else {
          const start = await this.transaction(async (c) => {
            const s = await this.workerSource(c, job.session_id);
            if (!s?.authorized || s.epoch !== job.epoch || !this.ready()) return null;
            const r = (
              await c.query<Row>(
                `UPDATE live_relays r SET worker_token=$3,worker_until=clock_timestamp()+interval '20 seconds',provider_id=$4 FROM live_channel_accounts a WHERE r.id=$1 AND r.epoch=$2 AND r.desired='RUNNING' AND a.id=r.channel_id AND a.revoked_at IS NULL AND a.verified_until>clock_timestamp() RETURNING r.*,a.credential_ciphertext`,
                [job.relay_id, job.target_epoch, token, job.operation_key],
              )
            ).rows[0];
            return r ? { s, r } : null;
          });
          if (!start) {
            await this.pool.query(
              "UPDATE stream_jobs SET state='FAILED',error_code='FENCED_BEFORE_DISPATCH',lease_until=NULL WHERE id=$1 AND lease_token=$2",
              [job.id, token],
            );
            return;
          }
          const lease = this.config.ingress!.lease(
            start.s.source_stream_name,
            new Date(start.s.source_expires_at),
          );
          this.localRelayKeys.add(job.operation_key);
          dispatched = true;
          await this.config.executor!.start({
            operationKey: job.operation_key,
            inputUrl: lease.pullUrl,
            targetUrl: openStreamSecret(
              this.key!,
              start.r.channel_id,
              start.r.credential_ciphertext,
            ),
            maximumSeconds: Math.max(
              1,
              Math.floor(
                start.s.maximum_seconds -
                  (Date.now() - new Date(start.s.started_at).getTime()) / 1000,
              ),
            ),
            readScore: () => this.workerScore(job, token),
          });
          try {
            await this.workerScore(job, token);
            ok = true;
          } catch {
            ok = await this.config.executor!.stop(job.operation_key);
            unknown = !ok;
          }
        }
      } else if (job.kind === 'STOP_SOURCE') {
        const name = String(job.operation_key).split(':')[2]!;
        ok = this.config.ingress?.enabled === true && (await this.config.ingress.revoke(name));
        unknown = !ok;
        if (ok)
          await this.pool.query(
            'UPDATE broadcast_sessions SET source_stopped=true WHERE id=$1 AND source_stream_name=$2',
            [job.session_id, name],
          );
      } else {
        const startKey = [job.session_id, job.epoch, job.relay_id, job.target_epoch, 'START'].join(
          ':',
        );
        const never = await this.transaction(async (c) => {
          await c.query(
            "UPDATE stream_jobs SET state='FAILED',error_code='FENCED_BEFORE_DISPATCH' WHERE operation_key=$1 AND state='PENDING'",
            [startKey],
          );
          return (
            await c.query<Row>('SELECT state,error_code FROM stream_jobs WHERE operation_key=$1', [
              startKey,
            ])
          ).rows[0];
        });
        ok =
          (never?.state === 'FAILED' && never.error_code === 'FENCED_BEFORE_DISPATCH') ||
          never?.error_code === 'CONFIRMED_STOPPED' ||
          (!!this.config.executor && (await this.config.executor.stop(startKey)));
        unknown = !ok;
        if (ok)
          await this.pool.query(
            "UPDATE live_relays SET state='STOPPED',slot_held=false,worker_token=NULL,worker_until=NULL,observed_at=clock_timestamp() WHERE id=$1 AND desired='STOPPED' AND (provider_id=$2 OR provider_id IS NULL)",
            [job.relay_id, startKey],
          );
      }
    } catch {
      if (job.kind === 'START' && job.attempt === 1 && !dispatched) {
        await this.pool.query(
          "UPDATE stream_jobs SET state='FAILED',error_code='FENCED_BEFORE_DISPATCH',lease_until=NULL WHERE id=$1 AND lease_token=$2",
          [job.id, token],
        );
        return;
      }
      unknown = true;
    }
    await this.pool.query(
      "UPDATE stream_jobs SET state=$3,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '5 seconds',error_code=$4 WHERE id=$1 AND lease_token=$2",
      [
        job.id,
        token,
        ok ? 'SUCCEEDED' : unknown ? 'UNKNOWN' : 'FAILED',
        ok ? null : 'PROVIDER_RESULT_UNKNOWN',
      ],
    );
  }
  private async observe() {
    if (!this.config.executor) return;
    const rows = (
      await this.pool.query<Row>(
        "SELECT * FROM live_relays WHERE desired='RUNNING' AND provider_id IS NOT NULL AND state IN('STARTING','CONNECTED','UNKNOWN') ORDER BY id LIMIT 100",
      )
    ).rows;
    for (const r of rows) {
      const state = await this.config.executor.observe(r.provider_id);
      if (state === 'STOPPED') {
        await this.pool.query(
          "UPDATE live_relays SET state='FAILED',desired='STOPPED',slot_held=false,worker_token=NULL,worker_until=NULL,observed_at=clock_timestamp(),error_code='OUTPUT_ENDED' WHERE id=$1 AND epoch=$2 AND provider_id=$3 AND desired='RUNNING'",
          [r.id, r.epoch, r.provider_id],
        );
      } else
        await this.pool.query(
          "UPDATE live_relays SET state=$4,observed_at=clock_timestamp() WHERE id=$1 AND epoch=$2 AND provider_id=$3 AND desired='RUNNING'",
          [r.id, r.epoch, r.provider_id, state],
        );
    }
  }
  async drain() {
    if (this.draining || this.closing) return;
    this.draining = true;
    try {
      await this.reconcile();
      for (let i = 0; i < 8; i++) await this.streamJob();
      await this.observe();
      await this.reconcile();
      await this.mediaDrain();
    } finally {
      this.draining = false;
    }
  }
  private async mediaAccess(
    c: PoolClient,
    cookie: string | undefined,
    org: string,
    session: string,
    write = false,
  ) {
    const route = (
      await c.query<Row>('SELECT match_id FROM broadcast_sessions WHERE org_id=$1 AND id=$2', [
        resourceId(org),
        resourceId(session),
      ])
    ).rows[0];
    if (!route) throw notFound();
    const a = await this.access(c, cookie, org, route.match_id, write),
      s = await this.liveSession(c, a, session, write);
    return { a, s };
  }
  private mediaJobDto(j: Row): MediaJobData {
    return {
      id: j.id,
      sessionId: j.session_id,
      kind: j.kind,
      status: j.status,
      version: j.version,
      artifactId: j.artifact_id,
      error: j.error_code,
      cancelRequested: !!j.cancel_requested_at,
      createdAt: iso(j.created_at)!,
    };
  }
  private artifactDto(r: Row): MediaArtifactData {
    return {
      id: r.id,
      durationMs: r.duration_ms,
      byteLength: Number(r.byte_length),
      sha256: r.sha256,
      version: r.version,
      published: !!r.public_key && !r.revoked_at,
      publicKey: !r.revoked_at ? r.public_key : null,
    };
  }
  async mediaWorkspace(
    cookie: string | undefined,
    org: string,
    session: string,
  ): Promise<LiveMediaWorkspace> {
    return this.transaction(async (c) => {
      const { a, s } = await this.mediaAccess(c, cookie, org, session);
      const jobs = (
        await c.query<Row>(
          'SELECT * FROM live_media_jobs WHERE org_id=$1 AND session_id=$2 ORDER BY created_at DESC LIMIT 100',
          [org, session],
        )
      ).rows;
      const artifacts = (
        await c.query<Row>(
          'SELECT * FROM live_media_artifacts WHERE org_id=$1 AND session_id=$2 ORDER BY created_at DESC LIMIT 100',
          [org, session],
        )
      ).rows;
      await this.ensureFreshSession(c, a.ctx);
      return {
        session: await this.sessionDto(c, s, a.ctx),
        jobs: jobs.map((x) => this.mediaJobDto(x)),
        artifacts: artifacts.map((x) => this.artifactDto(x)),
        canManage: a.manager,
      };
    });
  }
  private async resultProof(c: PoolClient, s: Row) {
    const r = (
      await c.query<Row>(
        `SELECT m.*,to_jsonb(st) AS state,to_jsonb(cf) AS confirmation,to_jsonb(le) AS last_event,to_jsonb(rc) AS last_command,to_jsonb(sr) AS scoring_rules FROM published_matches m LEFT JOIN scoring_states st ON st.org_id=m.org_id AND st.match_id=m.id LEFT JOIN result_confirmations cf ON cf.org_id=m.org_id AND cf.match_id=m.id AND cf.id=st.latest_confirmation_id LEFT JOIN scoring_events le ON le.org_id=m.org_id AND le.match_id=m.id AND le.seq=st.last_event_seq LEFT JOIN scoring_commands rc ON rc.org_id=m.org_id AND rc.match_id=m.id AND rc.actor_id=le.actor_id AND rc.command_id=le.command_id LEFT JOIN scoring_rulesets sr ON sr.org_id=m.org_id AND sr.event_id=m.event_id AND sr.id=st.ruleset_id WHERE m.org_id=$1 AND m.id=$2`,
        [s.org_id, s.match_id],
      )
    ).rows[0];
    const { confirmedResult } = await import('./standings-domain.js');
    if (!r || !confirmedResult(r))
      liveFail('MEDIA_CONFIRMED_SOURCE_REQUIRED', '自动集锦须有效独立确认赛果');
    return r.confirmation.id as string;
  }
  private async artifactLineage(c: PoolClient, artifact: Row) {
    const chain = (
      await c.query<Row>(
        `WITH RECURSIVE chain AS (
      SELECT a.id,a.revoked_at,j.source_artifact_id,j.kind,j.source_confirmation_id,1 AS depth FROM live_media_artifacts a JOIN live_media_jobs j ON j.org_id=a.org_id AND j.id=a.job_id WHERE a.org_id=$1 AND a.session_id=$2 AND a.id=$3
      UNION ALL SELECT a.id,a.revoked_at,j.source_artifact_id,j.kind,j.source_confirmation_id,p.depth+1 FROM chain p JOIN live_media_artifacts a ON a.id=p.source_artifact_id AND a.org_id=$1 AND a.session_id=$2 JOIN live_media_jobs j ON j.org_id=a.org_id AND j.id=a.job_id WHERE p.depth<9)
      SELECT * FROM chain ORDER BY depth`,
        [artifact.org_id, artifact.session_id, artifact.id],
      )
    ).rows;
    if (
      !chain.length ||
      chain.length > 8 ||
      chain.some((r) => r.revoked_at) ||
      chain.at(-1)?.source_artifact_id
    )
      throw notFound();
    if (chain.some((r) => r.kind === 'HIGHLIGHTS')) {
      const proof = await this.resultProof(c, {
        org_id: artifact.org_id,
        match_id:
          artifact.match_id ??
          (
            await c.query<Row>('SELECT match_id FROM broadcast_sessions WHERE id=$1', [
              artifact.session_id,
            ])
          ).rows[0]!.match_id,
      });
      if (chain.some((r) => r.kind === 'HIGHLIGHTS' && r.source_confirmation_id !== proof))
        throw notFound();
    }
    return chain.length;
  }
  async mediaCommand(cookie: string | undefined, org: string, session: string, raw: unknown) {
    const b = objectInput(raw, [
      'clientRequestId',
      'type',
      'artifactId',
      'jobId',
      'expectedVersion',
      'anchorAt',
      'offsetMs',
      'reason',
    ]);
    resourceId(String(b.clientRequestId));
    const fingerprint = streamHash(JSON.stringify(b));
    return this.transaction(async (c) => {
      const { a, s } = await this.mediaAccess(c, cookie, org, session, true);
      if (!a.manager) throw forbidden();
      const old = (
        await c.query<Row>('SELECT * FROM stream_command_receipts WHERE id=$1', [b.clientRequestId])
      ).rows[0];
      if (old) {
        if (
          old.actor_id !== a.ctx.user.id ||
          old.org_id !== org ||
          old.session_id !== session ||
          old.request_hash !== fingerprint
        )
          liveFail('STREAM_REQUEST_CONFLICT');
        await this.ensureFreshSession(c, a.ctx);
        return old.result;
      }
      let result: Row;
      if (b.type === 'CALIBRATE') {
        const j = (
          await c.query<Row>(
            "SELECT * FROM live_media_jobs WHERE org_id=$1 AND session_id=$2 AND id=$3 AND kind='RECORDING' AND status='READY' FOR UPDATE",
            [org, session, resourceId(String(b.jobId))],
          )
        ).rows[0];
        if (!j) throw notFound();
        if (j.version !== b.expectedVersion) liveFail('VERSION_CONFLICT');
        if (
          typeof b.anchorAt !== 'string' ||
          !Number.isFinite(Date.parse(b.anchorAt)) ||
          !Number.isInteger(b.offsetMs) ||
          Math.abs(Number(b.offsetMs)) > 3600000
        )
          liveFail('MEDIA_ANCHOR_REQUIRED', '请明确核对源PTS锚点', 422);
        text(b.reason, 'reason', 4, 500);
        await c.query(
          'UPDATE live_media_jobs SET anchor_at=$2,anchor_offset_ms=$3,anchor_verified_by=$4,version=version+1 WHERE id=$1',
          [j.id, b.anchorAt, b.offsetMs, a.ctx.user.id],
        );
        result = { jobId: j.id };
      } else if (['TRANSCODE', 'HIGHLIGHTS'].includes(String(b.type))) {
        if (!s.recording_approved_at || s.rights_revoked_at)
          liveFail('MEDIA_RECORDING_RIGHTS_REQUIRED');
        const artifact = (
          await c.query<Row>(
            'SELECT * FROM live_media_artifacts WHERE org_id=$1 AND session_id=$2 AND id=$3 FOR SHARE',
            [org, session, resourceId(String(b.artifactId))],
          )
        ).rows[0];
        if (!artifact || artifact.revoked_at) throw notFound();
        if (artifact.version !== b.expectedVersion) liveFail('VERSION_CONFLICT');
        if ((await this.artifactLineage(c, artifact)) >= 8)
          liveFail('MEDIA_DERIVATION_LIMIT', '媒体派生链已达到上限');
        let intervals: { startMs: number; endMs: number }[] = [],
          confirmation: string | null = null,
          sourceJob: Row | null = null;
        if (b.type === 'HIGHLIGHTS') {
          sourceJob =
            (
              await c.query<Row>(
                "SELECT * FROM live_media_jobs WHERE org_id=$1 AND id=$2 AND kind='RECORDING' AND anchor_verified_by IS NOT NULL FOR SHARE",
                [org, artifact.job_id],
              )
            ).rows[0] ?? null;
          if (!sourceJob) liveFail('MEDIA_ANCHOR_REQUIRED', '录像须先人工校准PTS与赛事时间');
          confirmation = await this.resultProof(c, s);
          const events = (
            await c.query<Row>(
              `SELECT e.captured_at,e.server_time FROM scoring_events e WHERE e.org_id=$1 AND e.match_id=$2 AND e.type='STAT_RECORDED' AND e.payload->>'kind'='SCORE' AND NOT e.payload?'reason' AND NOT EXISTS(SELECT 1 FROM scoring_events v WHERE v.org_id=e.org_id AND v.match_id=e.match_id AND v.target_event_id=e.id AND v.type IN('STAT_VOIDED','PRO_STAT_VOIDED')) ORDER BY e.seq`,
              [org, s.match_id],
            )
          ).rows;
          intervals = highlightIntervals(
            events.map((e) => ({
              capturedAt: iso(e.captured_at)!,
              serverTime: iso(e.server_time)!,
              effective: true,
            })),
            iso(sourceJob!.anchor_at)!,
            sourceJob!.anchor_offset_ms,
            artifact.duration_ms,
          );
          if (!intervals.length) liveFail('MEDIA_NO_CALIBRATED_EVENTS', '没有可校准的有效得分事件');
        }
        await this.mediaCapacity(c, org);
        const id = randomUUID();
        await c.query(
          'INSERT INTO live_media_jobs(id,org_id,session_id,created_by,kind,source_epoch,source_artifact_id,intervals,anchor_at,anchor_offset_ms,anchor_verified_by,source_match_id,source_confirmation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          [
            id,
            org,
            session,
            a.ctx.user.id,
            b.type,
            artifact.source_epoch ?? s.source_epoch,
            artifact.id,
            JSON.stringify(intervals),
            sourceJob?.anchor_at ?? null,
            sourceJob?.anchor_offset_ms ?? null,
            sourceJob?.anchor_verified_by ?? null,
            s.match_id,
            confirmation,
          ],
        );
        result = { jobId: id };
      } else if (['PUBLISH', 'REVOKE'].includes(String(b.type))) {
        const artifact = (
          await c.query<Row>(
            'SELECT a.*,j.created_by,j.source_confirmation_id,j.source_match_id,j.kind FROM live_media_artifacts a JOIN live_media_jobs j ON j.org_id=a.org_id AND j.id=a.job_id WHERE a.org_id=$1 AND a.session_id=$2 AND a.id=$3 FOR UPDATE OF a',
            [org, session, resourceId(String(b.artifactId))],
          )
        ).rows[0];
        if (!artifact) throw notFound();
        if (artifact.version !== b.expectedVersion) liveFail('VERSION_CONFLICT');
        if (b.type === 'PUBLISH') {
          if (
            !s.recording_approved_at ||
            s.rights_revoked_at ||
            artifact.revoked_at ||
            artifact.created_by === a.ctx.user.id
          )
            liveFail('MEDIA_INDEPENDENT_PUBLICATION_REQUIRED', '需要独立审核人与当前录像授权');
          if (
            artifact.kind === 'HIGHLIGHTS' &&
            (await this.resultProof(c, s)) !== artifact.source_confirmation_id
          )
            liveFail('MEDIA_SOURCE_CHANGED');
          await this.artifactLineage(c, artifact);
          const key = randomBytes(24).toString('base64url');
          await c.query(
            'UPDATE live_media_artifacts SET public_key=$2,published_by=$3,published_at=clock_timestamp(),version=version+1 WHERE id=$1',
            [artifact.id, key, a.ctx.user.id],
          );
          result = { artifactId: artifact.id, publicKey: key };
        } else {
          await c.query(
            'UPDATE live_media_artifacts SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1',
            [artifact.id],
          );
          result = { artifactId: artifact.id };
        }
      } else if (b.type === 'CANCEL_JOB') {
        const j = (
          await c.query<Row>(
            "UPDATE live_media_jobs SET cancel_requested_at=clock_timestamp(),status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END,version=version+1 WHERE org_id=$1 AND session_id=$2 AND id=$3 AND version=$4 AND status IN('QUEUED','RUNNING') RETURNING *",
            [org, session, resourceId(String(b.jobId)), b.expectedVersion],
          )
        ).rows[0];
        if (!j) liveFail('VERSION_CONFLICT');
        result = { jobId: j.id };
      } else liveFail('INVALID_MEDIA_COMMAND', '无效媒体操作', 422);
      await this.audit(c, a.ctx.user.id, org, 'MEDIA_' + String(b.type), 'broadcast', session, {});
      await c.query(
        'INSERT INTO stream_command_receipts(id,org_id,actor_id,request_hash,session_id,result) VALUES($1,$2,$3,$4,$5,$6)',
        [b.clientRequestId, org, a.ctx.user.id, fingerprint, session, result!],
      );
      await this.ensureFreshSession(c, a.ctx);
      return result!;
    });
  }
  private async mediaCapacity(c: PoolClient, org: string) {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('e02-media-capacity'))");
    if (
      Number(
        (
          await c.query<Row>(
            "SELECT count(*) AS n FROM live_media_jobs WHERE org_id=$1 AND status IN('QUEUED','RUNNING')",
            [org],
          )
        ).rows[0]!.n,
      ) >= 10
    )
      liveFail('MEDIA_QUEUE_FULL', '媒体队列已满', 429);
  }
  private async recordingEligibility(c: PoolClient, s: Row) {
    await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE NOWAIT', [
      s.org_id,
      s.event_id,
    ]);
    if (
      !this.config.authorizeRecording ||
      !(await this.config.authorizeRecording(c, {
        orgId: s.org_id,
        eventId: s.event_id,
        matchId: s.match_id,
        purpose: 'LIVE_RECORDING',
      }))
    )
      liveFail('LIVE_RECORDING_ELIGIBILITY_REQUIRED', '当前参赛者的直播与录像专项资格未确认');
  }
  private async mediaRights(c: PoolClient, job: Row) {
    const s = (
      await c.query<Row>(
        `SELECT s.* FROM broadcast_sessions s JOIN organizations o ON o.id=s.org_id JOIN users u ON u.id=$2 JOIN organization_memberships um ON um.org_id=s.org_id AND um.user_id=u.id JOIN users au ON au.id=s.recording_approved_by JOIN organization_memberships am ON am.org_id=s.org_id AND am.user_id=au.id
      WHERE s.id=$1 AND s.recording_approved_at IS NOT NULL AND s.rights_revoked_at IS NULL AND o.status='ACTIVE' AND u.status='ACTIVE' AND um.status='ACTIVE' AND au.status='ACTIVE' AND am.status='ACTIVE'
      AND (um.role IN('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff f WHERE f.org_id=s.org_id AND f.event_id=s.event_id AND f.user_id=u.id AND f.status='ACTIVE' AND (f.role='EVENT_MANAGER' OR ($3='RECORDING' AND f.role='STREAMER'))))
      AND (am.role IN('ORG_OWNER','ORG_ADMIN') OR EXISTS(SELECT 1 FROM event_staff f WHERE f.org_id=s.org_id AND f.event_id=s.event_id AND f.user_id=au.id AND f.status='ACTIVE' AND f.role='EVENT_MANAGER'))`,
        [job.session_id, job.created_by, job.kind],
      )
    ).rows[0];
    if (!s) throw Error('MEDIA_RIGHTS_REVOKED');
    await this.recordingEligibility(c, s);
    if (job.source_artifact_id) {
      const source = (
        await c.query<Row>(
          'SELECT * FROM live_media_artifacts WHERE org_id=$1 AND session_id=$2 AND id=$3',
          [s.org_id, s.id, job.source_artifact_id],
        )
      ).rows[0];
      if (!source) throw Error('MEDIA_SOURCE_CHANGED');
      await this.artifactLineage(c, source);
    }
    if (job.kind === 'HIGHLIGHTS' && (await this.resultProof(c, s)) !== job.source_confirmation_id)
      throw Error('MEDIA_SOURCE_CHANGED');
    return s;
  }
  private async mediaDrain() {
    if (this.closing || !this.config.executor || !this.ready()) return;
    await this.pool.query(
      "UPDATE live_media_jobs SET status='FAILED',error_code='WORKER_RESULT_UNKNOWN',version=version+1 WHERE status='RUNNING' AND worker_until<=clock_timestamp()",
    );
    const token = randomUUID(),
      job = await this.transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('e02-media-capacity'))");
        if (
          Number(
            (await c.query<Row>("SELECT count(*) AS n FROM live_media_jobs WHERE status='RUNNING'"))
              .rows[0]!.n,
          ) >= 2
        )
          return null;
        const j = (
          await c.query<Row>(
            "SELECT * FROM live_media_jobs WHERE status='QUEUED' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
          )
        ).rows[0];
        if (!j) return null;
        return (
          await c.query<Row>(
            "UPDATE live_media_jobs SET status='RUNNING',worker_token=$2,worker_until=clock_timestamp()+interval '20 seconds',version=version+1 WHERE id=$1 RETURNING *",
            [j.id, token],
          )
        ).rows[0]!;
      });
    if (!job) return;
    const execute = async () => {
      const controller = new AbortController();
      this.mediaControllers.add(controller);
      let timer: ReturnType<typeof setInterval> | undefined;
      let output: ArtifactResult | undefined;
      try {
        const s = await this.transaction((c) => this.mediaRights(c, job));
        const current = () =>
          this.transaction(async (c) => {
            await this.mediaRights(c, job);
            if (job.kind === 'RECORDING') {
              const live = await this.workerSource(c, s.id);
              if (!live?.authorized || live.source_epoch !== job.source_epoch)
                throw Error('MEDIA_SOURCE_CHANGED');
            }
            if (
              !(
                await c.query(
                  "UPDATE live_media_jobs SET worker_until=clock_timestamp()+interval '20 seconds' WHERE id=$1 AND worker_token=$2 AND status='RUNNING' AND cancel_requested_at IS NULL AND worker_until>clock_timestamp() RETURNING id",
                  [job.id, token],
                )
              ).rowCount
            )
              throw Error('MEDIA_WORKER_FENCED');
          });

        await current();
        timer = setInterval(() => void current().catch(() => controller.abort()), 1000);
        timer.unref();
        if (job.kind === 'RECORDING') {
          const live = await this.transaction((c) => this.workerSource(c, s.id));
          if (!live?.authorized || live.source_epoch !== job.source_epoch)
            throw Error('MEDIA_SOURCE_CHANGED');
          const lease = this.config.ingress!.lease(
            live.source_stream_name,
            new Date(live.source_expires_at),
          );
          output = await this.config.executor!.record(
            lease.pullUrl,
            Math.max(
              1,
              Math.floor(
                s.maximum_seconds - (Date.now() - new Date(s.started_at).getTime()) / 1000,
              ),
            ),
            controller.signal,
          );
        } else {
          const source = (
            await this.pool.query<Row>(
              'SELECT * FROM live_media_artifacts WHERE org_id=$1 AND session_id=$2 AND id=$3 AND revoked_at IS NULL',
              [s.org_id, s.id, job.source_artifact_id],
            )
          ).rows[0];
          if (!source) throw Error('MEDIA_SOURCE_CHANGED');
          output = await this.config.executor!.transform(
            source.file_name,
            job.intervals,
            controller.signal,
          );
        }
        await this.transaction(async (c) => {
          await this.mediaRights(c, job);
          const locked = (
            await c.query<Row>(
              "SELECT * FROM live_media_jobs WHERE id=$1 AND worker_token=$2 AND status='RUNNING' AND cancel_requested_at IS NULL AND worker_until>clock_timestamp() FOR UPDATE",
              [job.id, token],
            )
          ).rows[0];
          if (!locked) throw Error('MEDIA_WORKER_FENCED');
          const id = randomUUID();
          await c.query(
            'INSERT INTO live_media_artifacts(id,org_id,session_id,job_id,file_name,sha256,byte_length,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              id,
              s.org_id,
              s.id,
              job.id,
              output!.fileName,
              output!.sha256,
              output!.byteLength,
              output!.durationMs,
            ],
          );
          await c.query(
            "UPDATE live_media_jobs SET status='READY',artifact_id=$2,worker_until=NULL,version=version+1 WHERE id=$1",
            [job.id, id],
          );
        });
      } catch {
        if (output) await this.config.executor!.discard(output.fileName).catch(() => {});
        await this.pool.query(
          "UPDATE live_media_jobs SET status=CASE WHEN cancel_requested_at IS NOT NULL THEN 'CANCELLED' ELSE 'FAILED' END,error_code=CASE WHEN cancel_requested_at IS NOT NULL THEN NULL ELSE 'MEDIA_EXECUTION_FAILED' END,worker_until=NULL,version=version+1 WHERE id=$1 AND worker_token=$2 AND status='RUNNING'",
          [job.id, token],
        );
      } finally {
        if (timer) clearInterval(timer);
        this.mediaControllers.delete(controller);
      }
    };
    const task = execute();
    this.mediaTasks.add(task);
    void task.finally(() => this.mediaTasks.delete(task)).catch(() => {});
  }
  async artifact(cookie: string | undefined, org: string, session: string, id: string) {
    if (!this.config.executor) throw notFound();
    return this.transaction(async (c) => {
      const { a, s } = await this.mediaAccess(c, cookie, org, session);
      const r = (
        await c.query<Row>(
          'SELECT * FROM live_media_artifacts WHERE org_id=$1 AND session_id=$2 AND id=$3 AND revoked_at IS NULL',
          [org, session, resourceId(id)],
        )
      ).rows[0];
      if (!r || s.rights_revoked_at) throw notFound();
      await this.recordingEligibility(c, s);
      await this.artifactLineage(c, r);
      await this.ensureFreshSession(c, a.ctx);
      return {
        path: await this.config.executor!.file(r.file_name),
        byteLength: Number(r.byte_length),
        sha256: r.sha256,
      };
    });
  }
  async publicArtifact(key: string) {
    if (!this.config.executor) throw notFound();
    if (!/^[A-Za-z0-9_-]{32}$/.test(key)) throw notFound();
    return this.transaction(async (c) => {
      const r = (
        await c.query<Row>(
          `SELECT a.*,s.match_id,s.event_id,s.recording_approved_at,s.rights_revoked_at,j.kind,j.source_confirmation_id,o.status AS org_status FROM live_media_artifacts a JOIN broadcast_sessions s ON s.org_id=a.org_id AND s.id=a.session_id JOIN live_media_jobs j ON j.id=a.job_id JOIN organizations o ON o.id=a.org_id WHERE a.public_key=$1 AND a.revoked_at IS NULL`,
          [key],
        )
      ).rows[0];
      if (!r || r.org_status !== 'ACTIVE' || !r.recording_approved_at || r.rights_revoked_at)
        throw notFound();
      try {
        await this.recordingEligibility(c, r);
        await this.artifactLineage(c, r);
      } catch {
        throw notFound();
      }
      if (r.kind === 'HIGHLIGHTS') {
        try {
          if (
            (await this.resultProof(c, { org_id: r.org_id, match_id: r.match_id })) !==
            r.source_confirmation_id
          )
            throw notFound();
        } catch {
          throw notFound();
        }
      }
      return {
        path: await this.config.executor!.file(r.file_name),
        byteLength: Number(r.byte_length),
        sha256: r.sha256,
      };
    });
  }
  async onModuleDestroy() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const c of this.mediaControllers) c.abort();
    await this.drainCompletion;
    if (this.config.executor)
      await Promise.all(
        [...this.localRelayKeys].map((key) => this.config.executor!.stop(key).catch(() => false)),
      );
    await Promise.allSettled([...this.mediaTasks]);
  }
}
