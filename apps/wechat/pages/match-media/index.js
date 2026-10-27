const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const media = require('../../utils/media');

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
const UPLOAD_TIMEOUT = 120000;
const PENDING_KEY = 'scb.mediaPending.v1';
function pendingStore() {
  try {
    const v = wx.getStorageSync(PENDING_KEY);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function savePendingStore(map) {
  try {
    const keys = Object.keys(map);
    // Bounded: only the most recent records are kept.
    for (const k of keys.slice(0, Math.max(0, keys.length - 20))) delete map[k];
    wx.setStorageSync(PENDING_KEY, map);
  } catch {
    /* Storage failure keeps the in-memory record for this page only. */
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
  upload: null,
  canRetry: false,
  uncertain: false,
  pending: null,
  unavailable: false,
};

Page({
  data: { loading: false, busy: false, error: '', notice: '', ...privateDefaults },
  onLoad(query = {}) {
    this._alive = true;
    try {
      this.orgId = api.uuid(query.orgId);
      this.matchId = api.uuid(query.matchId);
    } catch {
      this.setData({ unavailable: true, error: '媒体入口无效，请从比赛详情重新进入。' });
      return;
    }
    this.load();
  },
  onUnload() {
    this._alive = false;
    this._load = (this._load || 0) + 1;
    ui.close(this);
  },
  onSessionReset() {
    this._load = (this._load || 0) + 1;
    this._data = null;
    this._retry = null;
    this._viewer = '';
    this._pendingMemory = null;
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
      }));
    const draftFiles = files.filter((f) => f.status === 'ACTIVE' && !used.has(f.id));
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
        markers: m.markers.length,
        stale: m.markers.some((k) => k.sourceStatus === 'STALE'),
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
      canRetry: !!this._retry && !this.pendingRecord(),
      pending: this.pendingView(w),
    });
  },
  pendingKey() {
    return this._viewer ? this._viewer + ':' + this.orgId + ':' + this.matchId : '';
  },
  pendingRecord() {
    const key = this.pendingKey();
    if (!key) return null;
    return (
      pendingStore()[key] ||
      (this._pendingMemory && this._pendingMemory.key === key ? this._pendingMemory.record : null)
    );
  },
  setPending(record) {
    const key = this.pendingKey();
    if (!key) return;
    const map = pendingStore();
    if (record) map[key] = record;
    else delete map[key];
    this._pendingMemory = record ? { key, record } : null;
    savePendingStore(map);
  },
  // What the organizer can check: records created since the unknown attempt that look like it.
  // Shown as candidates only; equality of name/size/file is not proof of this request.
  pendingView(w) {
    const r = this.pendingRecord();
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
            .filter((m) => !known.has(m.id) && m.fileId === r.fileId)
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
    const r = this.pendingRecord();
    this.setPending(null);
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
    this.setPending(null);
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
    if (this._retry && !this.pendingRecord())
      return this.upload(this._retry.kind, this._retry.file);
  },
  blocked() {
    if (!this.pendingRecord()) return false;
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
    if (!valid() || this.data.busy || this.data.uncertain || this.pendingRecord()) return;
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
      sent = true;
      // Recorded before sending, so a killed app or a re-entered page still knows about it.
      this.setPending({
        op: 'upload',
        name: file.name,
        size: file.size,
        at: Date.now(),
        known: this._data.files.map((f) => f.id),
      });
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
      this.setPending(null);
      this._retry = null;
      this.setData({
        busy: false,
        upload: { stage: 'saved', label: '3/3 已私有保存 ' + file.name + '，尚未发布。' },
      });
      await this.load();
    } catch (error) {
      if (!valid()) return;
      const lost = sent && media.unknown(error);
      if (!lost) this.setPending(null);
      this.setData({
        busy: false,
        canRetry: !lost,
        error: media.failure(error),
        upload: {
          stage: 'failed',
          label: lost
            ? '上传结果未知：接口没有请求编号，无法自动确认是否已保存。请在下方核对。'
            : '上传未完成，可按原文件重试。',
        },
        pending: lost ? this.pendingView(this._data) : null,
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
  async createDraft() {
    const w = this._data;
    const file = this.data.draftFiles[this.data.draftIndex];
    if (!w || !file || !this.data.caps || !this.data.caps.manage) return;
    if (this.data.busy || this.data.uncertain || this.blocked()) return;
    const title = this.data.title.trim(),
      rights = this.data.rights.trim();
    if (!title || Array.from(rights).length < 4) {
      this.setData({ error: '请填写标题和至少4个字的权利声明（拍摄者、授权范围等）。' });
      return;
    }
    const source = w.files.find((f) => f.id === file.id);
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    this.setPending({
      op: 'draft',
      fileId: file.id,
      title,
      at: Date.now(),
      known: w.media.map((m) => m.id),
    });
    try {
      await api.getClient().request(this.base() + '/media', 'POST', {
        kind: source.purpose === 'MATCH_IMAGE' ? 'IMAGE' : 'VIDEO',
        title,
        fileId: file.id,
        rightsDeclaration: rights,
      });
      if (!ui.held(this, token)) return;
      this.setPending(null);
      this.setData({
        busy: false,
        title: '',
        rights: '',
        notice: '媒体草稿已创建，尚未发布；发布前观众不可见。',
      });
      await this.load();
    } catch (error) {
      if (!ui.held(this, token)) return;
      const lost = media.unknown(error);
      if (!lost) this.setPending(null);
      this.setData({
        busy: false,
        error: lost
          ? '网络中断，草稿是否已创建未知：接口没有请求编号，请在下方核对，不会自动重新创建。'
          : media.failure(error),
        pending: lost ? this.pendingView(w) : null,
      });
      if (!lost && error && error.status === 409) {
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
  openMatch() {
    ui.open('org-match', { orgId: this.orgId, matchId: this.matchId });
  },
});
