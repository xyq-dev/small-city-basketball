import type { Response } from 'supertest';
import { expect } from 'vitest';
import type {
  OverlayCommandInput,
  OverlayCommandResponse,
  OverlayWorkbenchData,
} from '@small-city-basketball/contracts';
import { call, data, setCookies } from './support.js';
import type { User } from './support.js';
import type { Harness } from './p05-support.js';

export {
  act,
  acquire,
  assign,
  closeHarness,
  createScoringHarness,
  finish,
  liveMatch,
  prepare,
  published,
  release,
  workbench,
} from './p05-support.js';
export { confirmMatch, reopen, withRowsLocked } from './p05b-support.js';
export { APPLICATION_NAME, blockedPid } from './p04-support.js';
export type { Harness, PublishedFixture } from './p05-support.js';

export const overlayWorkbenchPath = (orgId: string, matchId: string) =>
  `/v1/orgs/${orgId}/matches/${matchId}/overlay`;
export const overlayCommandsPath = (orgId: string, matchId: string) =>
  `/v1/orgs/${orgId}/matches/${matchId}/overlay-commands`;
export const bootstrapPath = (overlayId: string) => `/v1/overlays/${overlayId}/bootstrap`;
export const overlaySnapshotPath = (overlayId: string) => `/v1/overlays/${overlayId}/snapshot`;

// Keep one-time credentials out of failure messages emitted by generic body assertions.
export function overlayData<T>(response: Response): T {
  expect(response.status).toBe(200);
  expect(response.body.meta?.requestId).toEqual(expect.any(String));
  expect(Object.hasOwn(response.body, 'error')).toBe(false);
  return response.body.data as T;
}

export async function overlayWorkbench(h: Harness, matchId: string, actor: User = h.owner) {
  return data<OverlayWorkbenchData>(
    await call(h.api, 'get', overlayWorkbenchPath(h.owner.orgId, matchId), {
      cookie: actor.cookie,
    }),
  );
}

export const overlayCommand = (
  h: Harness,
  matchId: string,
  input: OverlayCommandInput,
  actor: User = h.owner,
) =>
  call(h.api, 'post', overlayCommandsPath(h.owner.orgId, matchId), {
    cookie: actor.cookie,
    body: input,
  });

export async function issue(
  h: Harness,
  matchId: string,
  expiresInMinutes = 60,
  actor: User = h.owner,
) {
  const current = await overlayWorkbench(h, matchId, actor);
  return overlayData<OverlayCommandResponse>(
    await overlayCommand(
      h,
      matchId,
      {
        type: 'ISSUE',
        expectedEventVersion: current.event.version,
        expiresInMinutes,
      },
      actor,
    ),
  );
}

export async function rotate(
  h: Harness,
  matchId: string,
  expiresInMinutes = 60,
  reason = '更换只读源链接',
  actor: User = h.owner,
) {
  const current = await overlayWorkbench(h, matchId, actor);
  if (!current.currentGrant) throw new Error('The rotate fixture requires an existing grant');
  return overlayData<OverlayCommandResponse>(
    await overlayCommand(
      h,
      matchId,
      {
        type: 'ROTATE',
        expectedEventVersion: current.event.version,
        overlayId: current.currentGrant.overlayId,
        expectedGrantVersion: current.currentGrant.version,
        expiresInMinutes,
        reason,
      },
      actor,
    ),
  );
}

export async function revoke(
  h: Harness,
  matchId: string,
  reason = '撤销只读源链接',
  actor: User = h.owner,
) {
  const current = await overlayWorkbench(h, matchId, actor);
  if (!current.currentGrant) throw new Error('The revoke fixture requires an existing grant');
  return overlayData<OverlayCommandResponse>(
    await overlayCommand(
      h,
      matchId,
      {
        type: 'REVOKE',
        expectedEventVersion: current.event.version,
        overlayId: current.currentGrant.overlayId,
        expectedGrantVersion: current.currentGrant.version,
        reason,
      },
      actor,
    ),
  );
}

// These endpoints deliberately have no default private cookie or other account credentials.
export const bootstrap = (
  h: Harness,
  overlayId: string,
  token: string,
  cookie?: string,
  origin?: string | null,
) => call(h.api, 'post', bootstrapPath(overlayId), { body: { token }, cookie, origin });
export const overlaySnapshot = (h: Harness, overlayId: string, cookie?: string) =>
  call(h.api, 'get', overlaySnapshotPath(overlayId), { cookie });

export function overlayCookie(response: Response): string {
  const cookie = setCookies(response).find((value) => value.startsWith('scb.overlay='));
  if (!cookie) throw new Error('Expected the dedicated overlay cookie');
  return cookie.split(';')[0]!;
}
