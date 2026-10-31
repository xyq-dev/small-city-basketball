import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ApiError } from './errors.js';
import { calendarDate, invalid, objectInput, resourceId, text } from './validation.js';
import { parseScheduleTimestamp } from './scheduling-domain.js';
import { parseRegionSelection } from './region-catalog-domain.js';
import type {
  CityOperation,
  GovernanceCaseStatus,
  GovernanceRegion,
  GovernanceVisibility,
} from '../../../packages/contracts/governance.js';

export const GOVERNANCE_ATTACHMENT_LIMIT = 4 * 1024 * 1024;
export const CITY_OPERATIONS: readonly CityOperation[] = [
  'SUPPLY_REVIEW',
  'SUPPLY_SUSPEND',
  'CASE_MANAGE',
  'SPONSOR_REVIEW',
];
export const LEDGER_NOTICE =
  '仅记录经授权的线下账目；账面收支差额不是支付余额，不提供募款、钱包或提现。';
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
export function govFail(code: string, message: string, status = 409): never {
  throw new ApiError(status, code, message);
}
export function govText(v: unknown, field: string, min: number, max: number) {
  return text(v, field, min, max).normalize('NFC');
}
export function govCommand(v: unknown): string {
  if (typeof v !== 'string' || !UUID4.test(v)) invalid('操作编号必须是小写UUIDv4');
  return v;
}
export function govId(v: unknown): string {
  if (typeof v !== 'string') invalid('资源编号无效');
  return resourceId(v);
}
export function govVersion(v: unknown): number {
  if (!Number.isSafeInteger(v) || Number(v) < 1) invalid('请提供当前版本');
  return Number(v);
}
export function govCheckVersion(actual: number, expected: number) {
  if (actual !== expected) govFail('VERSION_CONFLICT', '资料已更新，请刷新后核对');
}
export function govKey(v: unknown) {
  if (typeof v !== 'string' || !PUBLIC_KEY.test(v)) invalid('公开链接无效');
  return v;
}
export function govHash(v: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, value]) => [k, canonical(value)]),
      );
    return input;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');
}
export function govRegion(v: unknown): GovernanceRegion {
  return parseRegionSelection(v, (message) => invalid(message));
}
export function govVisibility(v: unknown): GovernanceVisibility {
  if (v !== 'REQUESTER' && v !== 'INTERNAL') invalid('消息可见范围无效');
  return v;
}
export function govTimestamp(v: unknown): string {
  return parseScheduleTimestamp(v);
}
export function govQuery(raw: unknown, allowed: readonly string[] = []) {
  const input = objectInput(raw, ['limit', 'before', ...allowed]);
  const limit = input.limit === undefined ? 30 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('分页数量须为1–100');
  return { input, limit, before: input.before === undefined ? null : govId(input.before) };
}
export function parseCaseCreate(raw: unknown) {
  const o = objectInput(raw, [
    'commandId',
    'orgId',
    'kind',
    'title',
    'body',
    'region',
    'source',
    'parentCaseId',
  ]);
  if (!['SUPPORT', 'REPORT', 'APPEAL'].includes(String(o.kind))) invalid('工单类型无效');
  let source: { kind: 'PUBLIC_EVENT' | 'PLAYER_BOOKING' | 'LOCAL_BOOKING'; id: string } | null =
    null;
  if (o.source !== undefined && o.source !== null) {
    const s = objectInput(o.source, ['kind', 'id']);
    if (!['PUBLIC_EVENT', 'PLAYER_BOOKING', 'LOCAL_BOOKING'].includes(String(s.kind)))
      invalid('来源类型无效');
    source = {
      kind: s.kind as NonNullable<typeof source>['kind'],
      id: s.kind === 'PUBLIC_EVENT' ? govKey(s.id) : govId(s.id),
    };
  }
  if (o.kind === 'REPORT' && !source) invalid('举报必须绑定可核验来源');
  const parentCaseId = o.parentCaseId == null ? null : govId(o.parentCaseId);
  if ((o.kind === 'APPEAL') !== Boolean(parentCaseId)) invalid('申诉必须且只能关联本人的已有工单');
  const orgId = o.orgId == null ? null : govId(o.orgId);
  if (!orgId && !source && !parentCaseId) invalid('请选择收件机构或有效的关联来源');
  return {
    commandId: govCommand(o.commandId),
    orgId,
    kind: o.kind as 'SUPPORT' | 'REPORT' | 'APPEAL',
    title: govText(o.title, 'title', 1, 120),
    body: govText(o.body, 'body', 1, 4000),
    region: o.region == null ? null : govRegion(o.region),
    source,
    parentCaseId,
  };
}
export function caseNextState(
  current: GovernanceCaseStatus,
  command: string,
  rights: { requester: boolean; handler: boolean; operator: boolean },
): GovernanceCaseStatus {
  switch (command) {
    case 'ASSIGN':
      if (!rights.operator || rights.requester || !['OPEN', 'ASSIGNED'].includes(current)) break;
      return 'ASSIGNED';
    case 'RESOLVE':
      if (!rights.handler || rights.requester || current !== 'ASSIGNED') break;
      return 'RESOLVED';
    case 'CLOSE':
      if (current !== 'CLOSED' && (rights.requester || (rights.handler && current === 'RESOLVED')))
        return 'CLOSED';
      break;
    case 'REOPEN':
      if (rights.requester && ['RESOLVED', 'CLOSED'].includes(current)) return 'OPEN';
      break;
  }
  govFail('CASE_TRANSITION_REFUSED', '当前身份或工单状态不允许此操作');
}
export function parseCaseCommand(raw: unknown) {
  const o = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'type',
    'reason',
    'assigneeId',
    'grantId',
  ]);
  if (!['ASSIGN', 'RESOLVE', 'CLOSE', 'REOPEN'].includes(String(o.type))) invalid('工单操作无效');
  if (o.type !== 'ASSIGN' && (o.assigneeId !== undefined || o.grantId !== undefined))
    invalid('此操作不能更改分派');
  return {
    commandId: govCommand(o.commandId),
    expectedVersion: govVersion(o.expectedVersion),
    type: String(o.type),
    reason: govText(o.reason, 'reason', 4, 500),
    assigneeId: o.type === 'ASSIGN' ? govId(o.assigneeId) : null,
    grantId: o.grantId == null ? null : govId(o.grantId),
  };
}
export function parseMessage(raw: unknown) {
  const o = objectInput(raw, ['commandId', 'expectedVersion', 'body', 'visibility']);
  return {
    commandId: govCommand(o.commandId),
    expectedVersion: govVersion(o.expectedVersion),
    body: govText(o.body, 'body', 1, 4000),
    visibility: govVisibility(o.visibility),
  };
}
export async function parseGovernanceAttachment(raw: unknown) {
  const o = objectInput(raw, [
    'expectedVersion',
    'fileName',
    'contentType',
    'base64',
    'visibility',
  ]);
  const expectedVersion = govVersion(o.expectedVersion),
    visibility = govVisibility(o.visibility);
  const fileName = govText(o.fileName, 'fileName', 1, 120);
  if (/[\\/\u0000-\u001f\u007f]/.test(fileName)) invalid('附件名称无效');
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(String(o.contentType)))
    invalid('附件仅支持JPEG、PNG或PDF');
  if (
    typeof o.base64 !== 'string' ||
    o.base64.length > Math.ceil(GOVERNANCE_ATTACHMENT_LIMIT / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(o.base64)
  )
    invalid('附件编码无效或超过4MiB');
  let bytes = Buffer.from(o.base64, 'base64');
  if (
    !bytes.length ||
    bytes.length > GOVERNANCE_ATTACHMENT_LIMIT ||
    bytes.toString('base64') !== o.base64
  )
    invalid('附件编码无效或超过4MiB');
  const originalHash = createHash('sha256').update(bytes).digest('hex');
  if (o.contentType === 'application/pdf') {
    if (
      bytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
      !bytes.subarray(Math.max(0, bytes.length - 2048)).includes(Buffer.from('%%EOF'))
    )
      invalid('PDF内容无效');
  } else {
    try {
      const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' });
      const info = await image.metadata();
      if (
        (o.contentType === 'image/png' && info.format !== 'png') ||
        (o.contentType === 'image/jpeg' && info.format !== 'jpeg') ||
        !info.width ||
        !info.height ||
        (info.pages ?? 1) !== 1
      )
        invalid('图片内容与类型不符');
      bytes = await image
        .rotate()
        .toFormat(o.contentType === 'image/png' ? 'png' : 'jpeg')
        .toBuffer();
      if (!bytes.length || bytes.length > GOVERNANCE_ATTACHMENT_LIMIT)
        invalid('重编码图片超过4MiB');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      invalid('图片不能完整解码');
    }
  }
  return {
    expectedVersion,
    fileName,
    contentType: String(o.contentType),
    visibility,
    bytes,
    byteLength: bytes.length,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    originalHash,
  };
}
export function parseCityGrant(raw: unknown) {
  const o = objectInput(raw, [
    'commandId',
    'userId',
    'orgId',
    'region',
    'action',
    'expiresAt',
    'reason',
  ]);
  if (!CITY_OPERATIONS.includes(o.action as CityOperation)) invalid('城市操作类型无效');
  return {
    commandId: govCommand(o.commandId),
    userId: govId(o.userId),
    orgId: govId(o.orgId),
    region: govRegion(o.region),
    action: o.action as CityOperation,
    expiresAt: govTimestamp(o.expiresAt),
    reason: govText(o.reason, 'reason', 4, 500),
  };
}
export function parseCampaign(raw: unknown) {
  const o = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'eventId',
    'region',
    'brand',
    'title',
    'body',
    'startsAt',
    'endsAt',
  ]);
  const startsAt = govTimestamp(o.startsAt),
    endsAt = govTimestamp(o.endsAt);
  if (
    Date.parse(endsAt) <= Date.parse(startsAt) ||
    Date.parse(endsAt) - Date.parse(startsAt) > 366 * 86400000
  )
    invalid('投放时段须为正且不超过366天');
  return {
    commandId: govCommand(o.commandId),
    expectedVersion: o.expectedVersion === undefined ? null : govVersion(o.expectedVersion),
    eventId: o.eventId == null ? null : govId(o.eventId),
    region: govRegion(o.region),
    brand: govText(o.brand, 'brand', 1, 80),
    title: govText(o.title, 'title', 1, 120),
    body: govText(o.body, 'body', 1, 1000),
    startsAt,
    endsAt,
  };
}
export function sponsorshipTransition(status: string, type: string, independent: boolean) {
  if (type === 'SUBMIT' && ['DRAFT', 'REJECTED'].includes(status)) return 'SUBMITTED';
  if (['APPROVE', 'REJECT'].includes(type) && status === 'SUBMITTED' && independent)
    return type === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  if (type === 'WITHDRAW' && status !== 'WITHDRAWN') return 'WITHDRAWN';
  if (['PUBLISH', 'REVOKE_PUBLICATION'].includes(type) && status === 'APPROVED') return status;
  govFail('SPONSOR_TRANSITION_REFUSED', '当前广告状态或独立审核条件不允许此操作');
}
export function parseLedgerEntry(raw: unknown) {
  const o = objectInput(raw, [
    'commandId',
    'expectedVersion',
    'occurredOn',
    'label',
    'kind',
    'amountFen',
    'reversesEntryId',
  ]);
  if (
    !['INCOME', 'EXPENSE', 'REVERSAL'].includes(String(o.kind)) ||
    !Number.isSafeInteger(o.amountFen) ||
    !Number(o.amountFen) ||
    Math.abs(Number(o.amountFen)) > 100000000
  )
    invalid('账目类型或金额无效');
  const amountFen = Number(o.amountFen),
    kind = o.kind as 'INCOME' | 'EXPENSE' | 'REVERSAL';
  const reversesEntryId = o.reversesEntryId == null ? null : govId(o.reversesEntryId);
  if (
    (kind === 'INCOME' && amountFen < 0) ||
    (kind === 'EXPENSE' && amountFen > 0) ||
    (kind === 'REVERSAL') !== Boolean(reversesEntryId)
  )
    invalid('收入须正数、支出须负数，冲销须绑定原账目');
  return {
    commandId: govCommand(o.commandId),
    expectedVersion: govVersion(o.expectedVersion),
    occurredOn: calendarDate(o.occurredOn, 'occurredOn'),
    label: govText(o.label, 'label', 1, 200),
    kind,
    amountFen,
    reversesEntryId,
  };
}
