const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const media = require('../../utils/media');
const scoring = require('../../utils/scoring');

// Match media over the existing C05 workspace: private upload -> draft record -> explicit
// publish / revoke. Uploading never publishes, and publication is still only visible through
// the event's public-viewing grant. Byte-level progress is not available: the existing upload
// is one JSON request, and wx.request reports no upload progress; stages are shown instead.
//
// The existing upload and draft-creation endpoints have no request identity: each call stores
// a new file / media record. A lost response therefore stays "unknown" until the organizer
// resolves it; a file or draft that merely looks the same is shown for checking, never taken
// as proof, and no retry or new upload is offered meanwhile. The record is kept in device
// storage per account and match so leaving and re-entering the page does not clear it.
//
// That storage is the protection itself: a record must be stored before a non-idempotent
// request is sent, a read or write failure stops new uploads and drafts (never treated as "no
// record"), unresolved records are never evicted, and a record is only released once its
// removal has actually been written.
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
  storageError: '',
  unavailable: false,
};

Page({
  data: { loading: false, busy: false, error: '', notice: '', ...privateDefaults },
  onLoad(query = {}) {
    this._alive = true;
    this._visible = true;
    this._temporaryFiles = [];
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
      canRetry: !!this._retry && state.ok && !state.record,
      pending: this.pendingView(w),
      storageError: state.ok ? '' : STORAGE_FAILED,
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
    if (
      !(await ui.confirm(
        '结束这条未知记录',
        '原请求仍可能在之后完成并多保存一份；如出现多余文件或草稿，可在本页撤销。之后可重新选择文件。',
      ))
    )
      return;
    if (!this.data.pending) return;
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
  // Only after a known rejection; never while an earlier outcome is unknown.
  retryUpload() {
    if (this._retry && !this.blocked()) return this.upload(this._retry.kind, this._retry.file);
  },
  /** True (with the reason shown) when a non-idempotent request must not be started. */
  blocked() {
    const state = this.pendingState();
    if (!state.ok) {
      this.setData({ error: STORAGE_FAILED, storageError: STORAGE_FAILED, notice: '' });
      return true;
    }
    if (!state.record) return false;
    this.setData({ error: '上一次操作结果未知，请先在下方核对处理后再继续。', notice: '' });
    return true;
  },
  async upload(kind, chosen) {
    if (!this._data || !this.data.caps || !this.data.caps.upload) return;
    if (this.data.busy || this.data.uncertain || this.blocked()) return;
    // Bind the whole operation to this page, account and match before the picker opens. A late
    // picker result is checked against these; a new token is never used to adopt it.
    const token = ui.guard(this);
    const op = (this._op = (this._op || 0) + 1);
    const viewer = this._viewer;
    const valid = () =>
      ui.held(this, token) &&
      this._alive &&
      op === this._op &&
      !!viewer &&
      viewer === this._viewer &&
      !!this._data &&
      !!this.data.caps &&
      this.data.caps.upload;
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
    ui.hold(this); // cancels in-flight reads only; validity stays bound to `token`
    this._retry = { kind, file };
    this.setData({
      busy: true,
      loading: false,
      error: '',
      notice: '',
      canRetry: false,
      upload: {
        stage: 'reading',
        label: '1/3 正在读取 ' + file.name + '（' + media.size(file.size) + '）',
      },
    });
    let sent = false;
    try {
      const base64 = await media.readBase64(wx, file);
      if (!valid()) return;
      this.setData({
        upload: {
          stage: 'sending',
          label:
            '2/3 正在上传 ' +
            media.size(file.size) +
            '：单次提交，完成前无法显示字节进度，请保持网络连接。',
        },
      });
      // Stored before sending, so a killed app or a re-entered page still knows about it.
      // Without a stored record the request is not sent at all.
      const unstored = this.setPending({
        op: 'upload',
        name: file.name,
        size: file.size,
        at: Date.now(),
        known: this._data.files.map((f) => f.id),
      });
      if (unstored) {
        this.setData({
          busy: false,
          canRetry: false,
          error: unstored,
          upload: { stage: 'failed', label: '未发送：' + file.name + ' 未上传。' },
        });
        return;
      }
      sent = true;
      await api
        .getClient()
        .request(
          this.base() + '/media-files',
          'POST',
          { purpose: file.purpose, fileName: file.name, contentType: file.contentType, base64 },
          false,
          UPLOAD_TIMEOUT,
        );
      if (!valid()) return;
      const uncleared = this.setPending(null);
      this._retry = null;
      this.setData({
        busy: false,
        error: uncleared,
        upload: { stage: 'saved', label: '3/3 已私有保存 ' + file.name + '，尚未发布。' },
      });
      await this.load();
    } catch (error) {
      if (!valid()) return;
      const lost = sent && media.unknown(error);
      const uncleared = sent && !lost ? this.setPending(null) : '';
      this.setData({
        busy: false,
        canRetry: !lost && !uncleared,
        error: uncleared || media.failure(error),
        upload: {
          stage: 'failed',
          label: lost
            ? '上传结果未知：接口没有请求编号，无法自动确认是否已保存。请在下方核对。'
            : '上传未完成，可按原文件重试。',
        },
        pending: lost || uncleared ? this.pendingView(this._data) : null,
      });
    }
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
  async write(path, body, label) {
    if (this.data.busy || this.data.uncertain) return false;
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      await api.getClient().request(path, 'POST', body);
      if (!ui.held(this, token)) return false;
      this.setData({ busy: false, notice: label });
      await this.load();
      return true;
    } catch (error) {
      if (!ui.held(this, token)) return false;
      const message = media.failure(error);
      this.setData({ busy: false, error: message, uncertain: media.unknown(error) });
      if (error && error.status === 409) {
        await this.load();
        if (ui.held(this, token) && !this.data.unavailable) this.setData({ error: message });
      }
      return false;
    }
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
    const title = this.data.title.trim(),
      rights = this.data.rights.trim();
    if (!title || Array.from(rights).length < 4) {
      this.setData({ error: '请填写标题和至少4个字的权利声明（拍摄者、授权范围等）。' });
      return;
    }
    let externalUrl = '';
    if (link) {
      externalUrl = this.data.externalUrl;
      if (!trustedLink(externalUrl, w.trustedExternalHosts || [])) {
        this.setData({
          error:
            '外部链接须为HTTPS，且主机在服务器受信列表内：' + this.data.trustedHosts.join('、'),
        });
        return;
      }
    }
    const source = link ? null : w.files.find((f) => f.id === file.id);
    const unstored = this.setPending({
      op: 'draft',
      fileId: link ? null : file.id,
      externalUrl: link ? externalUrl : null,
      title,
      at: Date.now(),
      known: w.media.map((m) => m.id),
    });
    if (unstored) {
      this.setData({ error: unstored, notice: '' });
      return;
    }
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      await api.getClient().request(
        this.base() + '/media',
        'POST',
        link
          ? { kind: 'EXTERNAL_LINK', title, externalUrl, rightsDeclaration: rights }
          : {
              kind: source.purpose === 'MATCH_IMAGE' ? 'IMAGE' : 'VIDEO',
              title,
              fileId: file.id,
              rightsDeclaration: rights,
            },
      );
      if (!ui.held(this, token)) return;
      const uncleared = this.setPending(null);
      this.setData({
        busy: false,
        title: '',
        rights: '',
        externalUrl: '',
        error: uncleared,
        notice: '媒体草稿已创建，尚未发布；发布前观众不可见。',
      });
      await this.load();
    } catch (error) {
      if (!ui.held(this, token)) return;
      const lost = media.unknown(error);
      const uncleared = lost ? '' : this.setPending(null);
      this.setData({
        busy: false,
        error: lost
          ? '网络中断，草稿是否已创建未知：接口没有请求编号，请在下方核对，不会自动重新创建。'
          : uncleared || media.failure(error),
        pending: lost || uncleared ? this.pendingView(w) : null,
      });
      if (!lost && !uncleared && error && error.status === 409) {
        const message = this.data.error;
        await this.load();
        if (ui.held(this, token) && !this.data.unavailable) this.setData({ error: message });
      }
    }
  },
  async command(e, type) {
    const w = this._data;
    const item = w && w.media.find((m) => m.id === e.currentTarget.dataset.id);
    if (!item) return;
    const publish = type === 'PUBLISH';
    if (
      !(await ui.confirm(
        publish ? '发布“' + item.title + '”' : '撤销“' + item.title + '”',
        publish
          ? '发布后仅在本届公开观赛开启时，持有观赛链接的观众可见；不扩大其他公开范围。'
          : '撤销后观众不再可见；已被合法查看或保存的副本不受影响。撤销不可恢复为草稿。',
      ))
    )
      return;
    await this.write(
      this.base() + '/media/' + item.id + '/commands',
      { type, expectedVersion: item.version },
      publish ? '已发布。' : '已撤销，观众不再可见。',
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
    if (
      !(await ui.confirm('撤销私有文件', '撤销后不能再用于新媒体；内容清除与额度释放需另行管理。'))
    )
      return;
    if (
      await this.write(
        this.base() + '/media-files/' + file.id + '/commands',
        { type: 'REVOKE', expectedVersion: file.version, reason },
        '文件已撤销；不等于内容已清除或额度已释放。',
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
    if (
      !(await ui.confirm(
        '永久清除文件内容',
        '清除后文件正文不可恢复，也不能再预览或发布；记录与审计保留，并释放机构额度。确定清除“' +
          file.fileName +
          '”？',
      ))
    )
      return;
    if (
      await this.write(
        this.base() + '/media-files/' + file.id + '/commands',
        { type: 'PURGE', expectedVersion: file.version, reason },
        '文件内容已清除，不可恢复。',
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
      filePath =
        wx.env.USER_DATA_PATH + '/scb-media-' + file.id + '-' + Date.now() + '.' + extension;
      this._temporaryFiles.push(filePath);
      await new Promise((resolve, reject) =>
        wx.getFileSystemManager().writeFile({
          filePath,
          data: data.data,
          success: resolve,
          fail: () => reject(new Error('临时文件写入失败')),
        }),
      );
      if (!valid()) return this.removeTemporary(filePath);
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
      if (filePath) this.removeTemporary(filePath);
      if (valid())
        this.setData({
          error: ui.message(error),
          ...([403, 404, 410].includes(error && error.status) ? { previewVideo: '' } : {}),
        });
    } finally {
      if (valid() || ui.held(this, token)) this.setData({ busy: false });
    }
  },
  closePreview() {
    for (const path of (this._temporaryFiles || []).slice()) this.removeTemporary(path);
    if (this.data.previewVideo && this.setData) this.setData({ previewVideo: '' });
  },
  removeTemporary(path) {
    this._temporaryFiles = (this._temporaryFiles || []).filter((p) => p !== path);
    if (typeof wx.getFileSystemManager !== 'function') return;
    wx.getFileSystemManager().unlink({ filePath: path, success() {}, fail() {} });
  },
  openMatch() {
    ui.open('org-match', { orgId: this.orgId, matchId: this.matchId });
  },
});
