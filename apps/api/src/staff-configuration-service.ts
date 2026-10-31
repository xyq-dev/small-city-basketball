import { createHash } from 'node:crypto';
import { ApplicationService, isAdministrator } from './service.js';
import { ApiError, forbidden, notFound } from './errors.js';
import { membershipInput, objectInput, resourceId } from './validation.js';

const idOf = (value: unknown): string => {
  if (typeof value !== 'string') throw new ApiError(422, 'VALIDATION_ERROR', '资料编号无效');
  return resourceId(value);
};

export class StaffConfigurationService extends ApplicationService {
  async workspace(cookie: string | undefined, orgId: string, raw: unknown) {
    const q = objectInput(raw, ['eventId']);
    const eventId = q.eventId === undefined ? null : idOf(q.eventId);
    return this.transaction(async (c) => {
      const actor = await this.lockOrganization(c, await this.lockActor(c, cookie), orgId);
      if (!isAdministrator(actor.role)) throw forbidden();
      if (eventId) await this.lockEvent(c, actor, eventId);
      const members = await c.query(
        'SELECT m.user_id AS id,u.display_name AS name,m.role,m.status,extract(epoch FROM m.updated_at)::text AS version FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 ORDER BY u.display_name,m.user_id',
        [actor.orgId],
      );
      const staff = eventId
        ? await c.query(
            'SELECT s.user_id AS id,u.display_name AS name,s.role,s.status,extract(epoch FROM s.updated_at)::text AS version FROM event_staff s JOIN users u ON u.id=s.user_id WHERE s.org_id=$1 AND s.event_id=$2 ORDER BY u.display_name,s.user_id',
            [actor.orgId, eventId],
          )
        : { rows: [] };
      await this.ensureFreshSession(c, actor);
      return {
        orgId: actor.orgId,
        eventId,
        members: members.rows,
        staff: staff.rows,
        capabilities: { canManageMembers: actor.role === 'ORG_OWNER', canManageStaff: !!eventId },
      };
    });
  }
  async command(cookie: string | undefined, orgId: string, raw: unknown) {
    const b = objectInput(raw, [
      'clientRequestId',
      'type',
      'userId',
      'eventId',
      'role',
      'status',
      'expectedVersion',
    ]);
    const id = idOf(b.clientRequestId),
      userId = idOf(b.userId);
    if (!['MEMBER', 'STAFF'].includes(String(b.type)))
      throw new ApiError(422, 'VALIDATION_ERROR', '请选择成员或赛事工作人员');
    const staff = b.type === 'STAFF',
      eventId = staff ? idOf(b.eventId) : null;
    if (!staff && b.eventId !== null && b.eventId !== undefined)
      throw new ApiError(422, 'VALIDATION_ERROR', '机构成员操作不接受赛事编号');
    const input = membershipInput({ role: b.role, status: b.status }, staff);
    if (
      b.expectedVersion !== null &&
      (typeof b.expectedVersion !== 'string' || !/^\d{8,20}(?:\.\d{1,6})?$/.test(b.expectedVersion))
    )
      throw new ApiError(422, 'VALIDATION_ERROR', '缺少当前成员版本');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          type: b.type,
          userId,
          eventId,
          role: input.role,
          status: input.status,
          expectedVersion: b.expectedVersion,
        }),
      )
      .digest('hex');
    return this.transaction(async (c) => {
      const actor = await this.lockOrganization(c, await this.lockActor(c, cookie), orgId);
      if (!isAdministrator(actor.role) || (!staff && actor.role !== 'ORG_OWNER')) throw forbidden();
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `staff-command:${id}`,
      ]);
      const receipt = (
        await c.query('SELECT * FROM staff_configuration_receipts WHERE id=$1', [id])
      ).rows[0];
      if (receipt) {
        if (
          receipt.actor_id !== actor.user.id ||
          receipt.org_id !== actor.orgId ||
          receipt.request_hash !== fingerprint
        )
          throw new ApiError(409, 'REQUEST_CONFLICT', '原操作编号内容不同');
        await this.ensureFreshSession(c, actor);
        return receipt.result;
      }
      const user = (
        await c.query('SELECT id FROM users WHERE id=$1 AND status=$2 FOR SHARE', [
          userId,
          'ACTIVE',
        ])
      ).rows[0];
      if (!user) throw notFound();
      const member = staff
        ? (
            await c.query(
              'SELECT role,status FROM organization_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE',
              [actor.orgId, userId],
            )
          ).rows[0]
        : null;
      if (staff && member?.status !== 'ACTIVE')
        throw new ApiError(409, 'MEMBERSHIP_REQUIRED', '请先配置有效机构成员');
      if (eventId) {
        await this.lockEvent(c, actor, eventId);
        await this.assertStaffMutable(c, eventId);
      }
      if (!staff && userId === actor.user.id) throw forbidden();
      const table = staff ? 'event_staff' : 'organization_memberships';
      const params = staff ? [actor.orgId, userId, eventId] : [actor.orgId, userId];
      const current = (
        await c.query(
          `SELECT role,status,extract(epoch FROM updated_at)::text AS version FROM ${table} WHERE org_id=$1 AND user_id=$2${staff ? ' AND event_id=$3' : ''} FOR UPDATE`,
          params,
        )
      ).rows[0];
      if (!staff && current?.role === 'ORG_OWNER') throw forbidden();
      if ((current?.version ?? null) !== b.expectedVersion)
        throw new ApiError(409, 'VERSION_CONFLICT', '成员权限已变化，请刷新后重新确认');
      await this.ensureFreshSession(c, actor);
      if (staff)
        await c.query(
          'INSERT INTO event_staff(org_id,event_id,user_id,role,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(org_id,event_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,updated_at=clock_timestamp()',
          [actor.orgId, eventId, userId, input.role, input.status],
        );
      else
        await c.query(
          'INSERT INTO organization_memberships(org_id,user_id,role,status) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,updated_at=clock_timestamp()',
          [actor.orgId, userId, input.role, input.status],
        );
      const result = {
        applied: true,
        type: b.type,
        userId,
        eventId,
        role: input.role,
        status: input.status,
      };
      await c.query(
        'INSERT INTO staff_configuration_receipts(id,org_id,actor_id,request_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)',
        [id, actor.orgId, actor.user.id, fingerprint, JSON.stringify(result)],
      );
      await this.audit(
        c,
        actor.user.id,
        actor.orgId,
        staff ? 'EVENT_STAFF_CONFIGURED' : 'ORG_MEMBER_CONFIGURED',
        staff ? 'event' : 'user',
        eventId ?? userId,
        { userId, role: input.role, status: input.status },
      );
      return result;
    });
  }
}
