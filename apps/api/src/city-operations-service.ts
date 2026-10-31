import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ApplicationService } from './service.js';
import type { Actor } from './service.js';
import { forbidden, notFound, unauthenticated } from './errors.js';
import { objectInput } from './validation.js';
import {
  govCheckVersion,
  govCommand,
  govHash,
  govId,
  govQuery,
  govText,
  govVersion,
  parseCityGrant,
} from './governance-domain.js';
import type { CityOperation, GovernanceRegion } from '../../../packages/contracts/governance.js';

export async function governanceOperator(c: PoolClient, userId: string): Promise<boolean> {
  return Boolean(
    (
      await c.query(
        "SELECT p.user_id FROM platform_operators p JOIN users u ON u.id=p.user_id AND u.status='ACTIVE' WHERE p.user_id=$1 AND p.status='ACTIVE' FOR SHARE OF p,u",
        [userId],
      )
    ).rowCount,
  );
}
export async function governanceActiveOrg(c: PoolClient, orgId: string) {
  if (
    !(
      await c.query("SELECT id FROM organizations WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
        govId(orgId),
      ])
    ).rowCount
  )
    throw notFound();
}
export async function governanceRegion(c: PoolClient, region: GovernanceRegion) {
  if (
    !(
      await c.query(
        'SELECT region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2',
        [region.catalogVersion, region.regionId],
      )
    ).rowCount
  )
    throw notFound();
}
export async function regionContains(
  c: PoolClient,
  ancestor: GovernanceRegion,
  target: GovernanceRegion,
): Promise<boolean> {
  if (ancestor.catalogVersion !== target.catalogVersion) return false;
  return Boolean(
    (
      await c.query(
        `WITH RECURSIVE ancestors AS (
    SELECT region_id,parent_region_id FROM region_catalog_nodes WHERE catalog_version=$1 AND region_id=$2
    UNION ALL SELECT n.region_id,n.parent_region_id FROM region_catalog_nodes n JOIN ancestors a ON n.region_id=a.parent_region_id WHERE n.catalog_version=$1
  ) SELECT 1 FROM ancestors WHERE region_id=$3`,
        [target.catalogVersion, target.regionId, ancestor.regionId],
      )
    ).rowCount,
  );
}
/** Narrow authorizer consumed by local supply review; grants never expose unrelated private data. */
export async function assertCityOperation(
  c: PoolClient,
  actor: Actor,
  input: {
    orgId: string;
    region: GovernanceRegion;
    action: CityOperation;
    grantId?: string | null;
  },
): Promise<{ grantId: string | null; platformOperator: boolean }> {
  if (
    !(
      await c.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
        actor.user.id,
      ])
    ).rowCount
  )
    throw notFound();
  await governanceActiveOrg(c, input.orgId);
  await governanceRegion(c, input.region);
  if (await governanceOperator(c, actor.user.id)) return { grantId: null, platformOperator: true };
  const rows = (
    await c.query<{ id: string; region_catalog_version: string; region_id: string }>(
      `SELECT id,region_catalog_version,region_id FROM city_operation_grants
    WHERE user_id=$1 AND org_id=$2 AND action=$3 AND status='ACTIVE' AND expires_at>clock_timestamp()
    AND ($4::uuid IS NULL OR id=$4) ORDER BY id FOR SHARE`,
      [actor.user.id, input.orgId, input.action, input.grantId ?? null],
    )
  ).rows;
  for (const grant of rows)
    if (
      await regionContains(
        c,
        { catalogVersion: grant.region_catalog_version, regionId: grant.region_id },
        input.region,
      )
    )
      return { grantId: grant.id, platformOperator: false };
  throw forbidden();
}
/** Receipts are inserted only in the same transaction as a completed effect. */
export async function governanceReceipt(
  c: PoolClient,
  actor: Actor,
  commandId: string,
  request: unknown,
): Promise<Record<string, unknown> | null> {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `scb-governance:${actor.user.id}:${commandId}`,
  ]);
  const row = (
    await c.query<{ request_hash: string; result: Record<string, unknown> }>(
      'SELECT request_hash,result FROM governance_operations WHERE actor_id=$1 AND command_id=$2',
      [actor.user.id, commandId],
    )
  ).rows[0];
  if (!row) return null;
  if (row.result._cancelled === true)
    throw new ApiError(409, 'GOVERNANCE_OPERATION_CANCELLED', '原操作已明确取消，不会再次执行');
  if (row.request_hash !== govHash(request)) throw new ErrorReceiptConflict();
  if (
    !(
      await c.query(
        'SELECT id FROM sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',
        [actor.sessionId],
      )
    ).rowCount
  )
    throw unauthenticated();
  const { _receiptScope: _, ...publicResult } = row.result;
  return publicResult;
}
import { ApiError } from './errors.js';
class ErrorReceiptConflict extends ApiError {
  constructor() {
    super(409, 'IDEMPOTENCY_CONFLICT', '同一操作编号已用于不同治理请求');
  }
}
export async function governanceFinish(
  c: PoolClient,
  actor: Actor,
  commandId: string,
  request: unknown,
  result: unknown,
) {
  const input = request as Record<string, unknown>,
    output = result as Record<string, unknown>;
  const operation = String(input.operation ?? '');
  const kind = operation.startsWith('CITY_')
    ? 'CITY'
    : operation.startsWith('CASE_')
      ? 'CASE'
      : operation.startsWith('REVIEW_')
        ? 'REVIEW'
        : operation.startsWith('SPONSOR_')
          ? 'SPONSOR'
          : operation.startsWith('LEDGER_')
            ? 'LEDGER'
            : null;
  const resourceId =
    kind === 'LEDGER' ? (output.accountId ?? output.id) : (output.id ?? input.caseId);
  if (!kind || typeof resourceId !== 'string')
    throw new Error('A governance receipt requires a known authority scope');
  await c.query(
    'INSERT INTO governance_operations(actor_id,command_id,request_hash,result) VALUES($1,$2,$3,$4::jsonb)',
    [
      actor.user.id,
      commandId,
      govHash(request),
      JSON.stringify({ ...output, _receiptScope: { kind, resourceId } }),
    ],
  );
  if (
    !(
      await c.query(
        'SELECT id FROM sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',
        [actor.sessionId],
      )
    ).rowCount
  )
    throw unauthenticated();
}
const dto = (r: Record<string, any>) => ({
  id: r.id,
  userId: r.user_id,
  orgId: r.org_id,
  region: { catalogVersion: r.region_catalog_version, regionId: r.region_id },
  action: r.action,
  status: r.status,
  version: r.version,
  expiresAt: new Date(r.expires_at).toISOString(),
  createdAt: new Date(r.created_at).toISOString(),
  reason: r.reason,
  organizationName: r.org_name ?? null,
  regionName: r.region_name ?? null,
  effective: r.status === 'ACTIVE' && new Date(r.expires_at).getTime() > Date.now(),
});

export class CityOperationsService extends ApplicationService {
  async workspace(cookie: string | undefined, raw: unknown, platform = false) {
    const q = govQuery(raw, ['userQuery', 'orgQuery']);
    const userQuery =
      q.input.userQuery === undefined ? '' : govText(q.input.userQuery, 'userQuery', 1, 80);
    const orgQuery =
      q.input.orgQuery === undefined ? '' : govText(q.input.orgQuery, 'orgQuery', 1, 80);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie),
        operator = await governanceOperator(c, actor.user.id);
      if (platform && !operator) throw forbidden();
      const rows = (
        await c.query(
          `SELECT g.*,o.name AS org_name,n.name AS region_name FROM city_operation_grants g JOIN organizations o ON o.id=g.org_id AND o.status='ACTIVE'
        JOIN region_catalog_nodes n ON n.catalog_version=g.region_catalog_version AND n.region_id=g.region_id
        WHERE ($1::boolean OR g.user_id=$2) AND ($3::uuid IS NULL OR g.id<$3) ORDER BY g.id DESC LIMIT $4`,
          [platform, actor.user.id, q.before, q.limit + 1],
        )
      ).rows;
      const organizations = platform
        ? (
            await c.query(
              "SELECT id,name FROM organizations WHERE status='ACTIVE' AND ($1='' OR position(lower($1) in lower(name))>0) ORDER BY name,id LIMIT 201",
              [orgQuery],
            )
          ).rows
        : [];
      const people = platform
        ? (
            await c.query(
              "SELECT id,display_name AS \"displayName\" FROM users WHERE status='ACTIVE' AND ($1='' OR position(lower($1) in lower(display_name))>0) ORDER BY display_name,id LIMIT 101",
              [userQuery],
            )
          ).rows
        : [];
      await this.ensureFreshSession(c, actor);
      return {
        items: rows.slice(0, q.limit).map(dto),
        nextCursor: rows.length > q.limit ? (rows[q.limit - 1]?.id ?? null) : null,
        canManage: operator,
        organizations: organizations.slice(0, 200),
        people: people.slice(0, 100),
        directoryTruncated: {
          organizations: organizations.length > 200,
          people: people.length > 100,
        },
        directoryLimits: { organizations: 200, people: 100 },
      };
    });
  }
  async create(cookie: string | undefined, raw: unknown) {
    const input = parseCityGrant(raw);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      if (!(await governanceOperator(c, actor.user.id))) throw forbidden();
      await governanceActiveOrg(c, input.orgId);
      await governanceRegion(c, input.region);
      if (
        !(
          await c.query("SELECT id FROM users WHERE id=$1 AND status='ACTIVE' FOR SHARE", [
            input.userId,
          ])
        ).rowCount
      )
        throw notFound();
      const request = { operation: 'CITY_GRANT_CREATE', ...input },
        old = await governanceReceipt(c, actor, input.commandId, request);
      if (old) return old;
      const clock = (
        await c.query<{ now: Date }>('SELECT clock_timestamp() AS now')
      ).rows[0]!.now.getTime();
      if (
        Date.parse(input.expiresAt) <= clock ||
        Date.parse(input.expiresAt) > clock + 366 * 86400000
      )
        throw new ApiError(422, 'VALIDATION_ERROR', '授权须在未来且不超过366天');
      const id = randomUUID();
      const row = (
        await c.query(
          `INSERT INTO city_operation_grants(id,user_id,org_id,region_catalog_version,region_id,action,expires_at,reason,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            id,
            input.userId,
            input.orgId,
            input.region.catalogVersion,
            input.region.regionId,
            input.action,
            input.expiresAt,
            input.reason,
            actor.user.id,
          ],
        )
      ).rows[0]!;
      await this.audit(c, actor.user.id, input.orgId, 'governance.city_granted', 'city_grant', id, {
        action: input.action,
        regionId: input.region.regionId,
      });
      const result = dto(row);
      await governanceFinish(c, actor, input.commandId, request, result);
      return result;
    });
  }
  async revoke(cookie: string | undefined, id: string, raw: unknown) {
    const o = objectInput(raw, ['commandId', 'expectedVersion', 'reason']),
      input = {
        commandId: govCommand(o.commandId),
        expectedVersion: govVersion(o.expectedVersion),
        reason: govText(o.reason, 'reason', 4, 500),
      },
      grantId = govId(id);
    return this.transaction(async (c) => {
      const actor = await this.lockActor(c, cookie);
      if (!(await governanceOperator(c, actor.user.id))) throw forbidden();
      const ref = (
        await c.query<{ org_id: string }>('SELECT org_id FROM city_operation_grants WHERE id=$1', [
          grantId,
        ])
      ).rows[0];
      if (!ref) throw notFound();
      await governanceActiveOrg(c, ref.org_id);
      const row = (
        await c.query('SELECT * FROM city_operation_grants WHERE id=$1 FOR UPDATE', [grantId])
      ).rows[0]!;
      const request = { operation: 'CITY_GRANT_REVOKE', grantId, ...input },
        old = await governanceReceipt(c, actor, input.commandId, request);
      if (old) return old;
      govCheckVersion(row.version, input.expectedVersion);
      if (row.status !== 'ACTIVE')
        throw new ApiError(409, 'GRANT_ALREADY_REVOKED', '授权已撤销，不得复活');
      const updated = (
        await c.query(
          "UPDATE city_operation_grants SET status='REVOKED',version=version+1,revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason=$3 WHERE id=$1 RETURNING *",
          [grantId, actor.user.id, input.reason],
        )
      ).rows[0]!;
      await this.audit(
        c,
        actor.user.id,
        row.org_id,
        'governance.city_revoked',
        'city_grant',
        grantId,
      );
      const result = dto(updated);
      await governanceFinish(c, actor, input.commandId, request, result);
      return result;
    });
  }
}
