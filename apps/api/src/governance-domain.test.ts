import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, test } from 'vitest';
import {
  caseNextState,
  govCommand,
  govHash,
  govQuery,
  parseCampaign,
  parseCaseCreate,
  parseGovernanceAttachment,
  parseLedgerEntry,
  sponsorshipTransition,
} from './governance-domain.js';

const id = randomUUID();
const region = { catalogVersion: 'test-v1', regionId: randomUUID() };
describe('X18 governance boundaries', () => {
  test('operation IDs are strict canonical UUIDv4 and canonical hashing does not depend on object order', () => {
    expect(govCommand(id)).toBe(id);
    expect(() => govCommand(id.toUpperCase())).toThrow();
    expect(() => govCommand('00000000-0000-1000-8000-000000000000')).toThrow();
    expect(govHash({ a: 1, b: { z: 2, x: 3 } })).toBe(govHash({ b: { x: 3, z: 2 }, a: 1 }));
    expect(govHash({ a: null })).not.toBe(govHash({}));
    expect(govHash([1, 2])).not.toBe(govHash([2, 1]));
  });
  test('reports require a verifiable source; appeals require their own parent and reject extra private fields', () => {
    const input = {
      commandId: id,
      orgId: randomUUID(),
      kind: 'REPORT',
      title: '来源核对',
      body: '请核对授权',
    };
    expect(() => parseCaseCreate(input)).toThrow();
    expect(() => parseCaseCreate({ ...input, orgId: undefined, kind: 'SUPPORT' })).toThrow();
    expect(
      parseCaseCreate({
        ...input,
        orgId: undefined,
        source: { kind: 'PUBLIC_EVENT', id: 'a'.repeat(43) },
      }).orgId,
    ).toBeNull();
    expect(
      parseCaseCreate({ ...input, source: { kind: 'PUBLIC_EVENT', id: 'a'.repeat(43) } }).source
        ?.kind,
    ).toBe('PUBLIC_EVENT');
    expect(() => parseCaseCreate({ ...input, kind: 'APPEAL' })).toThrow();
    expect(() =>
      parseCaseCreate({ ...input, kind: 'SUPPORT', parentCaseId: randomUUID() }),
    ).toThrow();
    expect(() =>
      parseCaseCreate({ ...input, kind: 'SUPPORT', identityNumber: 'private' }),
    ).toThrow();
  });
  test('case transitions separate requester, assigned handler and platform triage', () => {
    const requester = { requester: true, handler: false, operator: false };
    const handler = { requester: false, handler: true, operator: false };
    expect(caseNextState('OPEN', 'CLOSE', requester)).toBe('CLOSED');
    expect(caseNextState('CLOSED', 'REOPEN', requester)).toBe('OPEN');
    expect(() => caseNextState('CLOSED', 'CLOSE', requester)).toThrow();
    expect(() => caseNextState('OPEN', 'ASSIGN', requester)).toThrow();
    expect(() => caseNextState('OPEN', 'RESOLVE', handler)).toThrow();
    expect(caseNextState('ASSIGNED', 'RESOLVE', handler)).toBe('RESOLVED');
    expect(() => caseNextState('ASSIGNED', 'RESOLVE', { ...handler, requester: true })).toThrow();
    expect(() => caseNextState('CLOSED', 'RESOLVE', handler)).toThrow();
  });
  test('pagination is bounded and arbitrary query keys are rejected', () => {
    expect(govQuery({}).limit).toBe(30);
    expect(() => govQuery({ limit: 101 })).toThrow();
    expect(() => govQuery({ limit: '1e2', private: true })).toThrow();
    expect(() => govQuery({ before: 'not-id' })).toThrow();
  });
  test('campaigns have bounded real date windows and immutable approval flows', () => {
    const input = {
      commandId: id,
      region,
      brand: '赞助方',
      title: '赛事支持',
      body: '明确广告标识',
      startsAt: '2028-01-01T00:00:00Z',
      endsAt: '2028-01-02T00:00:00Z',
    };
    expect(parseCampaign(input).brand).toBe('赞助方');
    expect(() => parseCampaign({ ...input, endsAt: input.startsAt })).toThrow();
    expect(() => parseCampaign({ ...input, endsAt: '2030-01-01T00:00:00Z' })).toThrow();
    expect(sponsorshipTransition('DRAFT', 'SUBMIT', false)).toBe('SUBMITTED');
    expect(() => sponsorshipTransition('SUBMITTED', 'APPROVE', false)).toThrow();
    expect(sponsorshipTransition('SUBMITTED', 'APPROVE', true)).toBe('APPROVED');
    expect(() => sponsorshipTransition('WITHDRAWN', 'PUBLISH', true)).toThrow();
  });
  test('offline ledger records require exact signed cents and never accept a wallet or payment field', () => {
    const input = {
      commandId: id,
      expectedVersion: 1,
      occurredOn: '2028-02-29',
      label: '场地卫生费',
      kind: 'EXPENSE',
      amountFen: -5000,
    };
    expect(parseLedgerEntry(input).amountFen).toBe(-5000);
    expect(() => parseLedgerEntry({ ...input, amountFen: 5000 })).toThrow();
    expect(() => parseLedgerEntry({ ...input, amountFen: -5.5 })).toThrow();
    expect(() => parseLedgerEntry({ ...input, kind: 'REVERSAL' })).toThrow();
    expect(() => parseLedgerEntry({ ...input, balance: 10000 })).toThrow();
    expect(() => parseLedgerEntry({ ...input, occurredOn: '2029-02-29' })).toThrow();
  });
  test('attachments decode real images, remove metadata, preserve private access classification and reject mismatches', async () => {
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#123C73' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const base = {
      expectedVersion: 1,
      fileName: '凭证.jpg',
      contentType: 'image/jpeg',
      base64: image.toString('base64'),
      visibility: 'INTERNAL',
    };
    const parsed = await parseGovernanceAttachment(base);
    expect(parsed.visibility).toBe('INTERNAL');
    expect((await sharp(parsed.bytes).metadata()).exif).toBeUndefined();
    expect((await sharp(parsed.bytes).metadata()).orientation).toBeUndefined();
    await expect(
      parseGovernanceAttachment({ ...base, contentType: 'image/png' }),
    ).rejects.toThrow();
    await expect(
      parseGovernanceAttachment({ ...base, fileName: '../private.jpg' }),
    ).rejects.toThrow();
    await expect(
      parseGovernanceAttachment({ ...base, base64: Buffer.from('not image').toString('base64') }),
    ).rejects.toThrow();
    await expect(
      parseGovernanceAttachment({ ...base, base64: base.base64 + '=' }),
    ).rejects.toThrow();
  });
  test('PDF is bounded and must have a real header/trailer; arbitrary HTML and URLs are refused', async () => {
    const base = {
      expectedVersion: 1,
      fileName: '票据.pdf',
      contentType: 'application/pdf',
      visibility: 'REQUESTER',
      base64: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64'),
    };
    expect((await parseGovernanceAttachment(base)).contentType).toBe('application/pdf');
    await expect(
      parseGovernanceAttachment({
        ...base,
        base64: Buffer.from('<html>secret</html>').toString('base64'),
      }),
    ).rejects.toThrow();
    await expect(
      parseGovernanceAttachment({ ...base, url: 'https://example.test/private' }),
    ).rejects.toThrow();
    await expect(
      parseGovernanceAttachment({
        ...base,
        base64: Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64'),
      }),
    ).rejects.toThrow();
  });
});
