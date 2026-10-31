import { createHash } from 'node:crypto';
import { calendarDate, invalid, objectInput, resourceId, text } from './validation.js';

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const RECRUITMENT_MAX_ROWS = 32;
export const RECRUITMENT_MAX_APPLICATIONS = 256;
export type ImportRow = { teamName: string; teamId: string | null; leaderUserId: string | null };
export type ImportIssue = { row: number; field: string; code: string; message: string };

export function requestId(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) invalid('请求编号须为小写UUIDv4');
  return value;
}
export function versionInput(value: unknown, zero = false): number {
  if (!Number.isSafeInteger(value) || Number(value) < (zero ? 0 : 1)) invalid('请提供当前版本');
  return Number(value);
}
export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b, 'en'))
          .map(([k, x]) => [k, normalize(x)]),
      );
    return v;
  };
  return JSON.stringify(normalize(value));
}
export const requestFingerprint = (v: unknown) =>
  createHash('sha256').update(canonicalJson(v)).digest('hex');
export const normalizedName = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
export function publicRecruitmentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) invalid('招募链接格式无效');
  return value;
}
export function publishRecruitmentInput(raw: unknown) {
  const i = objectInput(raw, [
    'clientRequestId',
    'expectedEventVersion',
    'title',
    'description',
    'closesAt',
    'maxApplications',
  ]);
  if (
    typeof i.closesAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(i.closesAt) ||
    !Number.isFinite(Date.parse(i.closesAt))
  )
    invalid('招募截止须为明确时区的有效时间');
  calendarDate(i.closesAt.slice(0, 10), 'closesAt');
  if (
    !Number.isInteger(i.maxApplications) ||
    Number(i.maxApplications) < 1 ||
    Number(i.maxApplications) > RECRUITMENT_MAX_APPLICATIONS
  )
    invalid('招募申请容量须为1–256');
  return {
    clientRequestId: requestId(i.clientRequestId),
    expectedEventVersion: versionInput(i.expectedEventVersion),
    title: text(i.title, 'title', 1, 80),
    description: text(i.description, 'description', 1, 2000),
    closesAt: new Date(i.closesAt).toISOString(),
    maxApplications: Number(i.maxApplications),
  };
}
export function revokeRecruitmentInput(raw: unknown) {
  const i = objectInput(raw, ['clientRequestId', 'expectedVersion', 'reason']);
  return {
    clientRequestId: requestId(i.clientRequestId),
    expectedVersion: versionInput(i.expectedVersion),
    reason: text(i.reason, 'reason', 4, 500),
  };
}
export function recruitmentApplicationInput(raw: unknown) {
  const i = objectInput(raw, ['clientRequestId', 'teamName', 'teamId', 'note']);
  return {
    clientRequestId: requestId(i.clientRequestId),
    teamName: text(i.teamName, 'teamName', 1, 80),
    teamId: i.teamId === undefined || i.teamId === null ? null : resourceId(i.teamId as string),
    note:
      i.note === undefined || i.note === null || i.note === ''
        ? null
        : text(i.note, 'note', 1, 500),
  };
}
export function recruitmentReviewInput(raw: unknown) {
  const i = objectInput(raw, ['clientRequestId', 'expectedVersion', 'type', 'reason']);
  if (i.type !== 'APPROVE' && i.type !== 'REJECT' && i.type !== 'WITHDRAW')
    invalid('不支持的招募申请操作');
  return {
    clientRequestId: requestId(i.clientRequestId),
    expectedVersion: versionInput(i.expectedVersion),
    type: i.type as 'APPROVE' | 'REJECT' | 'WITHDRAW',
    reason: text(i.reason, 'reason', 4, 500),
  };
}
export function importPreviewInput(raw: unknown) {
  const i = objectInput(raw, ['clientRequestId', 'expectedEventVersion', 'rows']);
  if (!Array.isArray(i.rows) || i.rows.length < 1 || i.rows.length > RECRUITMENT_MAX_ROWS)
    invalid('每批需1–32行');
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  const rows: ImportRow[] = i.rows.map((rawRow, n) => {
    try {
      const row = objectInput(rawRow, ['teamName', 'teamId', 'leaderUserId']);
      const teamName = text(row.teamName, 'teamName', 1, 80);
      const teamId =
        row.teamId === undefined || row.teamId === null || row.teamId === ''
          ? null
          : resourceId(row.teamId as string);
      const leaderUserId =
        row.leaderUserId === undefined || row.leaderUserId === null || row.leaderUserId === ''
          ? null
          : resourceId(row.leaderUserId as string);
      const key = teamId ? `id:${teamId}` : `name:${normalizedName(teamName)}`;
      if (seen.has(key))
        issues.push({
          row: n + 1,
          field: 'teamName',
          code: 'DUPLICATE_ROW',
          message: '本批存在重复队伍，请明确去重',
        });
      seen.add(key);
      return { teamName, teamId, leaderUserId };
    } catch {
      issues.push({
        row: n + 1,
        field: 'row',
        code: 'INVALID_ROW',
        message: '请检查队名和队伍／领队编号，不接受额外字段',
      });
      return { teamName: '', teamId: null, leaderUserId: null };
    }
  });
  return {
    clientRequestId: requestId(i.clientRequestId),
    expectedEventVersion: versionInput(i.expectedEventVersion),
    rows,
    issues,
  };
}
export function importCommitInput(raw: unknown) {
  const i = objectInput(raw, [
    'clientRequestId',
    'expectedEventVersion',
    'previewId',
    'previewHash',
  ]);
  if (typeof i.previewHash !== 'string' || !/^[0-9a-f]{64}$/.test(i.previewHash))
    invalid('请提供原预览指纹');
  return {
    clientRequestId: requestId(i.clientRequestId),
    expectedEventVersion: versionInput(i.expectedEventVersion),
    previewId: resourceId(i.previewId as string),
    previewHash: i.previewHash,
  };
}
export function eventInvitationInput(raw: unknown) {
  const i = objectInput(raw, [
    'clientRequestId',
    'expectedEventVersion',
    'teamId',
    'targetUserId',
    'expiresAt',
  ]);
  if (typeof i.expiresAt !== 'string' || !Number.isFinite(Date.parse(i.expiresAt)))
    invalid('请填写有效邀请期限');
  return {
    clientRequestId: requestId(i.clientRequestId),
    expectedEventVersion: versionInput(i.expectedEventVersion),
    teamId: resourceId(i.teamId as string),
    targetUserId: resourceId(i.targetUserId as string),
    expiresAt: new Date(i.expiresAt).toISOString(),
  };
}
export function eventInvitationDecisionInput(raw: unknown) {
  const i = objectInput(raw, ['clientRequestId', 'expectedVersion', 'type']);
  if (!['ACCEPT', 'DECLINE', 'REVOKE'].includes(i.type as string)) invalid('不支持的邀请操作');
  return {
    clientRequestId: requestId(i.clientRequestId),
    expectedVersion: versionInput(i.expectedVersion),
    type: i.type as 'ACCEPT' | 'DECLINE' | 'REVOKE',
  };
}
