import { useCallback, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  EntryFilesData,
  MatchMediaWorkspaceData,
  MediaFileData,
  MediaFilePurpose,
  MatchMediaData,
} from '@small-city-basketball/contracts';
import { ApiError } from '../api/client';
import { createMediaApi, readUploadFile } from '../api/media';
import type { RegistrationWorkspace } from '../registration/shared';
import {
  ActionNotice,
  ResourceState,
  useAction,
  useResource,
  message,
} from '../registration/shared';
import { Modal } from '../scoring/Dialogs';
import './media.css';
function milliseconds(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value)) return NaN;
  const [seconds, fraction = ''] = value.split('.');
  return Number(seconds) * 1000 + Number(fraction.padEnd(3, '0'));
}
const size = (v: number) => `${(v / 1048576).toFixed(2)} MiB`;
const org = (c: RegistrationWorkspace) => c.teamContext?.orgId ?? c.organizationId ?? '';
export function EntryFilesPanel({
  context,
  entryId,
}: {
  context: RegistrationWorkspace;
  entryId: string;
}) {
  return org(context) ? (
    <MediaDisclosure
      key={`${org(context)}:${entryId}`}
      context={context}
      id={entryId}
      scope="entries"
    />
  ) : null;
}
export function MediaPanel({
  context,
  matchId,
}: {
  context: RegistrationWorkspace;
  matchId: string;
}) {
  return org(context) && !context.teamContext ? (
    <MediaDisclosure
      key={`${org(context)}:${matchId}`}
      context={context}
      id={matchId}
      scope="matches"
    />
  ) : null;
}
function MediaDisclosure({
  context,
  id,
  scope,
}: {
  context: RegistrationWorkspace;
  id: string;
  scope: 'entries' | 'matches';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="button button-secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? '收起' : scope === 'entries' ? '管理报名私有文件' : '管理比赛媒体'}
      </button>
      {open && <FilesPanel context={context} id={id} scope={scope} />}
    </>
  );
}
function FilesPanel({
  context,
  id,
  scope,
}: {
  context: RegistrationWorkspace;
  id: string;
  scope: 'entries' | 'matches';
}) {
  const api = useMemo(
    () => createMediaApi(context.client, org(context), scope, id),
    [context.client, context.organizationId, context.teamContext?.orgId, scope, id],
  );
  const read = useCallback(
    async () => (scope === 'entries' ? await api.entry() : await api.match()),
    [api, scope],
  );
  const resource = useResource(read);
  const action = useAction();
  const [file, setFile] = useState<File | null>(null),
    [purpose, setPurpose] = useState<MediaFilePurpose>(
      scope === 'entries' ? 'REGISTRATION_DOC' : 'MATCH_IMAGE',
    );
  const [localError, setLocalError] = useState(''),
    [blocked, setBlocked] = useState(false);
  const [fileDecision, setFileDecision] = useState<{
      file: MediaFileData;
      type: 'REVOKE' | 'PURGE';
    } | null>(null),
    [reason, setReason] = useState('');
  const [kind, setKind] = useState<'IMAGE' | 'VIDEO' | 'EXTERNAL_LINK'>('IMAGE'),
    [fileId, setFileId] = useState(''),
    [title, setTitle] = useState(''),
    [rights, setRights] = useState(''),
    [external, setExternal] = useState('');
  const [mediaDecision, setMediaDecision] = useState<{
    media: MatchMediaData;
    type: 'PUBLISH' | 'REVOKE';
  } | null>(null);
  const [markers, setMarkers] = useState<
    Record<string, { source: string; label: string; start: string; end: string }>
  >({});
  const data = resource.data;
  const match = scope === 'matches' ? (data as MatchMediaWorkspaceData | undefined) : undefined;
  function refresh() {
    if (action.busy) return;
    setFileDecision(null);
    setMediaDecision(null);
    setLocalError('');
    setBlocked(false);
    action.clear();
    resource.reload();
  }
  async function run(job: () => Promise<unknown>, notice: string) {
    let succeeded = false;
    await action.run(async () => {
      try {
        await job();
        if (action.isActive()) {
          succeeded = true;
          resource.reload();
        }
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) setBlocked(true);
        throw cause;
      }
    }, notice);
    return succeeded;
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (!file || !data || blocked) return;
    try {
      const encoded = await readUploadFile(file);
      if (!action.isActive()) return;
      const ok = await run(
        () =>
          api.upload({
            ...encoded,
            purpose,
            ...(scope === 'entries'
              ? { expectedEntryVersion: (data as EntryFilesData).entryVersion }
              : {}),
          }),
        '文件已安全保存；上传不代表通过保险或报名审核',
      );
      if (ok) setFile(null);
    } catch (cause) {
      setLocalError(message(cause));
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    setLocalError('');
    if (!title.trim() || Array.from(rights.trim()).length < 4) {
      setLocalError('请填写标题及至少4字的发布权利声明');
      return;
    }
    await run(
      () =>
        api.create({
          kind,
          title: title.trim(),
          rightsDeclaration: rights.trim(),
          ...(kind === 'EXTERNAL_LINK' ? { externalUrl: external } : { fileId }),
        }),
      '私有媒体草稿已创建，尚未公开',
    );
  }
  async function addMarker(media: MatchMediaData) {
    const v = markers[media.id];
    setLocalError('');
    if (!v || !match?.currentConfirmationId) return;
    const start = milliseconds(v.start),
      end = milliseconds(v.end);
    if (
      !v.source ||
      !v.label.trim() ||
      !v.start.trim() ||
      !v.end.trim() ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start
    ) {
      setLocalError('请选择原记录并填写有效片段起止秒数和说明');
      return;
    }
    await run(
      () =>
        api.marker(media.id, {
          expectedVersion: media.version,
          expectedConfirmationId: match.currentConfirmationId!,
          sourceEventId: v.source,
          label: v.label.trim(),
          startMs: start,
          endMs: end,
        }),
      '人工对时标记已保存，未生成转码或剪辑文件',
    );
  }
  const unavailable = action.busy || blocked || resource.loading;
  return (
    <section
      className="panel media-panel"
      aria-label={scope === 'entries' ? '报名私有文件' : '比赛媒体管理'}
    >
      <h2>{scope === 'entries' ? '报名资料与外购保险凭证' : '比赛媒体与片段定位'}</h2>
      <p className="media-note">
        {scope === 'entries'
          ? '文件仅本人获授权球队和赛事审核人员可读，永不匿名。上传不等于投保、承保或资格审核通过。'
          : '媒体先保存为私有草稿，由赛事负责人显式发布。只处理受限小文件与人工定位；未接通推流或付费转码。'}
      </p>
      <button className="button button-secondary" disabled={action.busy} onClick={refresh}>
        刷新媒体资料
      </button>
      <ActionNotice action={action} onReload={refresh} />
      {localError && <p role="alert">{localError}</p>}
      {blocked && (
        <p role="alert">资料或额度状态冲突。输入已保留，请显式刷新核对，不会自动重放。</p>
      )}
      {!data ? (
        <ResourceState {...resource} />
      ) : (
        <>
          <p className="media-note">
            机构已用{size(data.usage.usedBytes)} / {size(data.usage.limitBytes)}
            ，单文件最多8MiB。撤销仍占用额度，明确清除内容后才释放；历史备份不承诺同步擦除。
          </p>
          {data.capabilities.canUpload && (
            <form className="media-form" onSubmit={(e) => void upload(e)}>
              <label>
                文件用途
                <select
                  aria-label="文件用途"
                  value={purpose}
                  disabled={unavailable}
                  onChange={(e) => setPurpose(e.target.value as MediaFilePurpose)}
                >
                  {scope === 'entries' ? (
                    <>
                      <option value="REGISTRATION_DOC">报名资料</option>
                      <option value="PRIVATE_INSURANCE">外购保险凭证</option>
                    </>
                  ) : (
                    <>
                      <option value="MATCH_IMAGE">比赛图片</option>
                      <option value="MATCH_VIDEO">MP4短视频</option>
                    </>
                  )}
                </select>
              </label>
              <label>
                选择文件
                <input
                  aria-label="选择文件"
                  type="file"
                  accept={scope === 'entries' ? '.pdf,.png,.jpg,.jpeg' : '.png,.jpg,.jpeg,.mp4'}
                  disabled={unavailable}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                className="button button-primary"
                disabled={unavailable || !file}
                type="submit"
              >
                上传并保存文件
              </button>
            </form>
          )}
          <ul className="media-file-list" aria-label="已保存文件">
            {data.files.map((f) => (
              <li key={f.id}>
                <strong className="media-file-name">{f.fileName}</strong>
                <small>
                  {f.purpose === 'PRIVATE_INSURANCE' ? '私有保险凭证' : f.contentType} ·{' '}
                  {size(f.byteLength)} ·{' '}
                  {f.status === 'ACTIVE'
                    ? '可读取'
                    : f.status === 'PURGED'
                      ? '已清除内容'
                      : '已撤销'}{' '}
                  · v{f.version}
                  {scope === 'entries' &&
                    f.rosterRevisionId !== null &&
                    (f.rosterRevisionId === (data as EntryFilesData).rosterRevisionId
                      ? ' · 对应当前名单'
                      : ' · 对应历史名单，请核对')}
                </small>
                <div className="media-actions">
                  {f.status === 'ACTIVE' && (
                    <a className="button button-secondary" href={api.contentPath(f.id)} download>
                      下载{f.fileName}
                    </a>
                  )}
                  {f.status === 'ACTIVE' &&
                    ('canRevoke' in data.capabilities
                      ? data.capabilities.canRevoke
                      : match?.capabilities.canPurge) && (
                      <button
                        className="button button-secondary"
                        disabled={unavailable}
                        onClick={() => setFileDecision({ file: f, type: 'REVOKE' })}
                      >
                        撤销文件
                      </button>
                    )}
                  {f.status === 'REVOKED' && data.capabilities.canPurge && (
                    <button
                      className="button button-secondary"
                      disabled={unavailable}
                      onClick={() => setFileDecision({ file: f, type: 'PURGE' })}
                    >
                      清除文件内容
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!data.files.length && <p>尚无已保存文件。</p>}
          {match && (
            <>
              {match.capabilities.canManage && (
                <form className="media-form" onSubmit={(e) => void create(e)}>
                  <h3>建立媒体草稿</h3>
                  <label>
                    媒体类型
                    <select
                      aria-label="媒体类型"
                      value={kind}
                      disabled={unavailable}
                      onChange={(e) => {
                        setKind(e.target.value as typeof kind);
                        setFileId('');
                      }}
                    >
                      <option value="IMAGE">比赛图片</option>
                      <option value="VIDEO">自持MP4短视频</option>
                      <option value="EXTERNAL_LINK" disabled={!match.trustedExternalHosts.length}>
                        公共外部直播或回放
                      </option>
                    </select>
                  </label>
                  {kind === 'EXTERNAL_LINK' ? (
                    <label>
                      受信HTTPS媒体地址
                      <input
                        aria-label="受信HTTPS媒体地址"
                        value={external}
                        onChange={(e) => setExternal(e.target.value)}
                        disabled={unavailable}
                      />
                      <small>
                        仅允许{match.trustedExternalHosts.join('、')}。外部已知地址不能由本站撤回。
                      </small>
                    </label>
                  ) : (
                    <label>
                      已上传媒体文件
                      <select
                        aria-label="已上传媒体文件"
                        value={fileId}
                        onChange={(e) => setFileId(e.target.value)}
                        disabled={unavailable}
                      >
                        <option value="">请选择有效文件</option>
                        {match.files
                          .filter(
                            (f) =>
                              f.status === 'ACTIVE' &&
                              f.purpose === (kind === 'IMAGE' ? 'MATCH_IMAGE' : 'MATCH_VIDEO'),
                          )
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.fileName}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label>
                    媒体标题
                    <input
                      aria-label="媒体标题"
                      value={title}
                      maxLength={120}
                      onChange={(e) => setTitle(e.target.value)}
                      disabled={unavailable}
                    />
                  </label>
                  <label>
                    发布权利声明
                    <textarea
                      aria-label="发布权利声明"
                      value={rights}
                      maxLength={1000}
                      onChange={(e) => setRights(e.target.value)}
                      disabled={unavailable}
                    />
                  </label>
                  <button
                    className="button button-primary"
                    disabled={unavailable || (kind !== 'EXTERNAL_LINK' && !fileId)}
                  >
                    保存私有媒体草稿
                  </button>
                </form>
              )}
              <div className="media-grid">
                {match.media.map((m) => {
                  const values = markers[m.id] ?? { source: '', label: '', start: '', end: '' };
                  const set = (field: keyof typeof values, value: string) =>
                    setMarkers((prev) => ({ ...prev, [m.id]: { ...values, [field]: value } }));
                  return (
                    <article className="media-card" key={m.id}>
                      <h3>{m.title}</h3>
                      <p>
                        {m.status === 'DRAFT'
                          ? '私有草稿'
                          : m.status === 'PUBLISHED'
                            ? '已显式发布'
                            : '已撤销'}{' '}
                        · v{m.version}
                      </p>
                      {m.status !== 'REVOKED' &&
                        m.fileId &&
                        match.files.some((f) => f.id === m.fileId && f.status === 'ACTIVE') && (
                          <MediaPlayer
                            kind={m.kind}
                            title={m.title}
                            src={api.contentPath(m.fileId)}
                            markers={m.markers.filter((v) => v.sourceStatus === 'CURRENT')}
                          />
                        )}
                      {m.kind === 'EXTERNAL_LINK' && m.externalUrl && (
                        <p>
                          <a href={m.externalUrl} target="_blank" rel="noopener noreferrer">
                            打开外部直播或回放
                          </a>{' '}
                          · 第三方地址无法由本站撤回
                        </p>
                      )}
                      {m.markers.some((v) => v.sourceStatus === 'STALE') && (
                        <p className="media-note">
                          有人工标记的源确认已失效。旧标记不公开，需基于新独立确认重新核对并建立草稿。
                        </p>
                      )}
                      {m.status === 'DRAFT' && m.kind === 'VIDEO' && match.capabilities.canMark && (
                        <div className="media-form">
                          <label>
                            原计分事件
                            <select
                              aria-label={`${m.title} 原计分事件`}
                              value={values.source}
                              onChange={(e) => set('source', e.target.value)}
                            >
                              <option value="">请选择当前有效确认中的原记录</option>
                              {match.sourceEvents.map((e) => (
                                <option key={e.id} value={e.id}>
                                  #{e.seq} {e.type}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            片段说明
                            <input
                              aria-label={`${m.title} 片段说明`}
                              value={values.label}
                              maxLength={120}
                              onChange={(e) => set('label', e.target.value)}
                            />
                          </label>
                          <label>
                            片段开始秒数
                            <input
                              aria-label={`${m.title} 片段开始秒数`}
                              type="number"
                              step="0.001"
                              value={values.start}
                              onChange={(e) => set('start', e.target.value)}
                            />
                          </label>
                          <label>
                            片段结束秒数
                            <input
                              aria-label={`${m.title} 片段结束秒数`}
                              type="number"
                              step="0.001"
                              value={values.end}
                              onChange={(e) => set('end', e.target.value)}
                            />
                          </label>
                          <button
                            className="button button-secondary"
                            disabled={unavailable}
                            onClick={() => void addMarker(m)}
                          >
                            保存人工对时标记
                          </button>
                        </div>
                      )}
                      <div className="media-actions">
                        {m.status === 'DRAFT' && match.capabilities.canPublish && (
                          <button
                            className="button button-primary"
                            disabled={unavailable}
                            onClick={() => setMediaDecision({ media: m, type: 'PUBLISH' })}
                          >
                            公开发布媒体
                          </button>
                        )}
                        {m.status !== 'REVOKED' && match.capabilities.canPurge && (
                          <button
                            className="button button-secondary"
                            disabled={unavailable}
                            onClick={() => setMediaDecision({ media: m, type: 'REVOKE' })}
                          >
                            撤销媒体发布
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
      {fileDecision && (
        <Modal
          title={fileDecision.type === 'PURGE' ? '清除文件内容' : '撤销文件'}
          busy={action.busy}
          onClose={() => setFileDecision(null)}
        >
          <p>
            {fileDecision.file.fileName} · v{fileDecision.file.version}
          </p>
          <p>
            {fileDecision.type === 'PURGE'
              ? '清除后正文无法恢复，元数据及审计仍保留。不会删除历史备份。'
              : '撤销后本平台下载和媒体读取立即不可再请求；已经下载的内容无法远程撤回。'}
          </p>
          <label className="media-form">
            文件操作原因
            <textarea
              aria-label="文件操作原因"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {action.error && <p role="alert">{action.error}</p>}
          <button
            className="button button-primary"
            disabled={unavailable}
            onClick={() => {
              if (Array.from(reason.trim()).length < 4) {
                setLocalError('请填写至少4字的文件操作原因');
                return;
              }
              void run(
                () =>
                  api.fileCommand(fileDecision.file.id, {
                    type: fileDecision.type,
                    expectedVersion: fileDecision.file.version,
                    reason: reason.trim(),
                  }),
                '文件状态已更新',
              ).then((ok) => {
                if (ok) setFileDecision(null);
              });
            }}
          >
            确认{fileDecision.type === 'PURGE' ? '清除文件内容' : '撤销文件'}
          </button>
          <button
            className="button button-secondary"
            disabled={action.busy}
            onClick={() => setFileDecision(null)}
          >
            取消
          </button>
        </Modal>
      )}
      {mediaDecision && (
        <Modal
          title={mediaDecision.type === 'PUBLISH' ? '公开发布媒体' : '撤销媒体发布'}
          busy={action.busy}
          onClose={() => setMediaDecision(null)}
        >
          <p>
            {mediaDecision.media.title} · v{mediaDecision.media.version}
          </p>
          <p>
            {mediaDecision.type === 'PUBLISH'
              ? '仅在主办方现有有效观赛授权范围展示。确认你有权公开此内容；私有保险凭证永不进入媒体列表。'
              : '撤销后本平台不再提供此媒体；已下载文件或已知第三方链接无法远程撤回。'}
          </p>
          {action.error && <p role="alert">{action.error}</p>}
          <button
            className="button button-primary"
            disabled={unavailable}
            onClick={() =>
              void run(
                () =>
                  api.command(mediaDecision.media.id, {
                    type: mediaDecision.type,
                    expectedVersion: mediaDecision.media.version,
                  }),
                '媒体发布状态已更新',
              ).then((ok) => {
                if (ok) setMediaDecision(null);
              })
            }
          >
            确认{mediaDecision.type === 'PUBLISH' ? '公开发布媒体' : '撤销媒体发布'}
          </button>
          <button
            className="button button-secondary"
            disabled={action.busy}
            onClick={() => setMediaDecision(null)}
          >
            取消
          </button>
        </Modal>
      )}
    </section>
  );
}
export function MediaPlayer({
  kind,
  title,
  src,
  markers,
}: {
  kind: string;
  title: string;
  src: string;
  markers: { label: string; startMs: number; endMs: number }[];
}) {
  const player = useRef<HTMLVideoElement | null>(null),
    stop = useRef<number | null>(null);
  if (kind === 'IMAGE') return <img src={src} alt={title} loading="lazy" />;
  if (kind !== 'VIDEO') return null;
  return (
    <>
      <video
        aria-label={title}
        ref={player}
        src={src}
        controls
        preload="metadata"
        onTimeUpdate={() => {
          if (
            player.current &&
            stop.current !== null &&
            player.current.currentTime >= stop.current
          ) {
            player.current.pause();
            stop.current = null;
          }
        }}
      />
      {markers.map((m, i) => (
        <div className="media-marker" key={`${i}:${m.startMs}`}>
          <button
            className="button button-secondary"
            onClick={() => {
              if (!player.current) return;
              player.current.currentTime = m.startMs / 1000;
              stop.current = m.endMs / 1000;
              void player.current.play().catch(() => {});
            }}
          >
            定位{m.label}
          </button>
          <span>
            {m.startMs / 1000}–{m.endMs / 1000}秒 · 人工对时
          </span>
        </div>
      ))}
    </>
  );
}
