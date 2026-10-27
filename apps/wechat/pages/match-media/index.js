const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const media = require('../../utils/media');

// Match media over the existing C05 workspace: private upload -> draft record -> explicit
// publish / revoke. Uploading never publishes, and publication is still only visible through
// the event's public-viewing grant. Byte-level progress is not available: the existing upload
// is one JSON request, and wx.request reports no upload progress; stages are shown instead.
const UPLOAD_TIMEOUT = 120000;
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
    this._attempt = null;
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
    try {
      await events.session(client);
    } catch (error) {
      if (current()) this.setData({ ...privateDefaults, loading: false, error: ui.message(error) });
      return;
    }
    if (!current()) return;
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
    // Resolve an upload whose response was lost: same name and size, created after the attempt.
    const attempt = this._attempt;
    const landed =
      attempt &&
      w.files.some(
        (f) =>
          f.fileName === attempt.name &&
          f.byteLength === attempt.size &&
          Date.parse(f.createdAt) >= attempt.at - 120000,
      );
    if (landed) {
      this._attempt = null;
      this._retry = null;
    }
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
      canRetry: !!this._retry,
      ...(landed
        ? {
            upload: {
              stage: 'saved',
              label: '已核对：' + attempt.name + ' 已私有保存，尚未发布。',
            },
          }
        : {}),
    });
  },
  uploadImage() {
    this.upload('image');
  },
  uploadVideo() {
    this.upload('video');
  },
  retryUpload() {
    if (this._retry) this.upload(this._retry.kind, this._retry.file);
  },
  async upload(kind, chosen) {
    const w = this._data;
    if (!w || !this.data.caps || !this.data.caps.upload || this.data.busy || this.data.uncertain)
      return;
    let file;
    try {
      file = media.describe(chosen || (await media.choose(wx, kind)), kind, w.usage);
    } catch (error) {
      if (!error.cancelled) this.setData({ error: ui.message(error), notice: '' });
      return;
    }
    if (this.data.busy || this.data.uncertain) return;
    const token = ui.hold(this);
    this._retry = { kind, file };
    this._attempt = null;
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
      if (!ui.held(this, token)) return;
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
      this._attempt = { name: file.name, size: file.size, at: Date.now() };
      await api
        .getClient()
        .request(
          this.base() + '/media-files',
          'POST',
          { purpose: file.purpose, fileName: file.name, contentType: file.contentType, base64 },
          false,
          UPLOAD_TIMEOUT,
        );
      if (!ui.held(this, token)) return;
      this._retry = null;
      this._attempt = null;
      this.setData({
        busy: false,
        upload: { stage: 'saved', label: '3/3 已私有保存 ' + file.name + '，尚未发布。' },
      });
      await this.load();
    } catch (error) {
      if (!ui.held(this, token)) return;
      const lost = sent && media.unknown(error);
      this.setData({
        busy: false,
        uncertain: lost,
        canRetry: !lost,
        error: media.failure(error),
        upload: {
          stage: 'failed',
          label: lost
            ? '上传结果未知：请先重新读取，确认文件未保存后再重试。'
            : '上传未完成，可按原文件重试。',
        },
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
    if (!w || !file || !this.data.caps.manage) return;
    const title = this.data.title.trim(),
      rights = this.data.rights.trim();
    if (!title || Array.from(rights).length < 4) {
      this.setData({ error: '请填写标题和至少4个字的权利声明（拍摄者、授权范围等）。' });
      return;
    }
    const source = w.files.find((f) => f.id === file.id);
    if (
      await this.write(
        this.base() + '/media',
        {
          kind: source.purpose === 'MATCH_IMAGE' ? 'IMAGE' : 'VIDEO',
          title,
          fileId: file.id,
          rightsDeclaration: rights,
        },
        '媒体草稿已创建，尚未发布；发布前观众不可见。',
      )
    )
      this.setData({ title: '', rights: '' });
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
