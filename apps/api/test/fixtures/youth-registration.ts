/** Synthetic registration fixture shared by E03/E08. It never invents a paid policy or reviewer result. */
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { EntryData, EventRegistrationData, TeamData } from '@small-city-basketball/contracts';
import { expect } from 'vitest';
import { call, createEvent, data, staffPath } from '../support.js';
import type { Api, User } from '../support.js';
import {
  entry,
  registration,
  registrationCommand,
  roster,
  rules,
  rulesPath,
  team,
  teamPath,
} from '../p03-support.js';
import type { Actor } from '../p03-support.js';

export function syntheticYouthIdentity(birthDate: string, sequence = 1): string {
  // Deliberately non-real district prefix. Format validity is not government verification.
  const first = `990000${birthDate.replaceAll('-', '')}${String(sequence).padStart(3, '0')}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = [...first].reduce((n, digit, i) => n + Number(digit) * weights[i]!, 0);
  return first + '10X98765432'[sum % 11];
}
export interface YouthRosterFixture {
  registration: EventRegistrationData;
  team: TeamData;
  entry: EntryData;
  subjects: Actor[];
  members: {
    actor: Actor;
    memberId: string;
    materialId: string;
    materialRevisionId: string;
    materialVersion: number;
  }[];
}
export interface YouthFixtureOptions {
  api: Api;
  owner: User;
  leader: Actor;
  reviewer: Actor;
  subjects: Actor[];
  birthDates: string[];
  identitySequences?: number[];
  requireInsurance?: boolean;
  /** Reuse an already opened event for the second actual team in a freeze fixture. */
  registration?: EventRegistrationData;
  beforeOpen?: (registration: EventRegistrationData) => Promise<void>;
  beforeMaterial?: (resource: {
    orgId: string;
    eventId: string;
    entryId: string;
    memberId: string;
    subject: Actor;
  }) => Promise<void>;
}
export async function createYouthRosterFixture(
  options: YouthFixtureOptions,
): Promise<YouthRosterFixture> {
  const { api, owner, leader, reviewer, subjects } = options;
  let opened = options.registration;
  if (!opened) {
    const created = await createEvent(
      api,
      owner,
      'E08 synthetic event ' + randomUUID().slice(0, 8),
    );
    data(
      await call(api, 'put', staffPath(owner.orgId, created.id, reviewer.id), {
        cookie: owner.cookie,
        body: { role: 'REVIEWER', status: 'ACTIVE' },
      }),
    );
    const configured = data<EventRegistrationData>(
      await call(api, 'put', rulesPath(owner.orgId, created.id), {
        cookie: owner.cookie,
        body: rules(created.version, {
          requireParticipantMaterials: true,
          requireIdentity: true,
          requireInsurance: options.requireInsurance ?? true,
          minPlayers: 2,
          maxPlayers: 2,
        }),
      }),
    );
    await options.beforeOpen?.(configured);
    opened = await registrationCommand(
      api,
      owner,
      await registration(api, owner, created.id),
      'OPEN_REGISTRATION',
    );
  }
  const eventId = opened!.event.id;
  const target = await team(
    api,
    owner,
    'E08 synthetic team',
    leader,
    subjects.map((_, n) => '合成青少年' + (n + 1)),
  );
  for (let n = 0; n < subjects.length; n++) {
    const actor = subjects[n]!,
      member = target.members[n]!;
    const claim = data<{ claimId: string }>(
      await call(api, 'post', `${teamPath(owner.orgId, target.id)}/members/${member.id}/claims`, {
        cookie: leader.cookie,
        body: { targetUserId: actor.id },
      }),
      201,
    );
    data(
      await call(api, 'post', `/v1/me/member-claims/${claim.claimId}/accept`, {
        cookie: actor.cookie,
        body: {},
      }),
    );
  }
  let currentEntry = await entry(api, owner, eventId, target, leader);
  currentEntry = await roster(api, owner, currentEntry, leader, target.members);
  const portrait = {
    fileName: 'synthetic-child.png',
    contentType: 'image/png',
    base64: (
      await sharp({ create: { width: 32, height: 32, channels: 3, background: '#667788' } })
        .png()
        .toBuffer()
    ).toString('base64'),
  };
  const members: YouthRosterFixture['members'] = [];
  for (let n = 0; n < subjects.length; n++) {
    const actor = subjects[n]!,
      memberId = target.members[n]!.id;
    await options.beforeMaterial?.({
      orgId: owner.orgId,
      eventId,
      entryId: currentEntry.id,
      memberId,
      subject: actor,
    });
    const saved = data<{
      material: { id: string; revisionId: string; version: number; status: string };
    }>(
      await call(
        api,
        'put',
        `/v1/orgs/${owner.orgId}/entries/${currentEntry.id}/participant-materials/mine`,
        {
          cookie: actor.cookie,
          body: {
            clientRequestId: randomUUID(),
            expectedVersion: 0,
            realName: '合成参赛者' + (n + 1),
            identityNumber: syntheticYouthIdentity(
              options.birthDates[n]!,
              options.identitySequences?.[n] ?? n + 1,
            ),
            portrait,
            acceptedTerms: true,
            publicityConsent: false,
          },
        },
      ),
    );
    expect(saved.material.status).toBe('DRAFT');
    members.push({
      actor,
      memberId,
      materialId: saved.material.id,
      materialRevisionId: saved.material.revisionId,
      materialVersion: saved.material.version,
    });
  }
  return { registration: opened!, team: target, entry: currentEntry, subjects, members };
}
