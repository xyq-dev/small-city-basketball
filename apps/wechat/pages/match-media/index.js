const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const media = require('../../utils/media');
const requests = require('../../utils/media-request');
const scoring = require('../../utils/scoring');

// Match media over the existing C05 workspace: private upload -> draft record -> explicit
// publish / revoke. Uploading never publishes, and publication is still only visible through
// the event's public-viewing grant.
//
// C19: new uploads and drafts carry a request identity (docs/design/C19_CONTRACTS.md §2). The
// original request ID and immutable metadata (content SHA-256 included) are stored on the device
// before anything is sent; a failed store sends nothing. An unknown outcome is resolved by the
// original ID's receipt; a missing receipt (404) only allows resending the same ID and content
// after the local file is re-read and its digest matches. Files larger than one 512 KiB chunk go
// through an upload session: progress is only what the server has confirmed, chunk completion
// and the final file check are shown separately, and success is shown only for the final
// receipt. Records are per account + organization + match; another account never sees or
// cleans them.
//
// Records written by the earlier client (scb.mediaPending.v1, no request identity) keep their
// manual check path below and are never presented as idempotent requests.
const UPLOAD_TIMEOUT = 120000;
const eventLabels = {
  ...scoring.commandNames,
  STAT_RECORDED: '记录',
  STAT_VOIDED: '撤销记录',
  STAT_REPLACED: '更正记录',
  CORRECTION_ADDED: '补录更正',
};
const pad = (v) => String(v).padStart(2, '0');
function clock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  return (h ? h + ':' + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ':' + pad(s % 60);
}
// A client-side mirror of the server rule; the server stays authoritative.
function trustedLink(value, hosts) {
  const m = /^https:\/\/([a-z0-9.-]+)(\/[^\s#]*)?$/i.exec(value || '');
  if (!m || value.length > 2048) return false;
  const host = m[1].toLowerCase();
  return hosts.includes(host) && !/^\d+(\.\d+){3}$/.test(host) && host !== 'localhost';
}
const PENDING_KEY = 'scb.mediaPending.v1';
const PENDING_LIMIT = 20;
const STORAGE_FAILED =
  '本机存储读写失败，无法可靠记录或核对未知操作，已停止上传和创建草稿。请检查微信存储空间后重新进入本页。';
const PENDING_FULL =
  '本机已有 20 条未核对的媒体记录（可能属于其他比赛或账号），请先到相应比赛核对或结束这些记录，再上传或创建草稿。';
const CLEAR_FAILED = '本机存储写入失败，未能结束该记录，保护仍保留。请检查微信存储空间后重试。';
/** The record map, or null when storage cannot be read or holds something unexpected. */
function readPendingStore() {
  let value;
  try {
    value = wx.getStorageSync(PENDING_KEY);
  } catch {
    return null;
  }
  if (value === '' || value === undefined || value === null) return {};
  return typeof value === 'object' && !Array.isArray(value) ? value : null;
}
function writePendingStore(map) {
  try {
    wx.setStorageSync(PENDING_KEY, map);
    return true;
  } catch {
    return false;
  }
}
const privateDefaults = {
  match: null,
  usage: null,
  files: [],
  items: [],
  caps: null,
  draftFiles: [],
  draftIndex: 0,
  title: '',
  rights: '',
  revokeId: '',
  revokeReason: '',
  purgeId: '',
  purgeReason: '',
  draftMode: 'FILE',
  externalUrl: '',
  trustedHosts: [],
  sources: [],
  markerFor: '',
  marker: { sourceIndex: 0, label: '', start: '', end: '' },
  previewVideo: '',
  upload: null,
  canRetry: false,
  uncertain: false,
  pending: null,
  request: null,
  storageError: '',
  unavailable: false,
};

Page({
  data: { loading: false, busy: false, error: '', notice: '', ...privateDefaults },
  onLoad(query = {}) {
    this._alive = true;
    this._visible = true;
    this._temporaryFiles = [];
    media.sweepTemps(wx);
    requests.sweepStaged(wx);
    try {
      this.orgId = api.uuid(query.orgId);
      this.matchId = api.uuid(query.matchId);
    } catch {
      this.setData({ unavailable: true, error: '媒体入口无效，请从比赛详情重新进入。' });
      return;
    }
    this.load();
  },
  onShow() {
    this._visible = true;
  },
  onHide() {
    this._visible = false;
    this.closePreview();
  },
  onUnload() {
    this._alive = false;
    this._visible = false;
    this._load = (this._load || 0) + 1;
    this.closePreview();
    ui.close(this);
  },
  onSessionReset() {
    this._load = (this._load || 0) + 1;
    this._data = null;
    this._retry = null;
    this._viewer = '';
    this.closePreview();
    this.setData({
      ...privateDefaults,
      loading: false,
      busy: false,
      error: '登录身份已变化，已清除上一身份的媒体资料。',
    });
  },
  base() {
    return '/v1/orgs/' + this.orgId + '/matches/' + this.matchId;
  },
  async load() {
    if (!this.orgId || this.data.loading || this.data.busy) return;
    const client = api.getClient();
    const load = (this._load = (this._load || 0) + 1);
    const current = () => this._alive && load === this._load;
    if (!client.hasSession()) {
      this.setData({ ...privateDefaults, unavailable: true, error: '请先登录后管理比赛媒体。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    let session;
    try {
      session = await events.session(client);
    } catch (error) {
      if (current()) this.setData({ ...privateDefaults, loading: false, error: ui.message(error) });
      return;
    }
    if (!current()) return;
    this._viewer = session.user.id;
    const token = ui.begin(this);
    const live = () => ui.live(this, token) && current();
    try {
      const [workspace, wb] = await Promise.all([
        client.request(this.base() + '/media').then((r) => r.data),
        client.request(this.base() + '/scoring').then(
          (r) => r.data,
          () => null,
        ),
      ]);
      if (!live()) return;
      this.show(workspace, wb);
      // An unresolved request with an unknown outcome is looked up by its original ID first.
      // Automatic only once per page and request, so a record that cannot be cleared never loops.
      const stored = this.requestState().record;
      this._autoQueried = this._autoQueried || {};
      if (
        stored &&
        stored.v === 2 &&
        ['unknown', 'absent', 'session'].includes(stored.state || 'unknown') &&
        !this._autoQueried[stored.clientRequestId]
      ) {
        this._autoQueried[stored.clientRequestId] = true;
        await this.queryRequest(true);
      }
    } catch (error) {
      if (!live()) return;
      const hidden = error.status === 401 || error.status === 403 || error.status === 404;
      this.setData({
        ...(hidden ? privateDefaults : {}),
        loading: false,
        unavailable: hidden,
        error: hidden ? '该比赛不存在或当前身份不能管理本场媒体。' : media.failure(error),
      });
    }
  },
  show(w, wb) {
    this._data = w;
    const used = new Set(
      w.media.filter((m) => m.status !== 'REVOKED' && m.fileId).map((m) => m.fileId),
    );
    const files = w.files
      .filter((f) => f.purpose === 'MATCH_IMAGE' || f.purpose === 'MATCH_VIDEO')
      .map((f) => ({
        id: f.id,
        name: f.fileName,
        kind: f.purpose === 'MATCH_IMAGE' ? '图片' : '视频',
        size: media.size(f.byteLength),
        status: f.status,
        statusLabel:
          f.status === 'ACTIVE'
            ? used.has(f.id)
              ? '已私有保存 · 已关联媒体'
              : '已私有保存 · 未关联、未发布'
            : media.fileLabels[f.status] || f.status,
        time: ui.localTime(f.createdAt),
        canRevoke: f.status === 'ACTIVE' && !!w.capabilities.canManage,
        canPreview: f.status === 'ACTIVE',
        // Clearing content is irreversible and only follows a revoke (server rule).
        canPurge: f.status === 'REVOKED' && !!w.capabilities.canPurge,
      }));
    const draftFiles = files.filter((f) => f.status === 'ACTIVE' && !used.has(f.id));
    const state = this.pendingState();
    const current = this.requestState();
    this.setData({
      loading: false,
      unavailable: false,
      uncertain: false,
      match: wb
        ? {
            title: wb.match.home.teamName + ' VS ' + wb.match.away.teamName,
            meta: wb.event.name + ' · ' + api.matchStatus(w.matchStatus),
          }
        : { title: '本场比赛', meta: api.matchStatus(w.matchStatus) },
      usage: {
        label:
          '机构已用 ' +
          media.size(w.usage.usedBytes) +
          ' / ' +
          media.size(w.usage.limitBytes) +
          ' · 单个文件不超过 ' +
          media.size(w.usage.maxFileBytes),
      },
      files,
      items: w.media.map((m) => ({
        id: m.id,
        title: m.title,
        kind: m.kind === 'IMAGE' ? '图片' : m.kind === 'VIDEO' ? '视频' : '外部链接',
        status: m.status,
        statusLabel: media.statusLabels[m.status] || m.status,
        rights: m.rightsDeclaration,
        externalUrl: m.kind === 'EXTERNAL_LINK' ? m.externalUrl || '' : '',
        markers: m.markers.length,
        markerList: m.markers.map((k) => ({
          key: k.id,
          text: k.label + ' · ' + clock(k.startMs) + '–' + clock(k.endMs),
          stale: k.sourceStatus === 'STALE',
        })),
        stale: m.markers.some((k) => k.sourceStatus === 'STALE'),
        // Manual time markers: private video drafts of an independently confirmed result.
        canMark:
          m.kind === 'VIDEO' &&
          m.status === 'DRAFT' &&
          !!w.capabilities.canMark &&
          !!w.currentConfirmationId,
        canPublish: m.status === 'DRAFT' && !!w.capabilities.canPublish,
        canRevoke: m.status !== 'REVOKED' && !!w.capabilities.canManage,
      })),
      caps: {
        upload: !!w.capabilities.canUpload,
        manage: !!w.capabilities.canManage,
        publish: !!w.capabilities.canPublish,
      },
      draftFiles,
      draftIndex: Math.min(this.data.draftIndex, Math.max(draftFiles.length - 1, 0)),
      trustedHosts: (w.trustedExternalHosts || []).slice(0, 20),
      draftMode:
        w.trustedExternalHosts && w.trustedExternalHosts.length ? this.data.draftMode : 'FILE',
      sources: w.sourceEvents.map((v) => ({
        id: v.id,
        label:
          '#' + v.seq + ' ' + (eventLabels[v.type] || v.type) + ' · ' + ui.timePart(v.serverTime),
      })),
      request: this.requestView(current.record),
      canRetry: !!(
        current.record &&
        current.record.op === 'upload' &&
        (this.requestView(current.record) || {}).canResend
      ),
      pending: this.pendingView(w),
      storageError: state.ok && current.ok ? '' : STORAGE_FAILED,
    });
  },
  pendingKey() {
    return this._viewer ? this._viewer + ':' + this.orgId + ':' + this.matchId : '';
  },
  /** { ok: false } when storage cannot be read; never reported as "no record". */
  pendingState() {
    const key = this.pendingKey();
    const map = key ? readPendingStore() : null;
    return map ? { ok: true, record: map[key] || null } : { ok: false, record: null };
  },
  /** Stores (or with null, removes) this page's record; returns '' or why it could not. */
  setPending(record) {
    const key = this.pendingKey();
    const map = key ? readPendingStore() : null;
    if (!map) return STORAGE_FAILED;
    const next = { ...map };
    if (record) {
      if (!next[key] && Object.keys(next).length >= PENDING_LIMIT) return PENDING_FULL;
      next[key] = record;
    } else delete next[key];
    return writePendingStore(next) ? '' : record ? STORAGE_FAILED : CLEAR_FAILED;
  },
  // What the organizer can check: records created since the unknown attempt that look like it.
  // Shown as candidates only; equality of name/size/file is not proof of this request.
  pendingView(w) {
    const r = this.pendingState().record;
    if (!r || !w) return null;
    const known = new Set(r.known || []);
    const candidates =
      r.op === 'upload'
        ? w.files
            .filter((f) => !known.has(f.id) && f.fileName === r.name && f.byteLength === r.size)
            .map((f) => ({
              id: f.id,
              text:
                f.fileName + ' · ' + media.size(f.byteLength) + ' · ' + ui.localTime(f.createdAt),
            }))
        : w.media
            .filter(
              (m) =>
                !known.has(m.id) &&
                (r.fileId
                  ? m.fileId === r.fileId
                  : !!m.externalUrl && m.externalUrl === r.externalUrl),
            )
            .map((m) => ({
              id: m.id,
              text: m.title + ' · ' + (media.statusLabels[m.status] || m.status),
            }));
    return {
      op: r.op,
      title: r.op === 'upload' ? '上传结果未知：' + r.name : '草稿创建结果未知：' + r.title,
      at: ui.localTime(new Date(r.at).toISOString()),
      candidates,
    };
  },
  confirmPending(e) {
    const view = this.data.pending;
    const id = e.currentTarget.dataset.id;
    if (!view || this.data.busy || !view.candidates.some((c) => c.id === id)) return;
    const r = this.pendingState().record;
    const failed = this.setPending(null);
    if (failed) {
      this.setData({ error: failed, notice: '' });
      return;
    }
    this._retry = null;
    this.setData({
      pending: null,
      canRetry: false,
      notice: '',
      ...(r && r.op === 'upload'
        ? {
            upload: {
              stage: 'saved',
              label:
                '由你核对确认：' + r.name + ' 为该次上传结果（接口无请求编号，系统无法自动证明）。',
            },
          }
        : { notice: '已按你的核对结束该草稿记录（接口无请求编号，系统无法自动证明）。' }),
    });
  },
  async dismissPending() {
    if (!this.data.pending || this.data.busy) return;
    const record = this.pendingState().record;
    if (!record) return;
    const token = await this.confirmed(
      '结束这条未知记录',
      '原请求仍可能在之后完成并多保存一份；如出现多余文件或草稿，可在本页撤销。之后可重新选择文件。',
      () => {
        const now = this.pendingState().record;
        return !!now && now.at === record.at && now.op === record.op;
      },
    );
    if (!token || !this.data.pending) return;
    const failed = this.setPending(null);
    if (failed) {
      this.setData({ error: failed, notice: '' });
      return;
    }
    this._retry = null;
    this.setData({ pending: null, canRetry: false, upload: null });
  },
  uploadImage() {
    this.upload('image');
  },
  uploadVideo() {
    this.upload('video');
  },
  // A known rejection keeps its record: retrying resends the same request ID and content.
  retryUpload() {
    return this.resendRequest();
  },
  /** True (with the reason shown) when a new request must not be started. */
  blocked() {
    const state = this.pendingState();
    const current = this.requestState();
    if (!state.ok || !current.ok) {
      this.setData({ error: STORAGE_FAILED, storageError: STORAGE_FAILED, notice: '' });
      return true;
    }
    if (state.record) {
      this.setData({ error: '上一次操作结果未知，请先在下方核对处理后再继续。', notice: '' });
      return true;
    }
    if (!current.record) return false;
    this.setData({
      error: '上一次请求尚未完成，请先在下方查询回执、继续或结束该记录。',
      notice: '',
    });
    return true;
  },
  requestKey() {
    return this.pendingKey();
  },
  requestState() {
    return requests.recordState(wx, this.requestKey());
  },
  /**
   * Binds an operation to this page, account and a fresh operation number. Every asynchronous
   * step re-checks it; nothing is adopted by a later token.
   */
  beginOp() {
    const token = ui.guard(this);
    const op = (this._op = (this._op || 0) + 1);
    const viewer = this._viewer;
    return () =>
      ui.held(this, token) && this._alive && op === this._op && !!viewer && viewer === this._viewer;
  },
  progress(confirmed, total, stage) {
    const bytes = media.size(confirmed) + ' / ' + media.size(total);
    this.setData({
      upload: {
        stage,
        confirmed,
        total,
        label:
          stage === 'verifying'
            ? '分片已全部被服务端确认（' + bytes + '），正在进行最终文件校验…'
            : '服务端已确认上传 ' +
              bytes +
              '（' +
              confirmed +
              ' / ' +
              total +
              ' 字节）' +
              (stage === 'sending' ? '，整体提交中，等待最终回执…' : ''),
      },
    });
  },
  /** What the organizer sees about the stored request and what can be done next. */
  requestView(record) {
    if (!record || record.v !== 2) return null;
    const state = record.state || 'unknown';
    const upload = record.op === 'upload';
    const session = upload && record.mode === 'session';
    const messages = {
      unknown:
        '网络中断或服务端异常，结果未知。请求编号已保存在本机，请先查询回执；不会换编号重发。',
      absent:
        '服务端没有该请求编号的回执：原请求可能未送达。可按原编号、原内容重新发送（本机会先核对文件摘要）。',
      session:
        '服务端已确认 ' +
        media.size(record.confirmed || 0) +
        ' / ' +
        media.size(upload ? record.meta.byteLength : 0) +
        '，可从已确认的分片继续上传。',
      rejected:
        (record.message || '服务端拒绝了该请求，未执行。') + ' 可按原编号原样重试，或结束此记录。',
      conflict:
        '该请求编号在服务端已对应不同内容（编号冲突），不会改写原请求，也不会换编号重试。请核对后结束此记录。',
      local:
        '本机暂存文件已丢失或内容与原请求不一致，不能用原编号续传，也不会换编号绕过保护。可查询回执、取消会话或结束此记录。',
    };
    return {
      op: record.op,
      state,
      title: upload
        ? (session ? '分片上传未完成：' : '上传未完成：') + record.meta.fileName
        : '草稿请求未完成：' + record.title,
      at: ui.localTime(new Date(record.at).toISOString()),
      shortId: record.clientRequestId.slice(0, 8),
      message: messages[state] || messages.unknown,
      canQuery: state !== 'conflict',
      canContinue: session && state === 'session',
      canResend: (state === 'absent' || state === 'rejected') && !(session && record.sessionId),
      canCancel: session && ['session', 'local', 'rejected'].includes(state),
      canEnd: state !== 'unknown',
    };
  },
  /** Updates the stored record (best effort: a failure keeps the previous record intact). */
  noteRequest(key, record, patch) {
    const next = { ...record, ...patch };
    requests.saveRecord(wx, key, next);
    return next;
  },
  async upload(kind, chosen) {
    if (!this._data || !this.data.caps || !this.data.caps.upload) return;
    if (this.data.busy || this.data.uncertain || this.blocked()) return;
    // Bound to this page, account and match before the picker opens; a late picker result is
    // checked against it and never adopted by a newer token.
    const still = this.beginOp();
    const key = this.requestKey();
    const valid = () => still() && !!this._data && !!this.data.caps && this.data.caps.upload;
    let picked;
    try {
      picked = chosen || (await media.choose(wx, kind));
    } catch (error) {
      if (valid() && !error.cancelled) this.setData({ error: ui.message(error), notice: '' });
      return;
    }
    if (!valid() || this.data.busy || this.data.uncertain || this.blocked()) return;
    let file;
    try {
      file = media.describe(picked, kind, this._data.usage);
    } catch (error) {
      this.setData({ error: ui.message(error), notice: '' });
      return;
    }
    ui.hold(this); // cancels in-flight reads only; validity stays bound to `still`
    this.setData({
      busy: true,
      loading: false,
      error: '',
      notice: '',
      canRetry: false,
      upload: {
        stage: 'reading',
        label: '正在读取 ' + file.name + '（' + media.size(file.size) + '）并计算内容摘要',
      },
    });
    let staged = '';
    try {
      const base64 = await media.readBase64(wx, file);
      if (!valid()) return;
      const bytes = requests.fromBase64(base64);
      if (!bytes || bytes.length !== file.size)
        throw new Error('文件编码或大小与所选文件不一致，请重新选择');
      const meta = {
        purpose: file.purpose,
        fileName: requests.normalizeText(file.name),
        contentType: file.contentType,
        byteLength: file.size,
        contentSha256: requests.sha256(bytes),
      };
      const clientRequestId = await ui.uuid();
      if (!valid()) return;
      const mode = file.size > requests.CHUNK_SIZE ? 'session' : 'single';
      // Multi-chunk uploads keep their own staged copy so a restarted app can resume them.
      if (mode === 'session') {
        staged = await requests.stage(wx, file.path, clientRequestId, meta.contentType);
        if (!valid()) return requests.releaseStaged(wx, staged);
      }
      const record = {
        v: 2,
        op: 'upload',
        clientRequestId,
        at: Date.now(),
        mode,
        path: staged || file.path,
        meta,
        fingerprint: requests.fingerprint('MATCH_FILE_UPLOAD', requests.fileFields(meta)),
        sessionId: '',
      };
      // The original ID and immutable metadata are stored before anything is sent.
      const unstored = requests.saveRecord(wx, key, record);
      if (unstored) {
        if (staged) requests.releaseStaged(wx, staged);
        this.setData({
          busy: false,
          error: unstored,
          upload: { stage: 'failed', label: '未发送：' + file.name + ' 未上传。' },
        });
        return;
      }
      if (staged) requests.completeStaging(staged);
      if (!valid()) return; // stored but never sent; resolved later through its receipt
      await this.drive(record, { base64, bytes }, valid, key);
    } catch (error) {
      const stored = requests.recordState(wx, key);
      if (staged && stored.ok && !stored.record) requests.releaseStaged(wx, staged);
      if (!valid()) return;
      this.setData({
        busy: false,
        error: ui.message(error),
        upload: { stage: 'failed', label: '未发送：' + file.name + ' 未上传。' },
      });
    }
  },
  /** Sends (or continues) the stored request with its original ID and content. */
  async drive(record, content, valid, key) {
    const client = api.getClient();
    try {
      if (record.op === 'draft') {
        this.setData({ busy: true, loading: false, error: '', notice: '' });
        await client.request(this.base() + '/media-requests', 'POST', record.body);
        if (!valid()) return;
        return this.finishedDraft(key);
      }
      const meta = record.meta;
      if (record.mode === 'single') {
        this.progress(0, meta.byteLength, 'sending');
        const r = await client.request(
          this.base() + '/media-file-requests',
          'POST',
          { clientRequestId: record.clientRequestId, ...meta, contentBase64: content.base64 },
          false,
          UPLOAD_TIMEOUT,
        );
        if (!valid()) return;
        return this.finished(record, key, r.data);
      }
      let session;
      if (!record.sessionId) {
        session = (
          await client.request(this.base() + '/media-upload-sessions', 'POST', {
            clientRequestId: record.clientRequestId,
            ...meta,
          })
        ).data;
        if (!valid()) return;
        record = this.noteRequest(key, record, { sessionId: session.id });
      } else {
        session = (await client.request(this.base() + '/media-upload-sessions/' + record.sessionId))
          .data;
        if (!valid()) return;
      }
      await this.pushChunks(record, session, content.bytes, valid, key);
    } catch (error) {
      if (!valid()) return;
      this.failed(record, key, error);
    }
  },
  async pushChunks(record, session, bytes, valid, key) {
    if (session.status === 'COMPLETED' && session.file)
      return this.finished(record, key, session.file);
    if (session.status !== 'OPEN') return this.closedRequest(record, key);
    const client = api.getClient();
    const path = this.base() + '/media-upload-sessions/' + session.id;
    const have = new Set(session.chunks.map((c) => c.index));
    this.progress(session.receivedBytes, session.byteLength, 'chunks');
    for (let index = 0; index < session.chunkCount; index++) {
      if (have.has(index)) continue;
      if (!valid()) return;
      const part = bytes.subarray(index * requests.CHUNK_SIZE, (index + 1) * requests.CHUNK_SIZE);
      session = (
        await client.request(path + '/chunks/' + index, 'PUT', {
          byteLength: part.length,
          sha256: requests.sha256(part),
          contentBase64: requests.toBase64(part),
        })
      ).data;
      if (!valid()) return;
      this.progress(session.receivedBytes, session.byteLength, 'chunks');
    }
    this.progress(session.receivedBytes, session.byteLength, 'verifying');
    const done = (await client.request(path + '/complete', 'POST', {})).data;
    if (!valid()) return;
    return this.finished(record, key, done.file);
  },
  /** Only the final receipt (a FILE) is shown as success. */
  async finished(record, key, file) {
    const uncleared = requests.saveRecord(wx, key, null);
    if (!uncleared && record.mode === 'session') requests.releaseStaged(wx, record.path);
    this.setData({
      busy: false,
      error: uncleared ? '已上传，但本机记录未能结束：' + uncleared : '',
      request: null,
      canRetry: false,
      upload: {
        stage: 'saved',
        confirmed: file.byteLength,
        total: file.byteLength,
        label:
          '服务端已确认 ' +
          media.size(file.byteLength) +
          ' / ' +
          media.size(file.byteLength) +
          '，最终校验通过：' +
          file.fileName +
          ' 已私有保存，尚未发布。',
      },
    });
    await this.load();
    if (uncleared && this._alive)
      this.setData({ error: '已上传，但本机记录未能结束：' + uncleared });
  },
  async finishedDraft(key) {
    const uncleared = requests.saveRecord(wx, key, null);
    this.setData({
      busy: false,
      title: '',
      rights: '',
      externalUrl: '',
      request: null,
      error: uncleared ? '草稿已创建，但本机记录未能结束：' + uncleared : '',
      notice: '媒体草稿已创建，尚未发布；发布前观众不可见。',
    });
    await this.load();
    if (uncleared && this._alive)
      this.setData({ error: '草稿已创建，但本机记录未能结束：' + uncleared });
  },
  /** The server closed the session (cancelled or expired): the ID is never used again. */
  closedRequest(record, key, message) {
    const uncleared = requests.saveRecord(wx, key, null);
    if (!uncleared && record.mode === 'session') requests.releaseStaged(wx, record.path);
    this.setData({
      busy: false,
      request: uncleared ? this.requestView(record) : null,
      error:
        uncleared ||
        message ||
        '原上传会话已取消或过期，原请求编号不再使用；可重新选择文件上传（将使用新的请求编号）。',
      upload: { stage: 'failed', label: '上传未完成：会话已关闭。' },
    });
  },
  failed(record, key, error) {
    const code = error && error.code;
    if (code === 'REQUEST_CLOSED') return this.closedRequest(record, key);
    let state = 'rejected';
    if (requests.unknownOutcome(error)) state = 'unknown';
    else if (code === 'IDEMPOTENCY_CONFLICT') state = 'conflict';
    else if (
      ['UPLOAD_SESSION_COMPLETED', 'UPLOAD_INCOMPLETE', 'UPLOAD_SESSION_ACTIVE'].includes(code)
    )
      state = 'unknown';
    const next = this.noteRequest(key, record, {
      state,
      message: state === 'rejected' ? media.failure(error) : '',
    });
    const view = this.requestView(next);
    this.setData({
      busy: false,
      request: view,
      canRetry: !!view.canResend && record.op === 'upload',
      error:
        state === 'unknown'
          ? '网络中断或服务端异常，结果未知：请先查询回执，不会换编号重发。'
          : media.failure(error),
      ...(record.op === 'upload'
        ? {
            upload: {
              stage: 'failed',
              confirmed: (this.data.upload && this.data.upload.confirmed) || 0,
              total: record.meta.byteLength,
              label:
                state === 'unknown'
                  ? '上传结果未知：以服务端回执为准。'
                  : '上传未完成：' + media.failure(error),
            },
          }
        : {}),
    });
  },
  pickDraft(e) {
    this.setData({ draftIndex: Number(e.detail.value) || 0 });
  },
  titleInput(e) {
    this.setData({ title: String(e.detail.value || '').slice(0, 120) });
  },
  rightsInput(e) {
    this.setData({ rights: String(e.detail.value || '').slice(0, 500) });
  },
  // `bound` is the token of the confirmation this write follows: the write stays valid only
  // while both it and the write's own token are (never adopted by a newer token).
  async write(path, body, label, bound) {
    if (this.data.busy || this.data.uncertain) return false;
    if (bound && !ui.held(this, bound)) return false;
    const token = ui.hold(this);
    const live = () => ui.held(this, token) && (!bound || ui.held(this, bound));
    if (!live()) return false;
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      await api.getClient().request(path, 'POST', body);
      if (!live()) return false;
      this.setData({ busy: false, notice: label });
      await this.load();
      return true;
    } catch (error) {
      if (!live()) return false;
      const message = media.failure(error);
      this.setData({ busy: false, error: message, uncertain: media.unknown(error) });
      if (error && error.status === 409) {
        await this.load();
        if (live() && !this.data.unavailable) this.setData({ error: message });
      }
      return false;
    }
  },
  /**
   * Opens a confirmation bound to this page, session, viewer and a fresh operation number;
   * `still()` re-checks the target against the latest read once the user answers. Returns the
   * confirmation token, or null when the answer is no or arrives too late.
   */
  async confirmed(title, content, still) {
    const op = (this._confirmOp = (this._confirmOp || 0) + 1);
    const viewer = this._viewer;
    const token = await ui.confirmFor(this, title, content);
    if (!token || op !== this._confirmOp || !this._alive || viewer !== this._viewer) return null;
    return !still || still() ? token : null;
  },
  sameFile(file, status) {
    const now = this._data && this._data.files.find((f) => f.id === file.id);
    return !!now && now.version === file.version && now.status === status;
  },
  setDraftMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === 'FILE' || (mode === 'LINK' && this.data.trustedHosts.length))
      this.setData({ draftMode: mode, error: '' });
  },
  externalInput(e) {
    this.setData({
      externalUrl: String(e.detail.value || '')
        .trim()
        .slice(0, 2048),
    });
  },
  async createDraft() {
    const w = this._data;
    const link = this.data.draftMode === 'LINK';
    const file = link ? null : this.data.draftFiles[this.data.draftIndex];
    if (!w || (!link && !file) || !this.data.caps || !this.data.caps.manage) return;
    if (this.data.busy || this.data.uncertain || this.blocked()) return;
    // Exactly the values the server writes (NFC, trimmed) — the fingerprint covers these.
    const title = requests.normalizeText(this.data.title),
      rights = requests.normalizeText(this.data.rights);
    if (!title || Array.from(rights).length < 4) {
      this.setData({ error: '请填写标题和至少4个字的权利声明（拍摄者、授权范围等）。' });
      return;
    }
    let externalUrl = '';
    if (link) {
      externalUrl = requests.canonicalLink(this.data.externalUrl);
      if (!externalUrl || !trustedLink(externalUrl, w.trustedExternalHosts || [])) {
        this.setData({
          error:
            '外部链接须为HTTPS，且主机在服务器受信列表内：' + this.data.trustedHosts.join('、'),
        });
        return;
      }
    }
    const source = link ? null : w.files.find((f) => f.id === file.id);
    const valid = this.beginOp();
    const key = this.requestKey();
    let clientRequestId;
    try {
      clientRequestId = await ui.uuid();
    } catch (error) {
      if (valid()) this.setData({ error: ui.message(error) });
      return;
    }
    if (!valid() || this.data.busy || this.blocked()) return;
    const body = link
      ? { clientRequestId, kind: 'EXTERNAL_LINK', title, externalUrl, rightsDeclaration: rights }
      : {
          clientRequestId,
          kind: source.purpose === 'MATCH_IMAGE' ? 'IMAGE' : 'VIDEO',
          title,
          fileId: file.id,
          rightsDeclaration: rights,
        };
    const record = {
      v: 2,
      op: 'draft',
      clientRequestId,
      at: Date.now(),
      title,
      body,
      fingerprint: requests.fingerprint('MATCH_MEDIA_CREATE', requests.draftFields(body)),
    };
    // Stored before sending; without a stored record nothing is sent.
    const unstored = requests.saveRecord(wx, key, record);
    if (unstored) {
      this.setData({ error: unstored, notice: '' });
      return;
    }
    ui.hold(this);
    await this.drive(record, null, valid, key);
  },
  // ---- recovery of a stored request: receipt first, then only the original ID ----
  /** Looks up the original request's receipt; on page load it never sends anything else. */
  async queryRequest(auto) {
    const key = this.requestKey();
    const record = this.requestState().record;
    if (!record || record.v !== 2 || this.data.busy) return;
    const valid = this.beginOp();
    ui.hold(this);
    this.setData({
      busy: true,
      loading: false,
      ...(auto === true ? {} : { error: '', notice: '' }),
    });
    const client = api.getClient();
    try {
      const path =
        (record.op === 'upload' ? '/media-file-requests/' : '/media-requests/') +
        record.clientRequestId;
      const r = (await client.request(this.base() + path)).data;
      if (!valid()) return;
      if (r.state === 'FILE') return this.finished(record, key, r.file);
      if (r.state === 'MEDIA') return this.finishedDraft(key);
      const s = r.session;
      if (s.status === 'COMPLETED' && s.file) return this.finished(record, key, s.file);
      if (s.status !== 'OPEN') return this.closedRequest(record, key);
      const next = this.noteRequest(key, record, {
        sessionId: s.id,
        state: 'session',
        confirmed: s.receivedBytes,
      });
      this.setData({ busy: false, request: this.requestView(next) });
      this.progress(s.receivedBytes, s.byteLength, 'chunks');
    } catch (error) {
      if (!valid()) return;
      if (error && error.code === 'RECEIPT_NOT_FOUND') {
        // 404 never means "safe to use a new ID": only the same ID and content may be resent.
        const next = this.noteRequest(key, record, { state: 'absent' });
        this.setData({ busy: false, request: this.requestView(next) });
        return;
      }
      this.setData({
        busy: false,
        request: this.requestView(record),
        error: requests.unknownOutcome(error)
          ? '暂时无法查询回执，原请求编号仍保留，请稍后再查询。'
          : media.failure(error),
      });
    }
  },
  /** Resends / continues with the original ID after checking the local content is unchanged. */
  async resendRequest() {
    const key = this.requestKey();
    const record = this.requestState().record;
    if (!record || record.v !== 2 || this.data.busy) return;
    // Only after a missing receipt, a known rejection or a confirmed open session — never while
    // the outcome is still unknown.
    const view = this.requestView(record);
    if (!view.canResend && !view.canContinue) {
      this.setData({ error: '请先查询原请求编号的回执，结果未知时不会重发。' });
      return;
    }
    const valid = this.beginOp();
    ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    if (record.op === 'draft') return this.drive(record, null, valid, key);
    let base64 = '',
      bytes = null;
    try {
      base64 = await media.readBase64(wx, { path: record.path, size: record.meta.byteLength });
      bytes = requests.fromBase64(base64);
    } catch {
      bytes = null;
    }
    if (!valid()) return;
    if (!bytes || requests.sha256(bytes) !== record.meta.contentSha256) {
      const next = this.noteRequest(key, record, { state: 'local' });
      this.setData({
        busy: false,
        request: this.requestView(next),
        error: '本机文件已丢失或内容已变化，未发送。',
      });
      return;
    }
    await this.drive(record, { base64, bytes }, valid, key);
  },
  continueRequest() {
    return this.resendRequest();
  },
  /** Cancels the server session of the stored request (creator only, server-checked). */
  async cancelRequest() {
    const record = this.requestState().record;
    if (!record || record.op !== 'upload' || record.mode !== 'session' || this.data.busy) return;
    const confirm = await this.confirmed(
      '取消分片上传',
      '取消后服务端释放预留额度并清除已上传的分片；该请求编号不能再次使用。若服务端已先完成，将按完成结果显示。',
      () => {
        const now = this.requestState().record;
        return !!now && now.clientRequestId === record.clientRequestId;
      },
    );
    if (!confirm) return;
    const key = this.requestKey();
    const valid = this.beginOp();
    const live = () => valid() && ui.held(this, confirm);
    ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    const client = api.getClient();
    try {
      let sessionId = record.sessionId;
      if (!sessionId) {
        const r = (
          await client.request(this.base() + '/media-file-requests/' + record.clientRequestId)
        ).data;
        if (!live()) return;
        if (r.state === 'FILE') return this.finished(record, key, r.file);
        sessionId = r.session.id;
      }
      const s = (
        await client.request(
          this.base() + '/media-upload-sessions/' + sessionId + '/cancel',
          'POST',
          {},
        )
      ).data;
      if (!live()) return;
      this.closedRequest(
        record,
        key,
        s.status === 'EXPIRED'
          ? '上传会话已过期，服务端已释放预留。'
          : '已取消上传会话，服务端已释放预留与分片。',
      );
      this.setData({
        upload: { stage: 'failed', label: '已取消：' + record.meta.fileName + ' 未保存。' },
      });
    } catch (error) {
      if (!live()) return;
      if (error && error.code === 'UPLOAD_SESSION_COMPLETED') {
        this.setData({ busy: false });
        return this.queryRequest();
      }
      this.failed(record, key, error);
    }
  },
  /** Ends the local record only; the ID is never reused and a server session simply expires. */
  async endRequest() {
    const record = this.requestState().record;
    if (!record || record.v !== 2 || this.data.busy) return;
    const confirm = await this.confirmed(
      '结束此记录',
      '只结束本机记录，不会撤销服务端已完成的结果；未完成的上传会话会在到期后失效并释放预留。之后可重新选择文件（使用新的请求编号）。',
      () => {
        const now = this.requestState().record;
        return !!now && now.clientRequestId === record.clientRequestId;
      },
    );
    if (!confirm) return;
    const uncleared = requests.saveRecord(wx, this.requestKey(), null);
    if (uncleared) {
      this.setData({ error: uncleared, notice: '' });
      return;
    }
    if (record.op === 'upload' && record.mode === 'session')
      requests.releaseStaged(wx, record.path);
    this.setData({ request: null, canRetry: false, upload: null, error: '' });
  },
  async command(e, type) {
    const w = this._data;
    const item = w && w.media.find((m) => m.id === e.currentTarget.dataset.id);
    if (!item) return;
    const publish = type === 'PUBLISH';
    const token = await this.confirmed(
      publish ? '发布“' + item.title + '”' : '撤销“' + item.title + '”',
      publish
        ? '发布后仅在本届公开观赛开启时，持有观赛链接的观众可见；不扩大其他公开范围。'
        : '撤销后观众不再可见；已被合法查看或保存的副本不受影响。撤销不可恢复为草稿。',
      () => {
        const now = this._data && this._data.media.find((m) => m.id === item.id);
        return !!now && now.version === item.version && now.status === item.status;
      },
    );
    if (!token) return;
    await this.write(
      this.base() + '/media/' + item.id + '/commands',
      { type, expectedVersion: item.version },
      publish ? '已发布。' : '已撤销，观众不再可见。',
      token,
    );
  },
  publish(e) {
    return this.command(e, 'PUBLISH');
  },
  revoke(e) {
    return this.command(e, 'REVOKE');
  },
  askRevokeFile(e) {
    this.setData({ revokeId: e.currentTarget.dataset.id || '', revokeReason: '' });
  },
  revokeReasonInput(e) {
    this.setData({ revokeReason: String(e.detail.value || '').slice(0, 500) });
  },
  async revokeFile() {
    const w = this._data;
    const file = w && w.files.find((f) => f.id === this.data.revokeId);
    if (!file) return;
    const reason = this.data.revokeReason.trim();
    if (Array.from(reason).length < 4) {
      this.setData({ error: '撤销文件须填写至少4个字的原因。' });
      return;
    }
    const token = await this.confirmed(
      '撤销私有文件',
      '撤销后不能再用于新媒体；内容清除与额度释放需另行管理。',
      () => this.sameFile(file, 'ACTIVE'),
    );
    if (!token) return;
    if (
      await this.write(
        this.base() + '/media-files/' + file.id + '/commands',
        { type: 'REVOKE', expectedVersion: file.version, reason },
        '文件已撤销；不等于内容已清除或额度已释放。',
        token,
      )
    )
      this.setData({ revokeId: '', revokeReason: '' });
  },
  // ---- time markers (CAS on the media version, so a duplicate send is rejected) ----
  openMarker(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      markerFor: this.data.markerFor === id ? '' : id,
      marker: { sourceIndex: 0, label: '', start: '', end: '' },
    });
  },
  markerInput(e) {
    const field = e.currentTarget.dataset.field;
    if (['label', 'start', 'end'].includes(field))
      this.setData({ ['marker.' + field]: String(e.detail.value || '').slice(0, 120) });
  },
  pickSource(e) {
    this.setData({ 'marker.sourceIndex': Number(e.detail.value) || 0 });
  },
  async addMarker() {
    const w = this._data;
    const item = w && w.media.find((m) => m.id === this.data.markerFor);
    const source = this.data.sources[this.data.marker.sourceIndex];
    if (!item || !source || !w.currentConfirmationId) return;
    const m = this.data.marker;
    const ms = (v) =>
      /^\d+(\.\d{1,3})?$/.test(String(v).trim()) ? Math.round(Number(v) * 1000) : NaN;
    const startMs = ms(m.start),
      endMs = ms(m.end);
    if (!m.label.trim() || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs)) {
      this.setData({ error: '请填写标记名称，以及以秒为单位的开始和结束位置（最多三位小数）。' });
      return;
    }
    if (endMs <= startMs || endMs > 86400000) {
      this.setData({ error: '结束位置须晚于开始位置，且不超过24小时。' });
      return;
    }
    if (
      await this.write(
        this.base() + '/media/' + item.id + '/markers',
        {
          expectedVersion: item.version,
          expectedConfirmationId: w.currentConfirmationId,
          sourceEventId: source.id,
          label: m.label.trim(),
          startMs,
          endMs,
        },
        '时间标记已添加（基于当前独立确认的赛果）。',
      )
    )
      this.setData({ markerFor: '', marker: { sourceIndex: 0, label: '', start: '', end: '' } });
  },
  // ---- irreversible content clearing (after revoke; reason, confirm, CAS, server audit) ----
  askPurgeFile(e) {
    this.setData({ purgeId: e.currentTarget.dataset.id || '', purgeReason: '' });
  },
  purgeReasonInput(e) {
    this.setData({ purgeReason: String(e.detail.value || '').slice(0, 500) });
  },
  async purgeFile() {
    const w = this._data;
    const file = w && w.files.find((f) => f.id === this.data.purgeId && f.status === 'REVOKED');
    if (!file || !w.capabilities.canPurge) return;
    const reason = this.data.purgeReason.trim();
    if (Array.from(reason).length < 4) {
      this.setData({ error: '清除文件内容须填写至少4个字的原因。' });
      return;
    }
    const token = await this.confirmed(
      '永久清除文件内容',
      '清除后文件正文不可恢复，也不能再预览或发布；记录与审计保留，并释放机构额度。确定清除“' +
        file.fileName +
        '”？',
      () => this.sameFile(file, 'REVOKED') && !!this._data.capabilities.canPurge,
    );
    if (!token) return;
    if (
      await this.write(
        this.base() + '/media-files/' + file.id + '/commands',
        { type: 'PURGE', expectedVersion: file.version, reason },
        '文件内容已清除，不可恢复。',
        token,
      )
    )
      this.setData({ purgeId: '', purgeReason: '' });
  },
  // ---- private preview: downloaded to a temporary file, removed on close/hide/unload ----
  async preview(e) {
    const w = this._data;
    const file =
      w && w.files.find((f) => f.id === e.currentTarget.dataset.id && f.status === 'ACTIVE');
    if (!file || this.data.busy) return;
    const client = api.getClient();
    if (
      typeof client.download !== 'function' ||
      typeof wx.getFileSystemManager !== 'function' ||
      !wx.env ||
      !wx.env.USER_DATA_PATH
    ) {
      this.setData({ error: '当前客户端无法安全预览私有文件，请更新后重试。' });
      return;
    }
    this.closePreview();
    const token = ui.guard(this);
    const op = (this._previewOp = (this._previewOp || 0) + 1);
    const valid = () =>
      ui.held(this, token) && this._alive && this._visible && op === this._previewOp;
    this.setData({ busy: true, error: '' });
    let filePath = '';
    try {
      const data = await client.download(this.base() + '/media-files/' + file.id + '/content');
      if (!valid()) return;
      if (
        data.contentType !== file.contentType ||
        !data.data ||
        data.data.byteLength !== file.byteLength
      )
        throw new Error('文件内容与当前记录不一致，请重新读取');
      const extension =
        file.contentType === 'video/mp4' ? 'mp4' : file.contentType === 'image/png' ? 'png' : 'jpg';
      const target =
        wx.env.USER_DATA_PATH + '/scb-media-' + file.id + '-' + Date.now() + '.' + extension;
      // Recorded before writing so a crash or a closed page still leaves a cleanup trail.
      if (!media.trackTemp(wx, target))
        throw new Error('本机存储不可用，无法登记临时文件以便清理，已取消预览。');
      filePath = target;
      await new Promise((resolve, reject) =>
        wx.getFileSystemManager().writeFile({
          filePath,
          data: data.data,
          success: resolve,
          fail: () => reject(new Error('临时文件写入失败')),
        }),
      );
      if (!valid()) return media.releaseTemp(wx, filePath);
      this._temporaryFiles.push(filePath);
      if (extension === 'mp4') this.setData({ previewVideo: filePath });
      else
        await new Promise((resolve, reject) =>
          wx.previewImage({
            current: filePath,
            urls: [filePath],
            showmenu: false,
            success: resolve,
            fail: () => reject(new Error('无法打开图片')),
          }),
        );
    } catch (error) {
      if (filePath) media.releaseTemp(wx, filePath);
      if (valid())
        this.setData({
          error: ui.message(error),
          ...([403, 404, 410].includes(error && error.status) ? { previewVideo: '' } : {}),
        });
    } finally {
      if (valid() || ui.held(this, token)) this.setData({ busy: false });
    }
  },
  // Any close (button, hide, unload, account change) ends the current preview operation for
  // good: a download or write still in flight sees a newer op and removes its own file.
  closePreview() {
    this._previewOp = (this._previewOp || 0) + 1;
    const paths = this._temporaryFiles || [];
    this._temporaryFiles = [];
    if (this.data && this.data.previewVideo && this.setData) this.setData({ previewVideo: '' });
    for (const path of paths) media.releaseTemp(wx, path);
  },
  openMatch() {
    ui.open('org-match', { orgId: this.orgId, matchId: this.matchId });
  },
});
