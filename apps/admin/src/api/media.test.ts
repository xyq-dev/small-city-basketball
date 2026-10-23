import { describe, expect, it, vi } from 'vitest';
import { checkedPublicMedia, createMediaApi, readPublicMedia } from './media';
import { publicMedia } from '../media/test-fixtures';
import { createApiClient } from './client';
import { response } from '../viewing/test-fixtures';
describe('strict media adapters', () => {
  it('rejects internal IDs, raw payloads and arbitrary content paths from anonymous media', () => {
    expect(
      checkedPublicMedia(publicMedia, publicMedia.publicEventId, publicMedia.publicMatchId),
    ).toEqual(publicMedia);
    for (const key of ['fileId', 'entryId', 'payload', 'roster']) {
      const copy = structuredClone(publicMedia);
      Object.assign(copy.media[0]!, { [key]: 'private' });
      expect(() => checkedPublicMedia(copy, copy.publicEventId, copy.publicMatchId)).toThrow(
        '不完整',
      );
    }
    const copy = structuredClone(publicMedia);
    copy.media[0]!.contentPath = '/v1/orgs/private/file/content';
    expect(() => checkedPublicMedia(copy, copy.publicEventId, copy.publicMatchId)).toThrow(
      '不完整',
    );
  });
  it('preserves cookie omission and rejects the wrong public parent identity', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(publicMedia));
    await readPublicMedia(
      publicMedia.publicEventId,
      publicMedia.publicMatchId,
      new AbortController().signal,
      fetcher,
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store' });
    expect(() => checkedPublicMedia(publicMedia, 'wrong', publicMedia.publicMatchId)).toThrow(
      '不完整',
    );
  });
  it('rejects an empty organization before any upload request', () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createMediaApi(createApiClient({ fetcher }), '', 'entries', 'entry')).toThrow(
      '请选择',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
