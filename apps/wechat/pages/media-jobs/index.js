const api = require('../../utils/api');
const ui = require('../../utils/ui');
const stream = require('../../utils/streaming');
const blank = { session: null, jobs: [], artifacts: [], canManage: false, pending: false };
const status = {
  QUEUED: '排队中',
  RUNNING: '处理中',
  READY: '已探测并生成',
  FAILED: '处理失败',
  CANCELLED: '已取消',
};
const kinds = { RECORDING: '独立录像', TRANSCODE: '转码', HIGHLIGHTS: '有效得分事件集锦' };
Page({
  data: {
    ...blank,
    loading: false,
    busy: false,
    error: '',
    notice: '',
    anchorAt: '',
    offsetMs: '0',
    reason: '已人工核对源PTS与赛事时间',
  },
  onLoad(q = {}) {
    this._alive = true;
    try {
      this.org = api.uuid(q.orgId);
      this.session = api.uuid(q.sessionId);
      this.load();
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  onHide() {
    this.clearFile();
  },
  onUnload() {
    this._alive = false;
    this.clearFile();
    ui.close(this);
  },
  onSessionReset() {
    this.clearFile();
    this._pending = null;
    this.setData({ ...blank, loading: false, busy: false, error: '登录身份已变化，请重新进入' });
  },
  path() {
    return '/v1/orgs/' + this.org + '/broadcasts/' + this.session + '/media';
  },
  scope() {
    return stream.scope(api.getClient(), this.org, this.session);
  },
  clearFile() {
    if (this._file && wx.getFileSystemManager) {
      wx.getFileSystemManager().unlink({ filePath: this._file, fail() {} });
    }
    this._file = null;
    this._fileRevision = (this._fileRevision || 0) + 1;
  },
  input(e) {
    const f = e.currentTarget.dataset.field;
    if (['anchorAt', 'offsetMs', 'reason'].includes(f)) this.setData({ [f]: e.detail.value });
  },
  async load() {
    if (!this._alive || !this.org || this.data.busy || this.data.loading) return;
    const c = api.getClient(),
      token = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      if (!c.hasSession()) throw Error('请先登录后查看媒体作业');
      this._pending = stream.pending(this.scope());
      this.setData({ pending: !!this._pending });
      const v = (await c.request(this.path())).data;
      if (!ui.live(this, token)) return;
      if (!v || !Array.isArray(v.jobs) || !Array.isArray(v.artifacts))
        throw Error('媒体作业返回无效');
      this.setData({
        session: stream.session(v.session),
        jobs: v.jobs.map((j) => ({
          ...j,
          statusText:
            j.cancelRequested && j.status === 'RUNNING'
              ? '等待实际处理进程退出'
              : status[j.status] || j.status,
          kindText: kinds[j.kind] || j.kind,
        })),
        artifacts: v.artifacts.map((a) => ({
          ...a,
          durationText: (a.durationMs / 1000).toFixed(1) + '秒',
          sizeText: (a.byteLength / 1048576).toFixed(1) + 'MB',
        })),
        canManage: v.canManage === true,
      });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ ...blank, error: ui.message(e) });
    } finally {
      if (ui.live(this, token)) this.setData({ loading: false });
    }
  },
  async command(e) {
    const { type, id, version } = e.currentTarget.dataset,
      guard = ui.guard(this);
    if (
      ['PUBLISH', 'REVOKE', 'CANCEL_JOB'].includes(type) &&
      !(await ui.confirm(
        '确认媒体操作',
        type === 'PUBLISH'
          ? '将公开这份已核验产物；需独立审核人与当前录像授权。'
          : '将停止处理或撤销该产物的访问授权。',
      ))
    )
      return;
    if (!ui.held(this, guard)) return;
    const b = { type, expectedVersion: Number(version) };
    if (['CALIBRATE', 'CANCEL_JOB'].includes(type)) b.jobId = id;
    else b.artifactId = id;
    if (type === 'CALIBRATE') {
      b.anchorAt = this.data.anchorAt;
      b.offsetMs = Number(this.data.offsetMs);
      b.reason = this.data.reason;
    }
    await this.send(b);
  },
  async retry() {
    if (this._pending) await this.send(this._pending, true);
  },
  async send(input, retry = false) {
    if (this.data.busy || !this._alive) return;
    const c = api.getClient(),
      token = ui.hold(this);
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const key = this.scope(),
        body = retry ? input : { clientRequestId: await ui.uuid(), ...input };
      if (!ui.held(this, token)) return;
      stream.save(key, body);
      this._pending = body;
      this.setData({ pending: true });
      await c.request(this.path() + '/commands', 'POST', body);
      if (!ui.held(this, token)) return;
      stream.clear(key, body.clientRequestId);
      this._pending = null;
      this.setData({ pending: false, notice: '操作已由服务器确认' });
    } catch (e) {
      if (ui.held(this, token))
        this.setData({
          error: ui.message(e),
          notice: this._pending ? '请使用原编号核对结果后继续。' : '未发送操作',
        });
    } finally {
      if (ui.held(this, token)) {
        this.setData({ busy: false });
        if (!this._pending) this.load();
      }
    }
  },
  async download(e) {
    if (this.data.busy) return;
    const c = api.getClient(),
      token = ui.guard(this),
      id = api.uuid(e.currentTarget.dataset.id);
    this.clearFile();
    const revision = this._fileRevision;
    if (typeof c.downloadLiveMedia !== 'function') {
      this.setData({ error: '当前客户端的长录像下载能力尚未就绪，请更新客户端' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const v = await c.downloadLiveMedia(this.path() + '/artifacts/' + id + '/content');
      if (!ui.held(this, token) || revision !== this._fileRevision) {
        if (v.tempFilePath && wx.getFileSystemManager)
          wx.getFileSystemManager().unlink({ filePath: v.tempFilePath, fail() {} });
        return;
      }
      this._file = v.tempFilePath;
      if (typeof wx.previewMedia === 'function')
        wx.previewMedia({
          sources: [{ url: v.tempFilePath, type: 'video' }],
          fail: () => this.setData({ error: '当前微信无法预览录像，可在授权管理端查看' }),
        });
      else this.setData({ error: '当前微信缺少视频预览能力' });
    } catch (e) {
      if (ui.held(this, token)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async copyLink(e) {
    const key = e.currentTarget.dataset.key;
    if (!/^[A-Za-z0-9_-]{32}$/.test(key)) return;
    wx.setClipboardData({ data: api.API_ORIGIN + '/v1/public/live-media/' + key + '/content' });
  },
});
