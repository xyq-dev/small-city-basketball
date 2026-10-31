import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  eventInvitationDecisionInput,
  eventInvitationInput,
  importCommitInput,
  importPreviewInput,
  normalizedName,
  publicRecruitmentId,
  publishRecruitmentInput,
  recruitmentApplicationInput,
  recruitmentReviewInput,
  requestFingerprint,
  requestId,
} from './recruitment-domain.js';

const cid = () => randomUUID();
const publish = () => ({
  clientRequestId: cid(),
  expectedEventVersion: 3,
  title: '公开招募',
  description: '公开规程与申请说明',
  closesAt: '2028-03-01T18:00:00+08:00',
  maxApplications: 32,
});
describe('X05 bounded recruitment requests and source fingerprints', () => {
  test('canonicalizes equivalent field order but retains null and array order', () => {
    expect(canonicalJson({ z: [2, 1], a: { b: 2, a: 1 } })).toBe('{"a":{"a":1,"b":2},"z":[2,1]}');
    expect(requestFingerprint({ b: 2, a: 1 })).toBe(requestFingerprint({ a: 1, b: 2 }));
    expect(requestFingerprint({ a: null })).not.toBe(requestFingerprint({}));
    expect(requestFingerprint([1, 2])).not.toBe(requestFingerprint([2, 1]));
  });
  test('strict UUIDv4 request identifiers do not silently change case or IDs', () => {
    const id = cid();
    expect(requestId(id)).toBe(id);
    for (const value of [null, id.toUpperCase(), '00000000-0000-0000-0000-000000000000', 'next'])
      expect(() => requestId(value)).toThrow();
  });
  test('publication has a bounded capacity, safe text and explicit date zone', () => {
    const p = publishRecruitmentInput(publish());
    expect(p.closesAt).toBe('2028-03-01T10:00:00.000Z');
    for (const patch of [
      { maxApplications: 0 },
      { maxApplications: 257 },
      { closesAt: '2028-02-30T18:00:00Z' },
      { closesAt: '2028-03-01T18:00:00' },
      { title: '\0' },
      { privateRoster: [] },
    ])
      expect(() => publishRecruitmentInput({ ...publish(), ...patch })).toThrow();
  });
  test('public identifier is opaque and does not accept an internal UUID', () => {
    expect(publicRecruitmentId('A'.repeat(43))).toBe('A'.repeat(43));
    expect(() => publicRecruitmentId(cid())).toThrow();
  });
  test('applicant cannot inject approval, grants or another user', () => {
    const i = recruitmentApplicationInput({
      clientRequestId: cid(),
      teamName: ' 青锋队 ',
      note: '',
    });
    expect(i).toMatchObject({ teamName: '青锋队', teamId: null, note: null });
    for (const field of ['applicantId', 'status', 'role', 'entryId'])
      expect(() =>
        recruitmentApplicationInput({
          clientRequestId: cid(),
          teamName: '青锋队',
          [field]: 'APPROVED',
        }),
      ).toThrow();
  });
  test('independent decision requires an explicit bounded reason and current version', () => {
    expect(
      recruitmentReviewInput({
        clientRequestId: cid(),
        expectedVersion: 1,
        type: 'APPROVE',
        reason: '核对球队参赛意向',
      }).type,
    ).toBe('APPROVE');
    expect(() =>
      recruitmentReviewInput({
        clientRequestId: cid(),
        expectedVersion: 0,
        type: 'APPROVE',
        reason: '通过',
      }),
    ).toThrow();
    expect(() =>
      recruitmentReviewInput({
        clientRequestId: cid(),
        expectedVersion: 1,
        type: 'ACCEPT',
        reason: '核对球队参赛意向',
      }),
    ).toThrow();
  });
  test('bulk preview returns row-local errors and does not silently discard invalid rows', () => {
    const r = importPreviewInput({
      clientRequestId: cid(),
      expectedEventVersion: 1,
      rows: [
        { teamName: 'Alpha' },
        { teamName: 'Ａｌｐｈａ' },
        { teamName: '二队', privateIdentity: 'do not import' },
      ],
    });
    expect(r.rows).toHaveLength(3);
    expect(r.issues.map((x) => [x.row, x.code])).toEqual([
      [2, 'DUPLICATE_ROW'],
      [3, 'INVALID_ROW'],
    ]);
    expect(normalizedName('  Ａlpha   队 ')).toBe('alpha 队');
  });
  test('team IDs distinguish intended existing teams and duplicate IDs remain errors', () => {
    const id = cid();
    const r = importPreviewInput({
      clientRequestId: cid(),
      expectedEventVersion: 1,
      rows: [
        { teamName: '同名', teamId: id },
        { teamName: '同名', teamId: cid() },
        { teamName: '再次', teamId: id },
      ],
    });
    expect(r.issues.map((x) => x.row)).toEqual([3]);
  });
  test('batch bounds and commit preview hashes are fail closed', () => {
    for (const rows of [[], Array.from({ length: 33 }, () => ({ teamName: '队' }))])
      expect(() =>
        importPreviewInput({ clientRequestId: cid(), expectedEventVersion: 1, rows }),
      ).toThrow();
    const input = {
      clientRequestId: cid(),
      expectedEventVersion: 1,
      previewId: cid(),
      previewHash: requestFingerprint({ rows: [] }),
    };
    expect(importCommitInput(input)).toEqual(input);
    expect(() => importCommitInput({ ...input, previewHash: 'client says valid' })).toThrow();
  });
  test('event invitations bind concrete users/teams and cannot inject a grant role', () => {
    const input = {
      clientRequestId: cid(),
      expectedEventVersion: 1,
      teamId: cid(),
      targetUserId: cid(),
      expiresAt: '2028-01-01T10:00:00Z',
    };
    expect(eventInvitationInput(input).targetUserId).toBe(input.targetUserId);
    expect(() => eventInvitationInput({ ...input, role: 'ORG_OWNER' })).toThrow();
    expect(
      eventInvitationDecisionInput({ clientRequestId: cid(), expectedVersion: 1, type: 'DECLINE' })
        .type,
    ).toBe('DECLINE');
    expect(() =>
      eventInvitationDecisionInput({ clientRequestId: cid(), expectedVersion: 1, type: 'GRANT' }),
    ).toThrow();
  });
});
