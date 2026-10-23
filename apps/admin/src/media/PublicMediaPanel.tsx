import { useCallback } from 'react';
import { readPublicMedia } from '../api/media';
import { usePublicResource } from '../viewing/usePublicResource';
import { MediaPlayer } from './MediaPanels';
import './media.css';
export function PublicMediaPanel({
  publicEventId,
  publicMatchId,
  fetcher,
}: {
  publicEventId: string;
  publicMatchId: string;
  fetcher?: typeof fetch;
}) {
  return (
    <PublicMedia
      key={`${publicEventId}:${publicMatchId}`}
      event={publicEventId}
      match={publicMatchId}
      fetcher={fetcher}
    />
  );
}
function PublicMedia({
  event,
  match,
  fetcher,
}: {
  event: string;
  match: string;
  fetcher?: typeof fetch;
}) {
  const read = useCallback(
    (signal: AbortSignal) => readPublicMedia(event, match, signal, fetcher),
    [event, match, fetcher],
  );
  const resource = usePublicResource(read);
  return (
    <section className="panel media-panel" aria-label="公开比赛媒体">
      <h2>比赛图片与回放</h2>
      {!resource.data ? (
        <p role="status">
          {resource.loading ? '正在读取已公开媒体…' : '当前媒体不可用或授权已撤销。'}
        </p>
      ) : (
        <>
          {(!resource.online || resource.stale) && (
            <p role="status">网络中断，当前为上次读取媒体；恢复后重新核对授权。</p>
          )}
          {resource.online && !resource.stale ? (
            <div className="media-grid">
              {resource.data.media.map((m) => (
                <article className="media-card" key={m.publicMediaId}>
                  <h3>{m.title}</h3>
                  {m.contentPath && (
                    <MediaPlayer
                      kind={m.kind}
                      title={m.title}
                      src={m.contentPath}
                      markers={m.markers}
                    />
                  )}{' '}
                  {m.kind === 'EXTERNAL_LINK' && m.externalUrl && (
                    <>
                      <a href={m.externalUrl} target="_blank" rel="noopener noreferrer">
                        打开外部直播或回放
                      </a>
                      <p className="media-note">{m.externalNotice}</p>
                    </>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p>媒体需要重新核验，恢复连接后再播放。</p>
          )}
          {!resource.data.media.length && <p>主办方尚未发布本场媒体。</p>}
        </>
      )}
      <p className="media-note">
        只读且遵循原观赛授权；平台撤销会阻止后续媒体请求，已下载内容和外部源无法远程撤回。片段定位由人工对时，不代表已生成剪辑文件。
      </p>
    </section>
  );
}
