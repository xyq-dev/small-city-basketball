// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchMediaWorkspaceData } from '@small-city-basketball/contracts';
import { createApiClient } from '../api/client';
import type { RegistrationWorkspace } from '../registration/shared';
import { response } from '../viewing/test-fixtures';
import { EntryFilesPanel, MediaPanel, MediaPlayer } from './MediaPanels';
import { PublicMediaPanel } from './PublicMediaPanel';
import { entry, file, workspace, publicMedia } from './test-fixtures';
const context = (fetcher: typeof fetch): RegistrationWorkspace => ({
  client: createApiClient({ fetcher }),
  organizationId: 'org-a',
  userId: 'user-a',
  onSessionRefresh: async () => {},
});
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('actual media workspace interactions (mock HTTP only)', () => {
  it('opens private attachments explicitly, uploads selected bytes with the seen entry version and never embeds insurance PDFs', async () => {
    let uploaded = false;
    const pdf = {
      ...file,
      purpose: 'PRIVATE_INSURANCE',
      rosterRevisionId: 'roster-a',
      fileName: 'synthetic.pdf',
      contentType: 'application/pdf',
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_p, init) => {
      if (init?.method === 'POST') {
        uploaded = true;
        return response(pdf, {}, 201);
      }
      return response({ ...entry, files: uploaded ? [pdf] : [] });
    });
    render(<EntryFilesPanel context={context(fetcher)} entryId="entry-a" />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '管理报名私有文件' }));
    await screen.findByLabelText('选择文件');
    change('文件用途', 'PRIVATE_INSURANCE');
    fireEvent.change(screen.getByLabelText('选择文件'), {
      target: {
        files: [new File(['%PDF-1.4\n%%EOF\n'], 'synthetic.pdf', { type: 'application/pdf' })],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '上传并保存文件' }));
    expect(await screen.findByRole('link', { name: '下载synthetic.pdf' })).toHaveAttribute(
      'href',
      '/v1/orgs/org-a/entries/entry-a/media-files/file-a/content',
    );
    expect(document.querySelector('iframe,object,embed')).toBeNull();
    const posted = JSON.parse(
      String(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]?.body),
    );
    expect(posted).toMatchObject({
      purpose: 'PRIVATE_INSURANCE',
      fileName: 'synthetic.pdf',
      expectedEntryVersion: 4,
    });
    expect(atob(posted.base64)).toBe('%PDF-1.4\n%%EOF\n');
    expect(screen.getByRole('region', { name: '报名私有文件' })).toHaveTextContent('永不匿名');
  });
  it('trusts server read-only file capabilities rather than the workspace role', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ...entry,
        capabilities: { canUpload: false, canRevoke: false, canPurge: false },
      }),
    );
    render(<EntryFilesPanel context={context(fetcher)} entryId="entry-a" />);
    fireEvent.click(screen.getByRole('button', { name: '管理报名私有文件' }));
    expect(await screen.findByText('尚无已保存文件。')).toBeVisible();
    expect(screen.queryByLabelText('选择文件')).not.toBeInTheDocument();
  });
  it('requires a second publish confirmation and cancellation sends no write', async () => {
    let current: MatchMediaWorkspaceData = structuredClone(workspace);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_p, init) => {
      if (init?.method === 'POST') {
        current = {
          ...current,
          media: [{ ...current.media[0]!, status: 'PUBLISHED', version: 2 }],
        };
        return response(current.media[0]);
      }
      return response(current);
    });
    render(<MediaPanel context={context(fetcher)} matchId="match-a" />);
    fireEvent.click(screen.getByRole('button', { name: '管理比赛媒体' }));
    fireEvent.click(await screen.findByRole('button', { name: '公开发布媒体' }));
    let dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('私有保险凭证永不进入媒体列表');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(fetcher.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '公开发布媒体' }));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认公开发布媒体' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1),
    );
    expect(
      JSON.parse(String(fetcher.mock.calls.find(([, i]) => i?.method === 'POST')![1]?.body)),
    ).toEqual({ type: 'PUBLISH', expectedVersion: 1 });
  });
  it('submits exact millisecond positions against the current confirmation, preserves input on conflict and prevents replay', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_p, init) =>
        init?.method === 'POST'
          ? response({ code: 'MEDIA_SOURCE_STALE', message: '源确认已改变' }, {}, 409)
          : response(workspace),
      );
    render(<MediaPanel context={context(fetcher)} matchId="match-a" />);
    fireEvent.click(screen.getByRole('button', { name: '管理比赛媒体' }));
    await screen.findByLabelText('合成回放 原计分事件');
    change('合成回放 原计分事件', 'event-point-a');
    change('合成回放 片段说明', '合成定位');
    change('合成回放 片段开始秒数', '1.001');
    change('合成回放 片段结束秒数', '2.125');
    fireEvent.click(screen.getByRole('button', { name: '保存人工对时标记' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存人工对时标记' })).toBeDisabled(),
    );
    expect(screen.getByLabelText('合成回放 片段开始秒数')).toHaveValue(1.001);
    expect(
      JSON.parse(String(fetcher.mock.calls.find(([, i]) => i?.method === 'POST')![1]?.body)),
    ).toMatchObject({
      expectedVersion: 1,
      expectedConfirmationId: 'confirmation-a',
      sourceEventId: 'event-point-a',
      startMs: 1001,
      endMs: 2125,
    });
    expect(fetcher.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1);
  });
  it('positions the actual video element and pauses at the manually marked end without claiming rendered clips', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    render(
      <MediaPlayer
        kind="VIDEO"
        title="合成视频"
        src="/bounded.mp4"
        markers={[{ label: '片段', startMs: 100, endMs: 750 }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '定位片段' }));
    const video = screen.getByLabelText('合成视频') as HTMLVideoElement;
    expect(video.currentTime).toBe(0.1);
    video.currentTime = 0.8;
    fireEvent.timeUpdate(video);
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
describe('anonymous media revocation and stale source handling', () => {
  it.each([403, 404, 410])(
    'unmounts every player after media authorization returns %i',
    async (status) => {
      vi.useFakeTimers();
      let revoked = false;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          revoked
            ? response({ code: 'RESOURCE_NOT_FOUND', message: 'gone' }, {}, status)
            : response(publicMedia),
        );
      render(
        <PublicMediaPanel
          publicEventId={publicMedia.publicEventId}
          publicMatchId={publicMedia.publicMatchId}
          fetcher={fetcher}
        />,
      );
      await act(async () => {});
      expect(screen.getByLabelText('已公开合成回放')).toHaveAttribute(
        'src',
        publicMedia.media[0]!.contentPath,
      );
      revoked = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(document.querySelector('video,img')).toBeNull();
      expect(screen.getByText('当前媒体不可用或授权已撤销。')).toBeVisible();
      expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'omit')).toBe(true);
    },
  );
  it('hides media sources during network failure and restores them only after a successful authorized reread', async () => {
    vi.useFakeTimers();
    let failure = false;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (failure) throw new Error('offline');
      return response(publicMedia);
    });
    render(
      <PublicMediaPanel
        publicEventId={publicMedia.publicEventId}
        publicMatchId={publicMedia.publicMatchId}
        fetcher={fetcher}
      />,
    );
    await act(async () => {});
    expect(document.querySelector('video')).not.toBeNull();
    failure = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(document.querySelector('video')).toBeNull();
    failure = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(document.querySelector('video')).not.toBeNull();
  });
});
