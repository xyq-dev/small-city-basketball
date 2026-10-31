import { describe, expect, test, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { UnifiedSearchService } from './unified-search-service.js';
import { archiveProjection } from './public-archives-domain.js';
import { parsePublicSearch } from './unified-search-domain.js';

type Row = Record<string, any>;
const key = (n: number) => String(n).padStart(43, '0');
const internalId = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const numberOf = (id: string) => Number(id.slice(-12));

function fixture(
  count: number,
  visible: (n: number) => boolean,
  inRegion: (n: number) => boolean = () => true,
) {
  const rows = Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      key: 'P:' + key(n),
      kind: 'PLAYER',
      public_key: key(n),
      display_name: '合成公开球员 ' + n,
      city: null,
      starts_on: null,
      ends_on: null,
      listing_id: null,
      profile: {
        id: internalId(n),
        kind: 'PLAYER',
        owner_user_id: internalId(n + 1000),
        public_key: key(n),
        display_name: '合成公开球员 ' + n,
        consented_at: '2028-01-01T00:00:00Z',
      },
    };
  });
  const candidateReads: { after: string; limit: number }[] = [];
  const checked: number[] = [];
  const locked = new Set<number>();
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql === 'SELECT statement_timestamp() AS now')
      return { rows: [{ now: new Date('2028-01-01T00:00:00Z') }] };
    if (sql.includes('FROM candidates WHERE')) {
      const after = params[5] as string,
        limit = params[6] as number;
      candidateReads.push({ after, limit });
      return { rows: rows.filter((row) => row.key > after).slice(0, limit) };
    }
    if (sql.includes('WHERE g.id=ANY($4::uuid[])')) {
      const permitted = params[3] as string[];
      return { rowCount: permitted.some((id) => inRegion(numberOf(id))) ? 1 : 0, rows: [] };
    }
    throw new Error('Unexpected fixture query');
  });
  const client = { query } as unknown as PoolClient;
  class Search extends UnifiedSearchService {
    protected override async rateLimit() {}
    protected override async snapshotRead<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
      return work(client);
    }
    protected override async lockPublicSources(_c: PoolClient, profiles: Row[]) {
      for (const profile of profiles) locked.add(numberOf(profile.id));
    }
    protected override async currentArchiveSources(_c: PoolClient, profiles: Row[]) {
      return profiles.flatMap((profile) => {
        const n = numberOf(profile.id);
        expect(locked.has(n)).toBe(true);
        checked.push(n);
        return visible(n) ? [{ id: profile.id }] : [];
      });
    }
    protected override async projection(
      _c: PoolClient,
      profile: Row,
      asOf: string,
      permitted?: Row[],
    ) {
      return archiveProjection(
        {
          kind: 'PLAYER',
          publicKey: profile.public_key,
          displayName: profile.display_name,
          publishedAt: profile.consented_at,
        },
        [],
        permitted!.length,
        asOf,
      );
    }
  }
  const service = new Search({} as Pool, {
    databaseUrl: 'postgresql://synthetic@127.0.0.1/scb_test_search',
    appOrigin: 'http://localhost:5173',
  });
  return { service, candidateReads, checked };
}

describe('visible unified search pagination', () => {
  test('a full raw page without current permission cannot hide a later authorized match', async () => {
    const { service, candidateReads, checked } = fixture(21, (n) => n === 21);
    const result = await service.search({ q: '合成', kind: 'PLAYER' }, 'synthetic-peer');
    expect(result.items.map((item) => item.publicKey)).toEqual([key(21)]);
    expect(result.nextCursor).toBeNull();
    expect(candidateReads).toHaveLength(2);
    expect(checked).toHaveLength(21);
    for (const item of result.items)
      expect(Object.keys(item).sort()).toEqual([
        'city',
        'displayName',
        'endsOn',
        'kind',
        'publicKey',
        'startsOn',
      ]);
    expect(JSON.stringify(result)).not.toContain(internalId(21));
  });

  test('stopping in the middle of a raw batch resumes immediately after the last inspected item', async () => {
    const { service, candidateReads } = fixture(25, (n) => n % 2 === 1);
    const input = { q: '合成', kind: 'PLAYER', limit: '2' };
    const first = await service.search(input, 'synthetic-peer');
    expect(first.items.map((item) => item.publicKey)).toEqual([key(1), key(3)]);
    expect(parsePublicSearch({ ...input, cursor: first.nextCursor }).after).toBe('P:' + key(3));
    const second = await service.search({ ...input, cursor: first.nextCursor }, 'synthetic-peer');
    expect(second.items.map((item) => item.publicKey)).toEqual([key(5), key(7)]);
    expect(candidateReads[1]!.after).toBe('P:' + key(3));
  });

  test('the scan budget retains continuation without inspecting or skipping the 201st candidate', async () => {
    const { service, candidateReads, checked } = fixture(201, (n) => n === 201);
    const input = { q: '合成', kind: 'PLAYER' };
    const first = await service.search(input, 'synthetic-peer');
    expect(first.items).toEqual([]);
    expect(candidateReads).toHaveLength(10);
    expect(checked).toHaveLength(200);
    expect(checked).not.toContain(201);
    expect(parsePublicSearch({ ...input, cursor: first.nextCursor }).after).toBe('P:' + key(200));
    const second = await service.search({ ...input, cursor: first.nextCursor }, 'synthetic-peer');
    expect(second.items.map((item) => item.publicKey)).toEqual([key(201)]);
    expect(second.nextCursor).toBeNull();
  });

  test('region checks still use permitted current sources before filling the visible page', async () => {
    const { service, candidateReads } = fixture(
      21,
      () => true,
      (n) => n === 21,
    );
    const result = await service.search(
      { q: '合成', kind: 'PLAYER', city: '合成当前城市' },
      'synthetic-peer',
    );
    expect(result.items.map((item) => item.publicKey)).toEqual([key(21)]);
    expect(candidateReads).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });
});
