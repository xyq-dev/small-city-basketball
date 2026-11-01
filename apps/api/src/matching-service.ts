import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ApplicationService } from './service.js';
import type { Actor, ApiOptions } from './service.js';
import { forbidden, notFound } from './errors.js';
import { invalid, objectInput, text } from './validation.js';
import { localCommandId } from './local-services-domain.js';
import { insideAvailability, quote } from './player-booking/domain.js';
import {
  matchingFail,
  matchingHash,
  matchingId,
  matchingInteger,
  matchingKind,
  matchingRegions,
  matchingScore,
  matchingWindows,
  parseMatchingNeed,
  rankMatching,
} from './matching-domain.js';
import type {
  MatchingCandidateData,
  MatchingIntentData,
  MatchingKind,
  MatchingNeedData,
  MatchingWindow,
} from '../../../packages/contracts/matching.js';
import type { MatchingConversionInput, MatchingSourceHooks } from './matching-source-adapter.js';

interface Need {
  id: string;
  owner_id: string;
  org_id: string;
  team_id: string | null;
  kind: MatchingKind;
  title: string;
  address: string;
  region_id: string;
  region_catalog_version: string;
  allowed_region_ids: string[];
  role: string;
  quantity: number;
  windows: MatchingWindow[];
  unit_budget_fen: number;
  total_budget_fen: number;
  max_travel_minutes: number;
  status: MatchingNeedData['status'];
  expires_at: Date;
  version: number;
  latest_run_id: string | null;
}
interface Preference {
  source_kind: MatchingKind;
  source_id: string;
  owner_id: string;
  org_id: string | null;
  region_id: string;
  region_catalog_version: string;
  allowed_region_ids: string[];
  discovery_enabled: boolean;
  contact_enabled: boolean;
  adult_confirmed: boolean;
  availability: MatchingWindow[];
  version: number;
}
interface Candidate {
  id: string;
  need_id: string;
  run_id: string;
  source_id: string;
  source_org_id: string | null;
  source_user_id: string;
  source_version: number;
  source_slot_id: string | null;
  preference_version: number;
  created_at: Date;
  snapshot: MatchingCandidateData & { fingerprint: string };
}
interface Intent {
  id: string;
  need_id: string;
  slot_id: string;
  candidate_id: string;
  generation: number;
  need_version: number;
  receiver_id: string;
  status: MatchingIntentData['status'];
  expires_at: Date;
  version: number;
  source_kind: string | null;
  source_id: string | null;
}
interface Slot {
  id: string;
  need_id: string;
  seat_no: number;
  generation: number;
  state: string;
}
interface Source {
  id: string;
  ownerId: string;
  orgId: string | null;
  version: number;
  name: string;
  role: string;
  availability: { startAt: string; endAt: string }[];
  price: number | null;
  slotId: string | null;
  fingerprint: string;
  settingsVersion?: number;
}
export interface MatchingRuntime {
  enabled?: boolean;
  sourceHooks?: MatchingSourceHooks;
}
type Result = {
  resourceType: string;
  resourceId: string;
  version: number;
  needId?: string;
  sourceKind?: string;
  sourceId?: string;
};
const iso = (v: Date | string) => new Date(v).toISOString();
const activeIntent = (x: Intent) => ['PENDING', 'MUTUAL_INTEREST'].includes(x.status);

/** All locks for conversion: source calendar -> consent -> need -> seat -> intent. */
export class MatchingService extends ApplicationService {
  constructor(
    pool: Pool,
    options: ApiOptions,
    private readonly runtime: MatchingRuntime = {},
  ) {
    super(pool, options);
  }
  private async gate(c: PoolClient) {
    if (!this.runtime.enabled) matchingFail('MATCHING_DISABLED', '撮合尚未开放', 503);
    const r = await c.query(
      "SELECT 1 FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore' LIMIT 1",
    );
    if (r.rowCount)
      matchingFail('MATCHING_RESTORE_QUARANTINE', '恢复隔离中，暂不接受撮合操作', 503);
  }
  private async command(
    c: PoolClient,
    a: Actor,
    id: string,
    payload: unknown,
  ): Promise<Result | null> {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4401))', [
      a.user.id + ':' + id,
    ]);
    const r = await c.query<{ request_hash: string; result: Result }>(
      'SELECT request_hash,result FROM matching_command_receipts WHERE actor_id=$1 AND command_id=$2',
      [a.user.id, id],
    );
    if (!r.rows[0]) return null;
    if (r.rows[0].request_hash !== matchingHash(payload))
      matchingFail('MATCHING_COMMAND_CONFLICT', '同一操作编号不能用于不同内容');
    return r.rows[0].result;
  }
  private async finish(c: PoolClient, a: Actor, id: string, payload: unknown, result: Result) {
    await this.ensureFreshSession(c, a);
    await c.query(
      'INSERT INTO matching_command_receipts(actor_id,command_id,request_hash,result) VALUES($1,$2,$3,$4::jsonb)',
      [a.user.id, id, matchingHash(payload), JSON.stringify(result)],
    );
    return result;
  }
  private async authority(
    c: PoolClient,
    userId: string,
    orgId: string,
    teamId: string | null,
    teamGrantRequired = false,
  ) {
    const r = await c.query(
      `SELECT 1 FROM organizations o JOIN users au ON au.id=$1 AND au.status='ACTIVE' WHERE o.id=$2 AND o.status='ACTIVE' AND
   ((NOT $4::boolean AND EXISTS(SELECT 1 FROM organization_memberships m WHERE m.org_id=o.id AND m.user_id=$1 AND m.status='ACTIVE' AND m.role IN('ORG_OWNER','ORG_ADMIN')))
    OR ($3::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM team_access_grants g WHERE g.org_id=o.id AND g.team_id=$3 AND g.user_id=$1 AND g.status='ACTIVE')))
   AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM teams t WHERE t.org_id=o.id AND t.id=$3))`,
      [userId, orgId, teamId, teamGrantRequired],
    );
    return !!r.rowCount;
  }
  private async manage(c: PoolClient, a: Actor, n: Need) {
    if (
      n.owner_id !== a.user.id ||
      !(await this.authority(c, a.user.id, n.org_id, n.team_id, n.kind === 'TEAM_MATCHUP'))
    )
      throw notFound();
  }
  private async need(c: PoolClient, id: string, lock = false) {
    const r = await c.query<Need>(
      'SELECT * FROM matching_needs WHERE id=$1' + (lock ? ' FOR UPDATE' : ''),
      [id],
    );
    if (!r.rows[0]) throw notFound();
    return r.rows[0];
  }
  private async current(c: PoolClient, n: Need) {
    const r = await c.query(
      'SELECT $1::timestamptz>clock_timestamp() AND $2::timestamptz>clock_timestamp() AS valid',
      [n.expires_at, n.windows[0]!.reportAt],
    );
    if (n.status !== 'ACTIVE' || !r.rows[0]?.valid)
      matchingFail('MATCHING_NEED_INACTIVE', '需求已暂停、关闭或过期');
  }
  private version(actual: number, expected: unknown) {
    if (actual !== matchingInteger(expected, 1, 2147483647, '版本'))
      matchingFail('MATCHING_VERSION_CONFLICT', '资料已更新，请刷新后重新确认');
  }
  private async region(c: PoolClient, version: string, region: string, scopes: string[]) {
    const r = await c.query(
      'SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=ANY($2::uuid[])',
      [version, [...new Set([region, ...scopes])]],
    );
    if (r.rowCount !== new Set([region, ...scopes]).size) invalid('地区目录版本或地区编号无效');
  }
  private async preference(
    c: PoolClient,
    kind: MatchingKind,
    id: string,
  ): Promise<Preference | null> {
    return (
      (
        await c.query<Preference>(
          'SELECT * FROM matching_supply_preferences WHERE source_kind=$1 AND source_id=$2',
          [kind, id],
        )
      ).rows[0] ?? null
    );
  }
  private async consentLock(c: PoolClient, kind: MatchingKind, id: string) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4402))', [kind + ':' + id]);
  }
  private async source(c: PoolClient, p: Preference, n?: Need): Promise<Source | null> {
    if (!p.adult_confirmed) return null;
    if (p.source_kind === 'ADULT_PLAYER') {
      const r = await c.query(
        `SELECT p.*,s.fee_bps,s.version AS settings_version FROM booking_profiles p JOIN users u ON u.id=p.user_id AND u.status='ACTIVE' CROSS JOIN booking_settings s WHERE p.id=$1 AND p.user_id=$2 AND p.status='APPROVED'`,
        [p.source_id, p.owner_id],
      );
      const x = r.rows[0];
      if (!x) return null;
      const price =
        quote(x.price_fen, x.travel_fen, x.accommodation_fen, x.fee_bps).totalFen *
        (n?.windows.length ?? 1);
      return {
        id: x.id,
        ownerId: x.user_id,
        orgId: null,
        version: x.version,
        name: x.display_name,
        role: x.position,
        availability: x.availability,
        price,
        slotId: null,
        fingerprint: matchingHash([x.version, x.settings_version, x.availability, price]),
        settingsVersion: x.settings_version,
      };
    }
    if (p.source_kind === 'TEAM_MATCHUP') {
      const r = await c.query(
        "SELECT t.* FROM teams t JOIN organizations o ON o.id=t.org_id AND o.status='ACTIVE' WHERE t.id=$1",
        [p.source_id],
      );
      const x = r.rows[0];
      if (!x || !(await this.authority(c, p.owner_id, x.org_id, x.id, true))) return null;
      return {
        id: x.id,
        ownerId: p.owner_id,
        orgId: x.org_id,
        version: x.version,
        name: x.name,
        role: 'TEAM',
        availability: p.availability.map((w) => ({ startAt: w.reportAt, endAt: w.endAt })),
        price: 0,
        slotId: null,
        fingerprint: matchingHash([x.version, p.version]),
      };
    }
    const r = await c.query(
      `SELECT l.* FROM local_listings l JOIN users u ON u.id=l.provider_user_id AND u.status='ACTIVE' JOIN organizations o ON o.id=l.org_id AND o.status='ACTIVE'
   WHERE l.id=$1 AND l.provider_user_id=$2 AND l.status='APPROVED' AND l.published AND l.provider_confirmed AND l.qualified_until>COALESCE($3::timestamptz,clock_timestamp())`,
      [p.source_id, p.owner_id, n?.windows.at(-1)?.endAt ?? null],
    );
    const x = r.rows[0];
    if (!x || x.region_id !== p.region_id || x.region_catalog_version !== p.region_catalog_version)
      return null;
    if (!['REFEREE', 'SCORER', 'RECORDER', 'STREAMER', 'PHOTOGRAPHER'].includes(x.kind))
      return null;
    if (n) {
      const coverage = await c.query(
        `WITH RECURSIVE ancestors AS(SELECT region_id,parent_region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2 UNION ALL SELECT t.region_id,t.parent_region_id FROM region_catalog_nodes t JOIN ancestors a ON t.region_id=a.parent_region_id WHERE t.catalog_version=$1) SELECT 1 FROM ancestors WHERE region_id=ANY($3::uuid[]) LIMIT 1`,
        [n.region_catalog_version, n.region_id, x.coverage_region_ids],
      );
      if (!coverage.rowCount) return null;
    }
    const slots = await c.query(
      `SELECT id,starts_at,ends_at,version FROM local_slots WHERE listing_id=$1 AND status='OPEN' AND starts_at>clock_timestamp() AND ($2::timestamptz IS NULL OR (starts_at=$2 AND ends_at=$3)) ORDER BY starts_at,id LIMIT 100`,
      [x.id, n?.windows[0]?.reportAt ?? null, n?.windows[0]?.endAt ?? null],
    );
    if (n && !slots.rowCount) return null;
    const terms = await c.query(
      "SELECT id,amount_fen,version FROM trade_terms WHERE kind='LOCAL_BOOKING' AND source_id=$1 AND status='ACTIVE' ORDER BY created_at DESC,id DESC LIMIT 1",
      [x.id],
    );
    const term = terms.rows[0];
    return {
      id: x.id,
      ownerId: x.provider_user_id,
      orgId: x.org_id,
      version: x.version,
      name: x.title,
      role: x.kind,
      availability: slots.rows.map((s) => ({ startAt: iso(s.starts_at), endAt: iso(s.ends_at) })),
      price: term?.amount_fen ?? null,
      slotId: n ? (slots.rows[0]?.id ?? null) : null,
      fingerprint: matchingHash([
        x.version,
        slots.rows.map((s) => [s.id, s.version]),
        term ?? null,
      ]),
    };
  }
  private async calendarClear(c: PoolClient, n: Need, s: Source) {
    for (const w of n.windows) {
      const r = await c.query(
        `SELECT 1 FROM local_resource_reservations r LEFT JOIN local_bookings b ON b.id=r.booking_id LEFT JOIN local_matchups m ON m.id=r.matchup_id
    WHERE r.active AND r.resource_key=ANY($1::text[]) AND r.starts_at<$3::timestamptz+interval '30 minutes' AND r.ends_at>$2::timestamptz
    AND (b.id IS NULL OR b.status NOT IN('HELD','REQUESTED') OR b.hold_expires_at>clock_timestamp())
    AND (m.id IS NULL OR m.status<>'OPEN' OR m.expires_at>clock_timestamp()) LIMIT 1`,
        [
          [`user:${s.ownerId}`, ...(n.kind === 'TEAM_MATCHUP' ? [`team:${s.id}`] : [])],
          w.reportAt,
          w.endAt,
        ],
      );
      if (r.rowCount) return false;
      // Training rows already include their own buffer. Only expired HOLDING
      // enrollments are logically released, exactly as in x12_release_expired;
      // a confirmed enrollment's old hold deadline must not free its calendar.
      const training = await c.query(
        `SELECT 1 FROM training_resource_reservations r
    WHERE r.active AND r.resource_key=$1
    AND tstzrange(r.starts_at,r.ends_at,'[)') && c06_booking_window($2::timestamptz,$3::timestamptz)
    AND NOT EXISTS(SELECT 1 FROM training_enrollments e WHERE e.id=r.enrollment_id AND e.state='HOLDING' AND e.hold_expires_at<=clock_timestamp()) LIMIT 1`,
        [`user:${s.ownerId}`, w.reportAt, w.endAt],
      );
      if (training.rowCount) return false;
      const booked = await c.query(
        `SELECT 1 FROM booking_appearances WHERE player_user_id=$1 AND status IN('REQUESTED','ACCEPTED','ARRIVED','COMPLETED','DISPUTED') AND (status<>'REQUESTED' OR expires_at>clock_timestamp()) AND c06_booking_window(report_at,end_at)&&c06_booking_window($2::timestamptz,$3::timestamptz) LIMIT 1`,
        [s.ownerId, w.reportAt, w.endAt],
      );
      if (booked.rowCount) return false;
      if (n.kind === 'TEAM_MATCHUP') {
        const team = await c.query(
          'SELECT 1 FROM team_reservations WHERE team_id=$1 AND starts_at<$3::timestamptz AND ends_at>$2::timestamptz LIMIT 1',
          [s.id, w.reportAt, w.endAt],
        );
        if (team.rowCount) return false;
      }
    }
    return true;
  }
  private async eligible(c: PoolClient, n: Need, p: Preference): Promise<Source | null> {
    if (
      !p.discovery_enabled ||
      !p.contact_enabled ||
      p.owner_id === n.owner_id ||
      p.source_id === n.team_id ||
      p.region_catalog_version !== n.region_catalog_version ||
      !p.allowed_region_ids.includes(n.region_id) ||
      !n.allowed_region_ids.includes(p.region_id)
    )
      return null;
    const s = await this.source(c, p, n);
    if (!s || s.role !== n.role || (s.price !== null && s.price > n.unit_budget_fen)) return null;
    if (
      !n.windows.every((w) => insideAvailability(s.availability, w.reportAt, w.endAt)) ||
      !(await this.calendarClear(c, n, s))
    )
      return null;
    return s;
  }
  private async revalidate(c: PoolClient, n: Need, can: Candidate) {
    const age = await c.query(
      "SELECT $1::timestamptz > clock_timestamp()-interval '24 hours' AS valid",
      [can.created_at],
    );
    if (!age.rows[0]?.valid)
      matchingFail('MATCHING_CANDIDATE_STALE', '候选快照已超过24小时，请重新匹配');
    const p = await this.preference(c, n.kind, can.source_id);
    const s = p && (await this.eligible(c, n, p));
    if (
      !p ||
      !s ||
      p.version !== can.preference_version ||
      s.version !== can.source_version ||
      s.ownerId !== can.source_user_id ||
      s.slotId !== can.source_slot_id ||
      s.fingerprint !== can.snapshot.fingerprint
    )
      matchingFail('MATCHING_CANDIDATE_STALE', '候选资格、档期、报价或联系授权已变化，请重新匹配');
    return s;
  }
  async create(cookie: string | undefined, raw: unknown) {
    const x = parseMatchingNeed(raw);
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.gate(c);
      const old = await this.command(c, a, x.commandId, x);
      if (old) return old;
      if (
        !(await this.authority(c, a.user.id, x.orgId, x.teamId ?? null, x.kind === 'TEAM_MATCHUP'))
      )
        throw notFound();
      await this.region(c, x.catalogVersion, x.regionId, x.allowedRegionIds);
      const time = await c.query(
        "SELECT $1::timestamptz>clock_timestamp() AND $2::timestamptz<clock_timestamp()+interval '730 days' AS valid",
        [x.expiresAt, x.windows.at(-1)!.endAt],
      );
      if (!time.rows[0]?.valid) invalid('需求须为未来两年内，截止时间尚未到达');
      const id = randomUUID();
      await c.query(
        `INSERT INTO matching_needs(id,owner_id,org_id,team_id,kind,title,address,region_catalog_version,region_id,allowed_region_ids,role,quantity,windows,unit_budget_fen,total_budget_fen,max_travel_minutes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17)`,
        [
          id,
          a.user.id,
          x.orgId,
          x.teamId ?? null,
          x.kind,
          x.title,
          x.address,
          x.catalogVersion,
          x.regionId,
          x.allowedRegionIds,
          x.role,
          x.quantity,
          JSON.stringify(x.windows),
          x.unitBudgetFen,
          x.totalBudgetFen,
          x.maxTravelMinutes,
          x.expiresAt,
        ],
      );
      for (let seat = 1; seat <= x.quantity; seat++)
        await c.query('INSERT INTO matching_demand_slots(id,need_id,seat_no) VALUES($1,$2,$3)', [
          randomUUID(),
          id,
          seat,
        ]);
      await this.audit(c, a.user.id, x.orgId, 'MATCHING_NEED_CREATED', 'matching_need', id, {
        kind: x.kind,
        quantity: x.quantity,
      });
      return this.finish(c, a, x.commandId, x, {
        resourceType: 'MATCHING_NEED',
        resourceId: id,
        version: 1,
      });
    });
  }
  async setPreference(cookie: string | undefined, raw: unknown) {
    const b = objectInput(raw, [
      'commandId',
      'kind',
      'sourceId',
      'expectedVersion',
      'regionId',
      'catalogVersion',
      'allowedRegionIds',
      'discoveryEnabled',
      'contactEnabled',
      'adultConfirmed',
      'availability',
    ]);
    if (
      typeof b.discoveryEnabled !== 'boolean' ||
      typeof b.contactEnabled !== 'boolean' ||
      b.adultConfirmed !== true
    )
      invalid('请明确成人与发现、联系授权');
    const x = {
      commandId: localCommandId(b.commandId),
      kind: matchingKind(b.kind),
      sourceId: matchingId(b.sourceId),
      expectedVersion: matchingInteger(b.expectedVersion, 0, 2147483647, '版本'),
      regionId: matchingId(b.regionId),
      catalogVersion: text(b.catalogVersion, 'catalogVersion', 1, 120),
      allowedRegionIds: matchingRegions(b.allowedRegionIds),
      discoveryEnabled: b.discoveryEnabled,
      contactEnabled: b.contactEnabled,
      adultConfirmed: true,
      availability: matchingKind(b.kind) === 'TEAM_MATCHUP' ? matchingWindows(b.availability) : [],
    };
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.gate(c);
      const old = await this.command(c, a, x.commandId, x);
      if (old) return old;
      await this.consentLock(c, x.kind, x.sourceId);
      const previous = await this.preference(c, x.kind, x.sourceId);
      // A revoked former manager cannot replace the new manager's preference.
      const provisional: Preference = {
        source_kind: x.kind,
        source_id: x.sourceId,
        owner_id: a.user.id,
        org_id: null,
        region_id: x.regionId,
        region_catalog_version: x.catalogVersion,
        allowed_region_ids: x.allowedRegionIds,
        discovery_enabled: x.discoveryEnabled,
        contact_enabled: x.contactEnabled,
        adult_confirmed: true,
        availability: x.availability,
        version: previous?.version ?? 0,
      };
      const src = await this.source(c, provisional);
      if (!src) throw notFound();
      if (previous && previous.owner_id !== a.user.id && (await this.source(c, previous)))
        throw forbidden();
      if ((previous?.version ?? 0) !== x.expectedVersion)
        matchingFail('MATCHING_VERSION_CONFLICT', '授权资料已更新');
      await this.region(c, x.catalogVersion, x.regionId, x.allowedRegionIds);
      await c.query(
        `INSERT INTO matching_supply_preferences(source_kind,source_id,owner_id,org_id,region_catalog_version,region_id,allowed_region_ids,discovery_enabled,contact_enabled,adult_confirmed,availability) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10::jsonb) ON CONFLICT(source_kind,source_id) DO UPDATE SET owner_id=excluded.owner_id,org_id=excluded.org_id,region_catalog_version=excluded.region_catalog_version,region_id=excluded.region_id,allowed_region_ids=excluded.allowed_region_ids,discovery_enabled=excluded.discovery_enabled,contact_enabled=excluded.contact_enabled,availability=excluded.availability,version=matching_supply_preferences.version+1,updated_at=clock_timestamp()`,
        [
          x.kind,
          x.sourceId,
          a.user.id,
          src.orgId,
          x.catalogVersion,
          x.regionId,
          x.allowedRegionIds,
          x.discoveryEnabled,
          x.contactEnabled,
          JSON.stringify(x.availability),
        ],
      );
      if (!x.contactEnabled || !x.discoveryEnabled)
        await c.query(
          "UPDATE matching_outbox SET state='CANCELLED' WHERE recipient_id=$1 AND state='PENDING' AND intent_id IN(SELECT i.id FROM matching_intents i JOIN matching_candidates k ON k.id=i.candidate_id JOIN matching_needs n ON n.id=i.need_id WHERE n.kind=$2 AND k.source_id=$3)",
          [a.user.id, x.kind, x.sourceId],
        );
      return this.finish(c, a, x.commandId, x, {
        resourceType: 'MATCHING_PREFERENCE',
        resourceId: x.sourceId,
        version: x.expectedVersion + 1,
      });
    });
  }
  async run(cookie: string | undefined, idRaw: string, raw: unknown) {
    const b = objectInput(raw, ['commandId', 'expectedVersion']);
    const x = {
      id: matchingId(idRaw),
      commandId: localCommandId(b.commandId),
      expectedVersion: matchingInteger(b.expectedVersion, 1, 2147483647, '版本'),
    };
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.gate(c);
      const old = await this.command(c, a, x.commandId, x);
      if (old) return old;
      const n = await this.need(c, x.id, true);
      await this.manage(c, a, n);
      this.version(n.version, x.expectedVersion);
      await this.current(c, n);
      const run = randomUUID(),
        seed = randomUUID();
      const prefs = await c.query<Preference>(
        `SELECT * FROM matching_supply_preferences WHERE source_kind=$1 AND discovery_enabled AND contact_enabled AND region_catalog_version=$2 AND allowed_region_ids @> ARRAY[$3::uuid] AND region_id=ANY($4::uuid[]) ORDER BY md5(source_id::text||$5) LIMIT 201`,
        [n.kind, n.region_catalog_version, n.region_id, n.allowed_region_ids, seed],
      );
      await c.query(
        "INSERT INTO matching_runs(id,need_id,need_version,rule_version,seed,truncated,status) VALUES($1,$2,$3,'match-rules-v1',$4,$5,'READY')",
        [run, n.id, n.version, seed, prefs.rows.length > 200],
      );
      const candidates: {
        id: string;
        score: MatchingCandidateData['score'];
        p: Preference;
        s: Source;
      }[] = [];
      for (const p of prefs.rows.slice(0, 200)) {
        const s = await this.eligible(c, n, p);
        if (s)
          candidates.push({
            id: randomUUID(),
            p,
            s,
            score: matchingScore({
              budget: n.unit_budget_fen,
              price: s.price,
              free: n.kind === 'TEAM_MATCHUP',
              maxTravelMinutes: n.max_travel_minutes,
            }),
          });
      }
      if (candidates.length > 100)
        await c.query('UPDATE matching_runs SET truncated=true WHERE id=$1', [run]);
      for (const k of rankMatching(candidates, seed).slice(0, 100)) {
        const snapshot = {
          id: k.id,
          sourceId: k.s.id,
          sourceOrgId: k.s.orgId,
          sourceSlotId: k.s.slotId,
          sourceVersion: k.s.version,
          name: k.s.name,
          role: k.s.role,
          regionId: k.p.region_id,
          totalFen: k.s.price,
          score: k.score,
          needsQuote: k.s.price === null,
          crossCity: k.p.region_id !== n.region_id,
          preferenceVersion: k.p.version,
          settingsVersion: k.s.settingsVersion ?? null,
          fingerprint: k.s.fingerprint,
        };
        await c.query(
          'INSERT INTO matching_candidates(id,need_id,run_id,source_id,source_org_id,source_user_id,source_version,source_slot_id,preference_version,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)',
          [
            k.id,
            n.id,
            run,
            k.s.id,
            k.s.orgId,
            k.s.ownerId,
            k.s.version,
            k.s.slotId,
            k.p.version,
            JSON.stringify(snapshot),
          ],
        );
      }
      await c.query(
        "UPDATE matching_runs SET status='STALE' WHERE need_id=$1 AND id<>$2 AND status='READY'",
        [n.id, run],
      );
      await c.query(
        'UPDATE matching_needs SET latest_run_id=$2,updated_at=clock_timestamp() WHERE id=$1',
        [n.id, run],
      );
      return this.finish(c, a, x.commandId, x, {
        resourceType: 'MATCHING_RUN',
        resourceId: run,
        needId: n.id,
        version: n.version,
      });
    });
  }
  private async candidate(c: PoolClient, id: string, needId: string) {
    const r = await c.query<Candidate>(
      'SELECT * FROM matching_candidates WHERE id=$1 AND need_id=$2',
      [id, needId],
    );
    if (!r.rows[0]) throw notFound();
    return r.rows[0];
  }
  private async slot(c: PoolClient, id: string, needId: string) {
    const r = await c.query<Slot>(
      'SELECT * FROM matching_demand_slots WHERE id=$1 AND need_id=$2 FOR UPDATE',
      [id, needId],
    );
    if (!r.rows[0]) throw notFound();
    return r.rows[0];
  }
  private async event(c: PoolClient, n: Need, i: Intent, event: string, recipient: string) {
    await c.query(
      'INSERT INTO matching_outbox(id,need_id,intent_id,recipient_id,event,resource_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [randomUUID(), n.id, i.id, recipient, event, i.version],
    );
  }
  async sendIntent(cookie: string | undefined, idRaw: string, raw: unknown) {
    const b = objectInput(raw, ['commandId', 'expectedVersion', 'slotId', 'candidateId']);
    const x = {
      id: matchingId(idRaw),
      commandId: localCommandId(b.commandId),
      expectedVersion: matchingInteger(b.expectedVersion, 1, 2147483647, '版本'),
      slotId: matchingId(b.slotId),
      candidateId: matchingId(b.candidateId),
    };
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.gate(c);
      const old = await this.command(c, a, x.commandId, x);
      if (old) return old;
      const ref = await this.need(c, x.id),
        can = await this.candidate(c, x.candidateId, ref.id);
      await this.consentLock(c, ref.kind, can.source_id);
      const n = await this.need(c, x.id, true);
      await this.manage(c, a, n);
      this.version(n.version, x.expectedVersion);
      await this.current(c, n);
      const slot = await this.slot(c, x.slotId, n.id);
      if (slot.state !== 'OPEN' || can.run_id !== n.latest_run_id)
        matchingFail('MATCHING_SELECTION_STALE', '席位或候选列表已变化');
      await this.revalidate(c, n, can);
      const duplicate = await c.query(
        'SELECT 1 FROM matching_intents WHERE slot_id=$1 AND generation=$2 AND candidate_id=$3',
        [slot.id, slot.generation, can.id],
      );
      if (duplicate.rowCount)
        matchingFail('MATCHING_INTENT_EXISTS', '已向该候选发送意向，请查看原意向');
      const count = await c.query(
        "SELECT count(*)::integer AS n FROM matching_intents WHERE need_id=$1 AND status IN('PENDING','MUTUAL_INTEREST') AND expires_at>clock_timestamp()",
        [n.id],
      );
      if (count.rows[0].n >= 64) matchingFail('MATCHING_CONTACT_LIMIT', '当前未结意向最多64条');
      const r = await c.query<Intent>(
        `INSERT INTO matching_intents(id,need_id,slot_id,candidate_id,generation,need_version,receiver_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,LEAST($8::timestamptz,clock_timestamp()+interval '24 hours')) RETURNING *`,
        [
          randomUUID(),
          n.id,
          slot.id,
          can.id,
          slot.generation,
          n.version,
          can.source_user_id,
          n.expires_at,
        ],
      );
      const i = r.rows[0]!;
      await this.event(c, n, i, 'INTENT_SENT', i.receiver_id);
      return this.finish(c, a, x.commandId, x, {
        resourceType: 'MATCHING_INTENT',
        resourceId: i.id,
        needId: n.id,
        version: i.version,
      });
    });
  }
  async intentCommand(cookie: string | undefined, idRaw: string, raw: unknown) {
    const b = objectInput(raw, ['commandId', 'expectedVersion', 'type', 'sourceInput']);
    if (!['ACCEPT', 'DECLINE', 'WITHDRAW', 'CONVERT'].includes(String(b.type)))
      invalid('意向操作无效');
    const x = {
      id: matchingId(idRaw),
      commandId: localCommandId(b.commandId),
      expectedVersion: matchingInteger(b.expectedVersion, 1, 2147483647, '版本'),
      type: String(b.type),
      ...(b.type === 'CONVERT' ? { sourceInput: b.sourceInput } : {}),
    };
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.gate(c);
      const old = await this.command(c, a, x.commandId, x);
      if (old) return old;
      const ref = (await c.query<Intent>('SELECT * FROM matching_intents WHERE id=$1', [x.id]))
        .rows[0];
      if (!ref) throw notFound();
      const nr = await this.need(c, ref.need_id);
      if (a.user.id !== nr.owner_id && a.user.id !== ref.receiver_id) throw notFound();
      const can = await this.candidate(c, ref.candidate_id, nr.id);
      let prepared: Awaited<ReturnType<MatchingSourceHooks['prepare']>> | undefined;
      if (x.type === 'CONVERT') {
        await this.manage(c, a, nr);
        if (!this.runtime.sourceHooks)
          matchingFail('MATCHING_SOURCE_UNAVAILABLE', '原业务预约服务尚未接通', 503);
        if (can.snapshot.needsQuote)
          matchingFail('MATCHING_QUOTE_REQUIRED', '请先在原服务确认有效报价，再重新匹配');
        if (can.snapshot.crossCity)
          matchingFail(
            'MATCHING_TRAVEL_REVIEW_REQUIRED',
            '跨城意向需进入差旅报价与派单流程，不能直接生成本地预约',
          );
        const input: MatchingConversionInput = {
          commandId: x.commandId,
          kind: nr.kind,
          need: {
            id: nr.id,
            orgId: nr.org_id,
            teamId: nr.team_id,
            regionId: nr.region_id,
            catalogVersion: nr.region_catalog_version,
            startsAt: nr.windows[0]!.reportAt,
            endsAt: nr.windows.at(-1)!.endAt,
            address: nr.address,
            windows: nr.windows,
          },
          candidate: {
            sourceId: can.source_id,
            sourceOrgId: can.source_org_id,
            userId: can.source_user_id,
            sourceVersion: can.source_version,
            sourceSlotId: can.source_slot_id,
            totalFen: can.snapshot.totalFen,
            ...(can.snapshot.settingsVersion
              ? { settingsVersion: can.snapshot.settingsVersion }
              : {}),
          },
          sourceInput: x.sourceInput,
        };
        prepared = await this.runtime.sourceHooks!.prepare(c, a, input);
      }
      await this.consentLock(c, nr.kind, can.source_id);
      const n = await this.need(c, ref.need_id, true),
        slot = await this.slot(c, ref.slot_id, n.id);
      const i = (
        await c.query<Intent>('SELECT * FROM matching_intents WHERE id=$1 FOR UPDATE', [x.id])
      ).rows[0]!;
      this.version(i.version, x.expectedVersion);
      if (x.type === 'WITHDRAW') {
        await this.manage(c, a, n);
        if (!activeIntent(i)) matchingFail('MATCHING_INTENT_CLOSED', '意向已结束');
      } else {
        if (x.type === 'CONVERT') await this.manage(c, a, n);
        else if (i.receiver_id !== a.user.id) throw notFound();
        if (!activeIntent(i)) matchingFail('MATCHING_INTENT_CLOSED', '意向已结束');
      }
      if (x.type === 'ACCEPT' || x.type === 'CONVERT') {
        await this.current(c, n);
        if (
          i.need_version !== n.version ||
          slot.state !== 'OPEN' ||
          slot.generation !== i.generation
        )
          matchingFail('MATCHING_SELECTION_STALE', '需求或席位已变化，请重新发送意向');
        const expiry = await c.query('SELECT $1::timestamptz>clock_timestamp() AS valid', [
          i.expires_at,
        ]);
        if (!expiry.rows[0]?.valid) matchingFail('MATCHING_INTENT_EXPIRED', '意向已过期');
        await this.revalidate(c, n, can);
      }
      if (x.type === 'ACCEPT') {
        if (i.status !== 'PENDING') matchingFail('MATCHING_ALREADY_ACCEPTED', '双方意向已确认');
        await c.query(
          "UPDATE matching_intents SET status='MUTUAL_INTEREST',accepted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [i.id],
        );
        await this.event(c, n, { ...i, version: i.version + 1 }, 'INTENT_ACCEPTED', n.owner_id);
      }
      if (x.type === 'DECLINE' || x.type === 'WITHDRAW') {
        await c.query(
          'UPDATE matching_intents SET status=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1',
          [i.id, x.type === 'DECLINE' ? 'DECLINED' : 'WITHDRAWN'],
        );
        await this.event(
          c,
          n,
          { ...i, version: i.version + 1 },
          x.type === 'DECLINE' ? 'INTENT_DECLINED' : 'INTENT_WITHDRAWN',
          x.type === 'DECLINE' ? n.owner_id : i.receiver_id,
        );
        await c.query(
          "UPDATE matching_outbox SET state='CANCELLED' WHERE intent_id=$1 AND event='INTENT_SENT' AND state='PENDING'",
          [i.id],
        );
      }
      let sourceKind: string | undefined, sourceId: string | undefined;
      if (x.type === 'CONVERT') {
        if (i.status !== 'MUTUAL_INTEREST')
          matchingFail('MATCHING_MUTUAL_REQUIRED', '需双方确认意向后再转预约');
        const existing = await c.query(
          'SELECT 1 FROM matching_slot_assignments WHERE need_id=$1 AND source_user_id=$2 AND active',
          [n.id, can.source_user_id],
        );
        if (existing.rowCount)
          matchingFail('MATCHING_DUPLICATE_PERSON', '同组需求不能由同一人重复占位');
        const held = await c.query(
          'SELECT COALESCE(sum(CASE WHEN active THEN amount_fen ELSE retained_cost_fen END),0)::bigint::text AS amount FROM matching_slot_assignments WHERE need_id=$1',
          [n.id],
        );
        const price = can.snapshot.totalFen!;
        if (price > n.unit_budget_fen || Number(held.rows[0].amount) + price > n.total_budget_fen)
          matchingFail('MATCHING_BUDGET_EXCEEDED', '包含既有预约与已发生费用后，总预算不足');
        const result = await prepared!.execute();
        const expected = {
          TEAM_MATCHUP: 'TEAM_MATCHUP',
          ADULT_PLAYER: 'PLAYER_ORDER',
          STAFF_SERVICE: 'LOCAL_BOOKING',
        }[n.kind];
        if (result.sourceKind !== expected || result.totalFen !== price)
          matchingFail('MATCHING_SOURCE_CHANGED', '原业务金额或类型已变化，整笔操作已回滚');
        matchingId(result.sourceId);
        await c.query(
          'INSERT INTO matching_slot_assignments(id,need_id,slot_id,generation,intent_id,source_user_id,source_kind,source_id,amount_fen) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            randomUUID(),
            n.id,
            slot.id,
            slot.generation,
            i.id,
            can.source_user_id,
            result.sourceKind,
            result.sourceId,
            price,
          ],
        );
        await c.query("UPDATE matching_demand_slots SET state='CONVERTED' WHERE id=$1", [slot.id]);
        await c.query(
          "UPDATE matching_intents SET status='CONVERTED',source_kind=$2,source_id=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1",
          [i.id, result.sourceKind, result.sourceId],
        );
        await c.query(
          "UPDATE matching_intents SET status='SUPERSEDED',version=version+1,updated_at=clock_timestamp() WHERE slot_id=$1 AND id<>$2 AND status IN('PENDING','MUTUAL_INTEREST')",
          [slot.id, i.id],
        );
        await c.query(
          "UPDATE matching_outbox SET state='CANCELLED' WHERE intent_id IN(SELECT id FROM matching_intents WHERE slot_id=$1 AND status='SUPERSEDED') AND state='PENDING'",
          [slot.id],
        );
        await this.event(c, n, { ...i, version: i.version + 1 }, 'CONVERTED', i.receiver_id);
        sourceKind = result.sourceKind;
        sourceId = result.sourceId;
      }
      await this.audit(
        c,
        a.user.id,
        n.org_id,
        'MATCHING_INTENT_' + x.type,
        'matching_intent',
        i.id,
        {},
      );
      return this.finish(c, a, x.commandId, x, {
        resourceType: 'MATCHING_INTENT',
        resourceId: i.id,
        needId: n.id,
        version: i.version + 1,
        ...(sourceId ? { sourceId, sourceKind } : {}),
      });
    });
  }
  async needCommand(cookie: string | undefined, idRaw: string, raw: unknown) {
    const b = objectInput(raw, ['commandId', 'expectedVersion', 'type', 'slotId']);
    if (!['PAUSE', 'RESUME', 'CLOSE', 'REOPEN_SLOT'].includes(String(b.type)))
      invalid('需求操作无效');
    const x = {
      id: matchingId(idRaw),
      commandId: localCommandId(b.commandId),
      expectedVersion: matchingInteger(b.expectedVersion, 1, 2147483647, '版本'),
      type: String(b.type),
      ...(b.type === 'REOPEN_SLOT' ? { slotId: matchingId(b.slotId) } : {}),
    };
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      await this.gate(c);
      const old = await this.command(c, a, x.commandId, x);
      if (old) return old;
      const ref = await this.need(c, x.id);
      await this.manage(c, a, ref);
      let ended: Awaited<ReturnType<NonNullable<MatchingSourceHooks['inspectEnded']>>> | undefined;
      let assignment:
        | {
            id: string;
            source_kind: 'LOCAL_BOOKING' | 'PLAYER_ORDER' | 'TEAM_MATCHUP';
            source_id: string;
            amount_fen: number;
          }
        | undefined;
      if (x.type === 'REOPEN_SLOT') {
        assignment = (
          await c.query(
            'SELECT id,source_kind,source_id,amount_fen FROM matching_slot_assignments WHERE need_id=$1 AND slot_id=$2 AND active',
            [ref.id, x.slotId],
          )
        ).rows[0];
        if (!assignment) matchingFail('MATCHING_SOURCE_NOT_ENDED', '席位没有可重开的预约');
        if (!this.runtime.sourceHooks?.inspectEnded)
          matchingFail('MATCHING_RECOVERY_UNAVAILABLE', '财务与原预约终态检查尚未接通', 503);
        ended = await this.runtime.sourceHooks!.inspectEnded!(c, a, {
          sourceKind: assignment!.source_kind,
          sourceId: assignment!.source_id,
        });
      }
      const n = await this.need(c, x.id, true);
      await this.manage(c, a, n);
      this.version(n.version, x.expectedVersion);
      if (x.type === 'REOPEN_SLOT') {
        await this.current(c, n);
        const slot = await this.slot(c, x.slotId!, n.id);
        const still = await c.query(
          'SELECT 1 FROM matching_slot_assignments WHERE id=$1 AND active FOR UPDATE',
          [assignment!.id],
        );
        if (
          slot.state !== 'CONVERTED' ||
          !still.rowCount ||
          !ended?.ended ||
          ended.completed ||
          ended.unresolvedMoney
        )
          matchingFail(
            'MATCHING_SOURCE_NOT_ENDED',
            '需原预约取消、拒绝或过期且财务处理完成才能重开',
          );
        matchingInteger(ended!.retainedCostFen, 0, assignment!.amount_fen, '已发生费用');
        await c.query(
          'UPDATE matching_slot_assignments SET active=false,ended_at=clock_timestamp(),retained_cost_fen=$2 WHERE id=$1',
          [assignment!.id, ended!.retainedCostFen],
        );
        await c.query(
          "UPDATE matching_demand_slots SET state='OPEN',generation=generation+1 WHERE id=$1",
          [slot.id],
        );
      } else {
        const permitted =
          x.type === 'PAUSE'
            ? n.status === 'ACTIVE'
            : x.type === 'RESUME'
              ? n.status === 'PAUSED'
              : ['ACTIVE', 'PAUSED'].includes(n.status);
        if (!permitted) matchingFail('MATCHING_NEED_STATE', '当前需求不支持此操作');
        if (x.type === 'RESUME') await this.current(c, { ...n, status: 'ACTIVE' });
        await c.query('UPDATE matching_needs SET status=$2 WHERE id=$1', [
          n.id,
          { PAUSE: 'PAUSED', RESUME: 'ACTIVE', CLOSE: 'CLOSED' }[x.type],
        ]);
      }
      await c.query(
        'UPDATE matching_needs SET version=version+1,latest_run_id=NULL,updated_at=clock_timestamp() WHERE id=$1',
        [n.id],
      );
      await c.query("UPDATE matching_runs SET status='STALE' WHERE need_id=$1 AND status='READY'", [
        n.id,
      ]);
      await c.query(
        "UPDATE matching_intents SET status='STALE',version=version+1,updated_at=clock_timestamp() WHERE need_id=$1 AND status IN('PENDING','MUTUAL_INTEREST')",
        [n.id],
      );
      await c.query(
        "UPDATE matching_outbox SET state='CANCELLED' WHERE need_id=$1 AND state='PENDING' AND event='INTENT_SENT'",
        [n.id],
      );
      return this.finish(c, a, x.commandId, x, {
        resourceType: 'MATCHING_NEED',
        resourceId: n.id,
        version: n.version + 1,
      });
    });
  }
  private async visible(c: PoolClient, a: Actor, n: Need) {
    if (n.owner_id === a.user.id) {
      await this.manage(c, a, n);
      return true;
    }
    const r = await c.query('SELECT 1 FROM matching_intents WHERE need_id=$1 AND receiver_id=$2', [
      n.id,
      a.user.id,
    ]);
    if (!r.rowCount) throw notFound();
    return false;
  }
  async detail(cookie: string | undefined, idRaw: string): Promise<MatchingNeedData> {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        n = await this.need(c, matchingId(idRaw)),
        manager = await this.visible(c, a, n);
      const now = (await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
      const slots = await c.query<Slot>(
        'SELECT * FROM matching_demand_slots WHERE need_id=$1 ORDER BY seat_no',
        [n.id],
      );
      const intents = await c.query<Intent>(
        'SELECT * FROM matching_intents WHERE need_id=$1 AND ($2 OR receiver_id=$3) ORDER BY created_at DESC,id LIMIT 200',
        [n.id, manager, a.user.id],
      );
      const candidates: MatchingCandidateData[] = [];
      if (manager && n.latest_run_id && n.status === 'ACTIVE' && n.expires_at > now) {
        const rows = await c.query<Candidate>(
          "SELECT * FROM matching_candidates WHERE run_id=$1 AND created_at>clock_timestamp()-interval '24 hours' ORDER BY created_at,id",
          [n.latest_run_id],
        );
        for (const k of rows.rows) {
          const p = await this.preference(c, n.kind, k.source_id);
          const currentSource =
            p && p.version === k.preference_version ? await this.eligible(c, n, p) : null;
          if (currentSource && currentSource.fingerprint === k.snapshot.fingerprint) {
            const { fingerprint: _, ...dto } = k.snapshot;
            candidates.push(dto);
          }
        }
      }
      const runInfo = n.latest_run_id
        ? (
            await c.query<{ truncated: boolean }>(
              'SELECT truncated FROM matching_runs WHERE id=$1',
              [n.latest_run_id],
            )
          ).rows[0]
        : null;
      const outputIntents: MatchingIntentData[] = [];
      for (const i of intents.rows) {
        const can = await this.candidate(c, i.candidate_id, n.id);
        const p = await this.preference(c, n.kind, can.source_id);
        const source = p ? await this.source(c, p, n) : null;
        const valid =
          !!p &&
          p.version === can.preference_version &&
          p.contact_enabled &&
          p.discovery_enabled &&
          !!source &&
          source.fingerprint === can.snapshot.fingerprint &&
          can.created_at.getTime() > now.getTime() - 86400000;
        const open =
          activeIntent(i) &&
          i.expires_at > now &&
          n.status === 'ACTIVE' &&
          n.expires_at > now &&
          i.need_version === n.version &&
          valid;
        outputIntents.push({
          id: i.id,
          needId: i.need_id,
          slotId: i.slot_id,
          candidateId: i.candidate_id,
          status:
            activeIntent(i) && (!valid || i.need_version !== n.version)
              ? 'STALE'
              : activeIntent(i) && i.expires_at <= now
                ? 'EXPIRED'
                : i.status,
          version: i.version,
          expiresAt: iso(i.expires_at),
          canAccept: !manager && i.status === 'PENDING' && open,
          canWithdraw: manager && activeIntent(i),
          canConvert:
            manager &&
            i.status === 'MUTUAL_INTEREST' &&
            open &&
            !!this.runtime.sourceHooks &&
            !can.snapshot.needsQuote &&
            !can.snapshot.crossCity,
          sourceKind: i.source_kind,
          sourceId: i.source_id,
          candidate: valid ? (({ fingerprint: _, ...dto }) => dto)(can.snapshot) : null,
        });
      }
      return {
        id: n.id,
        kind: n.kind,
        orgId: n.org_id,
        teamId: n.team_id,
        title: n.title,
        address: n.address,
        regionId: n.region_id,
        catalogVersion: n.region_catalog_version,
        role: n.role,
        windows: n.windows,
        quantity: n.quantity,
        unitBudgetFen: n.unit_budget_fen,
        totalBudgetFen: n.total_budget_fen,
        version: n.version,
        status: n.status === 'ACTIVE' && n.expires_at <= now ? 'EXPIRED' : n.status,
        expiresAt: iso(n.expires_at),
        slots: slots.rows.map((s) => ({
          id: s.id,
          number: s.seat_no,
          generation: s.generation,
          status: s.state,
        })),
        candidates,
        intents: outputIntents,
        canManage: manager,
        latestRunId: n.latest_run_id,
        truncated: runInfo?.truncated ?? false,
      };
    });
  }
  async workspace(cookie: string | undefined) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie);
      const needs = await c.query(
        'SELECT id,title,kind,status,version,expires_at AS "expiresAt" FROM matching_needs WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT 100',
        [a.user.id],
      );
      const inbox = await c.query(
        `SELECT i.id,i.need_id AS "needId",i.status,i.version,i.expires_at AS "expiresAt",n.title,n.kind FROM matching_intents i JOIN matching_needs n ON n.id=i.need_id WHERE i.receiver_id=$1 ORDER BY i.created_at DESC,i.id LIMIT 100`,
        [a.user.id],
      );
      const prefs = await c.query<Preference>(
        'SELECT * FROM matching_supply_preferences WHERE owner_id=$1 ORDER BY source_kind,source_id',
        [a.user.id],
      );
      const sources = await c.query(
        `SELECT 'ADULT_PLAYER' AS kind,p.id,p.display_name AS name,NULL::uuid AS "orgId",p.position AS role FROM booking_profiles p WHERE p.user_id=$1 AND p.status='APPROVED' UNION ALL SELECT 'STAFF_SERVICE',l.id,l.title,l.org_id,l.kind FROM local_listings l WHERE l.provider_user_id=$1 AND l.status='APPROVED' AND l.published AND l.kind IN('REFEREE','SCORER','RECORDER','STREAMER','PHOTOGRAPHER') UNION ALL SELECT 'TEAM_MATCHUP',t.id,t.name,t.org_id,'TEAM' FROM teams t JOIN organizations o ON o.id=t.org_id AND o.status='ACTIVE' WHERE EXISTS(SELECT 1 FROM team_access_grants g WHERE g.team_id=t.id AND g.org_id=t.org_id AND g.user_id=$1 AND g.status='ACTIVE')`,
        [a.user.id],
      );
      return {
        enabled: !!this.runtime.enabled,
        conversionEnabled: !!this.runtime.sourceHooks,
        needs: needs.rows,
        inbox: inbox.rows,
        sources: sources.rows,
        preferences: prefs.rows.map((p) => ({
          kind: p.source_kind,
          sourceId: p.source_id,
          regionId: p.region_id,
          catalogVersion: p.region_catalog_version,
          allowedRegionIds: p.allowed_region_ids,
          discoveryEnabled: p.discovery_enabled,
          contactEnabled: p.contact_enabled,
          availability: p.availability,
          version: p.version,
        })),
      };
    });
  }
  async receipt(cookie: string | undefined, idRaw: string) {
    return this.transaction(async (c) => {
      const a = await this.lockActor(c, cookie),
        id = localCommandId(idRaw);
      const r = await c.query<{ result: Result }>(
        'SELECT result FROM matching_command_receipts WHERE actor_id=$1 AND command_id=$2',
        [a.user.id, id],
      );
      return { found: !!r.rows[0], result: r.rows[0]?.result ?? null };
    });
  }
}
