import { MATCH_STATUSES } from '@small-city-basketball/contracts';
import type {
  OverlayBootstrapData,
  OverlayCommandInput,
  OverlayCommandResponse,
  OverlayPreviewData,
  OverlaySnapshotData,
  OverlayWorkbenchData,
} from '@small-city-basketball/contracts';
import { ApiError } from './client';
import type { ApiClient } from './client';

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: unknown, keys: string[]) =>
  obj(v) && keys.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => keys.includes(k));
const text = (v: unknown, keys: string[]) => obj(v) && keys.every((k) => typeof v[k] === 'string');
const ints = (v: unknown, keys: string[]) =>
  obj(v) && keys.every((k) => Number.isInteger(v[k]) && Number(v[k]) >= 0);
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const totals = (v: unknown) =>
  exact(v, ['score', 'fouls', 'timeouts']) && ints(v, ['score', 'fouls', 'timeouts']);
const previewKeys = [
  'eventName',
  'home',
  'away',
  'status',
  'matchVersion',
  'score',
  'totals',
  'periods',
  'rules',
  'clock',
  'collected',
  'resultStatus',
  'serverTime',
];
function preview(v: unknown) {
  if (
    !obj(v) ||
    !text(v, ['eventName']) ||
    !date(v.serverTime) ||
    !ints(v, ['matchVersion']) ||
    !MATCH_STATUSES.includes(v.status as (typeof MATCH_STATUSES)[number]) ||
    !['UNCONFIRMED', 'CONFIRMED', 'REQUIRES_RECONFIRMATION'].includes(String(v.resultStatus)) ||
    !exact(v.home, ['teamName']) ||
    !text(v.home, ['teamName']) ||
    !exact(v.away, ['teamName']) ||
    !text(v.away, ['teamName']) ||
    !exact(v.collected, ['teamScore', 'teamFouls', 'teamTimeouts', 'playerStatistics']) ||
    !obj(v.collected) ||
    v.collected.playerStatistics !== false
  )
    return false;
  if (v.score === null)
    return (
      v.totals === null &&
      v.periods === null &&
      v.rules === null &&
      v.clock === null &&
      v.collected.teamScore === false &&
      v.collected.teamFouls === false &&
      v.collected.teamTimeouts === false
    );
  return (
    exact(v.score, ['home', 'away']) &&
    ints(v.score, ['home', 'away']) &&
    exact(v.totals, ['home', 'away']) &&
    obj(v.totals) &&
    totals(v.totals.home) &&
    totals(v.totals.away) &&
    Array.isArray(v.periods) &&
    v.periods.every(
      (p) =>
        exact(p, ['period', 'home', 'away']) &&
        ints(p, ['period']) &&
        obj(p) &&
        totals(p.home) &&
        totals(p.away),
    ) &&
    exact(v.clock, ['period', 'remainingMs', 'running', 'anchorServerTime', 'clockVersion']) &&
    obj(v.clock) &&
    ints(v.clock, ['period', 'remainingMs', 'clockVersion']) &&
    typeof v.clock.running === 'boolean' &&
    date(v.clock.anchorServerTime) &&
    exact(v.rules, [
      'regulationPeriods',
      'periodDurationSeconds',
      'allowedScoreValues',
      'tiePolicy',
      'overtimeDurationSeconds',
      'version',
    ]) &&
    obj(v.rules) &&
    ints(v.rules, ['regulationPeriods', 'periodDurationSeconds', 'version']) &&
    Array.isArray(v.rules.allowedScoreValues) &&
    v.rules.allowedScoreValues.length > 0 &&
    v.rules.allowedScoreValues.every(
      (n) => [1, 2, 3].includes(Number(n)) && typeof n === 'number',
    ) &&
    ['ALLOW_DRAW', 'OVERTIME'].includes(String(v.rules.tiePolicy)) &&
    (v.rules.tiePolicy === 'ALLOW_DRAW'
      ? v.rules.overtimeDurationSeconds === null
      : Number.isInteger(v.rules.overtimeDurationSeconds)) &&
    v.collected.teamScore === true &&
    v.collected.teamFouls === true &&
    v.collected.teamTimeouts === true
  );
}
function grant(v: unknown) {
  return (
    exact(v, [
      'overlayId',
      'template',
      'status',
      'version',
      'createdAt',
      'expiresAt',
      'revokedAt',
      'revocationReason',
    ]) &&
    text(v, ['overlayId']) &&
    obj(v) &&
    v.template === 'SCOREBAR_1080P_V1' &&
    ['ACTIVE', 'EXPIRED', 'REVOKED'].includes(String(v.status)) &&
    ints(v, ['version']) &&
    date(v.createdAt) &&
    date(v.expiresAt) &&
    (v.revokedAt === null || date(v.revokedAt)) &&
    (v.revocationReason === null || typeof v.revocationReason === 'string')
  );
}
function workbench(v: unknown, command = false) {
  return (
    exact(v, [
      'event',
      'matchId',
      'preview',
      'previewError',
      'currentGrant',
      'history',
      'historyLimit',
      'historyTruncated',
      'capabilities',
      'serverTime',
      ...(command ? ['credential'] : []),
    ]) &&
    obj(v) &&
    exact(v.event, ['id', 'name', 'version']) &&
    text(v.event, ['id', 'name']) &&
    ints(v.event, ['version']) &&
    text(v, ['matchId']) &&
    date(v.serverTime) &&
    (v.preview === null || (exact(v.preview, previewKeys) && preview(v.preview))) &&
    (v.previewError === null ||
      (exact(v.previewError, ['code', 'message']) &&
        obj(v.previewError) &&
        v.previewError.code === 'RESULT_SOURCE_INVALID' &&
        text(v.previewError, ['message']))) &&
    (v.currentGrant === null ||
      (grant(v.currentGrant) && obj(v.currentGrant) && v.currentGrant.status !== 'REVOKED')) &&
    Array.isArray(v.history) &&
    v.history.length <= 20 &&
    v.history.every((g) => grant(g) && obj(g) && g.status === 'REVOKED') &&
    v.historyLimit === 20 &&
    typeof v.historyTruncated === 'boolean' &&
    exact(v.capabilities, ['canIssue', 'canRotate', 'canRevoke']) &&
    obj(v.capabilities) &&
    ['canIssue', 'canRotate', 'canRevoke'].every(
      (k) => typeof (v.capabilities as Obj)[k] === 'boolean',
    ) &&
    (!command ||
      v.credential === null ||
      (exact(v.credential, ['overlayId', 'token']) && text(v.credential, ['overlayId', 'token'])))
  );
}
function checked<T>(v: unknown, guard: (v: unknown) => boolean): T {
  if (!guard(v)) throw new ApiError(200, 'INVALID_RESPONSE', '包装资料格式不完整，请重新读取');
  return v as T;
}
export function createOverlayManagementApi(client: ApiClient, organizationId: string) {
  if (!organizationId.trim()) throw new ApiError(0, 'INVALID_ORGANIZATION', '请先选择机构');
  const base = (matchId: string) =>
    `/v1/orgs/${encodeURIComponent(organizationId)}/matches/${encodeURIComponent(matchId)}`;
  return {
    workbench: async (matchId: string) =>
      checked<OverlayWorkbenchData>(
        (await client.request<unknown>(`${base(matchId)}/overlay`)).data,
        workbench,
      ),
    command: async (matchId: string, input: OverlayCommandInput) =>
      checked<OverlayCommandResponse>(
        (
          await client.request<unknown>(`${base(matchId)}/overlay-commands`, {
            method: 'POST',
            body: JSON.stringify(input),
          })
        ).data,
        (v) => workbench(v, true),
      ),
  };
}
export function createOverlaySourceApi({ fetcher }: { fetcher?: typeof fetch } = {}) {
  async function request(id: string, path: string, signal?: AbortSignal, token?: string) {
    const response = await (fetcher ?? globalThis.fetch)(
      `/v1/overlays/${encodeURIComponent(id)}/${path}`,
      {
        method: token === undefined ? 'GET' : 'POST',
        ...(token === undefined ? {} : { body: JSON.stringify({ token }) }),
        headers: {
          Accept: 'application/json',
          ...(token === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      },
    ).catch(() => {
      throw new ApiError(0, 'NETWORK_ERROR', '暂时无法读取包装数据');
    });
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      value = undefined;
    }
    if (!response.ok)
      throw new ApiError(
        response.status,
        response.status === 404
          ? 'OVERLAY_NOT_FOUND'
          : obj(value) && obj(value.error) && value.error.code === 'RESULT_SOURCE_INVALID'
            ? 'RESULT_SOURCE_INVALID'
            : 'OVERLAY_UNAVAILABLE',
        response.status === 404 ? '包装链接不可用' : '暂时无法读取包装数据',
      );
    if (
      !obj(value) ||
      !obj(value.meta) ||
      typeof value.meta.requestId !== 'string' ||
      !Object.hasOwn(value, 'data')
    )
      throw new ApiError(200, 'INVALID_RESPONSE', '包装资料格式不完整');
    return value.data;
  }
  return {
    bootstrap: async (id: string, token: string, signal?: AbortSignal) =>
      checked<OverlayBootstrapData>(
        await request(id, 'bootstrap', signal, token),
        (v) =>
          exact(v, ['overlayId', 'expiresAt', 'serverTime']) &&
          obj(v) &&
          v.overlayId === id &&
          date(v.expiresAt) &&
          date(v.serverTime),
      ),
    snapshot: async (id: string, signal?: AbortSignal) =>
      checked<OverlaySnapshotData>(
        await request(id, 'snapshot', signal),
        (v) =>
          exact(v, [...previewKeys, 'overlayId', 'template', 'expiresAt']) &&
          preview(v) &&
          obj(v) &&
          v.overlayId === id &&
          v.template === 'SCOREBAR_1080P_V1' &&
          date(v.expiresAt),
      ),
  };
}
export type OverlaySourceApi = ReturnType<typeof createOverlaySourceApi>;
export type OverlayManagementApi = ReturnType<typeof createOverlayManagementApi>;
export type { OverlayPreviewData };
