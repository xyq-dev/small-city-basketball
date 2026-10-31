import { describe, expect, test } from 'vitest';
import { sponsorshipSnapshotHash } from '../../../scripts/x18-governance-check.mjs';

const sponsorship = () => ({
  publicKey: 'A'.repeat(43),
  brand: 'Synthetic sponsor',
  title: 'Synthetic published terms',
  body: 'Only synthetic public content',
  label: '广告／赞助',
  startsAt: '2026-10-31T00:00:00.000Z',
  endsAt: '2026-11-01T00:00:00.000Z',
  region: { catalogVersion: 'synthetic-v1', regionId: '00000000-0000-4000-8000-000000000001' },
  measurement: 'CLIENT_REPORTED_DEDUPLICATED',
  serverTime: '2026-10-31T01:00:00.000Z',
});

describe('public sponsorship recovery facts', () => {
  test('preserves every published term while permitting a later valid response clock', () => {
    const original = sponsorship();
    const digest = sponsorshipSnapshotHash(original);
    expect(sponsorshipSnapshotHash({ ...original, serverTime: '2026-10-31T02:00:00.000Z' })).toBe(
      digest,
    );
    for (const field of ['brand', 'title', 'body'] as const)
      expect(sponsorshipSnapshotHash({ ...original, [field]: original[field] + 'B' })).not.toBe(
        digest,
      );
    expect(sponsorshipSnapshotHash({ ...original, publicKey: 'B'.repeat(43) })).not.toBe(digest);
    expect(sponsorshipSnapshotHash({ ...original, endsAt: '2026-11-02T00:00:00.000Z' })).not.toBe(
      digest,
    );
    expect(
      sponsorshipSnapshotHash({
        ...original,
        region: { ...original.region, catalogVersion: 'synthetic-v2' },
      }),
    ).not.toBe(digest);
  });
  test('rejects malformed, missing, extra or out-of-window dynamic metadata', () => {
    for (const serverTime of [
      null,
      'invalid',
      '2026-10-30T23:59:59.999Z',
      '2026-11-01T00:00:00.000Z',
      '2026-10-31T01:00:00+00:00',
    ])
      expect(() => sponsorshipSnapshotHash({ ...sponsorship(), serverTime })).toThrow();
    const { serverTime: _, ...missing } = sponsorship();
    expect(() => sponsorshipSnapshotHash(missing)).toThrow();
    expect(() => sponsorshipSnapshotHash({ ...sponsorship(), expiresAt: 'unexpected' })).toThrow();
    expect(() => sponsorshipSnapshotHash({ ...sponsorship(), title: null })).toThrow();
    expect(() => sponsorshipSnapshotHash({ ...sponsorship(), measurement: 'CONFIRMED' })).toThrow();
  });
});
