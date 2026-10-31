const api = require('../../utils/api'),
  ui = require('../../utils/ui'),
  repo = require('../../utils/recruitment'),
  recovery = require('../../utils/recruitment-recovery');
Page({
  data: {
    orgId: '',
    eventId: '',
    userId: '',
    workspace: null,
    kind: 'ROSTER',
    kinds: ['ROSTER', 'MATCHUP', 'RESULT', 'HONOR'],
    labels: ['授权阵容', '比赛对阵', '确认战报', '最终荣誉'],
    entryId: '',
    matchId: '',
    entryName: '',
    matchName: '',
    includePortraits: true,
    pending: null,
    reason: '',
    busy: false,
    loading: false,
    loginRequired: false,
    error: '',
    message: '',
  },
  onLoad(q) {
    this._files = [];
    try {
      this.setData({ orgId: api.uuid(q.orgId), eventId: api.uuid(q.eventId) });
    } catch (e) {
      this._invalid = true;
      this.setData({ error: ui.message(e) });
    }
  },
  onShow() {
    this._visible = true;
    this.load();
  },
  onHide() {
    this._visible = false;
    ui.close(this);
    this.clean();
    this.setData({
      workspace: null,
      userId: '',
      pending: null,
      entryId: '',
      matchId: '',
      reason: '',
      busy: false,
    });
  },
  onUnload() {
    this.onHide();
  },
  onSessionReset() {
    this.clean();
    this.setData({
      workspace: null,
      userId: '',
      pending: null,
      entryId: '',
      matchId: '',
      reason: '',
      busy: false,
      loading: false,
      loginRequired: true,
      error: '登录身份已变化，请重新读取。',
    });
  },
  base() {
    return repo.base(this.data.orgId, this.data.eventId) + '/posters';
  },
  login() {
    ui.login('/pages/poster/index?orgId=' + this.data.orgId + '&eventId=' + this.data.eventId);
  },
  async load() {
    if (this._invalid || this.data.busy) return;
    const t = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      const s = await ui.session(
        this,
        '/pages/poster/index?orgId=' + this.data.orgId + '&eventId=' + this.data.eventId,
      );
      if (!s || !ui.live(this, t)) return;
      this.setData({ userId: s.user.id, pending: recovery.read(s.user.id) });
      const w = await repo.get(this.base());
      if (!ui.live(this, t)) return;
      this.setData({ workspace: w });
    } catch (e) {
      if (ui.live(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.live(this, t)) this.setData({ loading: false });
    }
  },
  kind(e) {
    if (!this.data.busy && !this.data.pending)
      this.setData({
        kind: this.data.kinds[Number(e.detail.value)],
        entryId: '',
        matchId: '',
        entryName: '',
        matchName: '',
      });
  },
  entry(e) {
    if (!this.data.busy && !this.data.pending)
      this.setData({
        entryId: this.data.workspace.participants[Number(e.detail.value)]?.entryId || '',
        entryName: this.data.workspace.participants[Number(e.detail.value)]?.teamName || '',
      });
  },
  match(e) {
    if (!this.data.busy && !this.data.pending)
      this.setData({
        matchId: this.data.workspace.matches[Number(e.detail.value)]?.id || '',
        matchName: this.data.workspace.matches[Number(e.detail.value)]?.displayName || '',
      });
  },
  portraits(e) {
    if (!this.data.busy && !this.data.pending)
      this.setData({ includePortraits: e.detail.value === true });
  },
  reason(e) {
    if (!this.data.busy && !this.data.pending) this.setData({ reason: e.detail.value });
  },
  async command(kind, path, body) {
    if (this.data.busy || this.data.pending || !this.data.userId) return;
    const op = await ui.confirmOp(
      this,
      '确认海报操作',
      '仅使用当前有效公开来源和逐人宣传许可；已保存或转发的图片无法追回。生成和每次下载都会重新核对。',
    );
    if (!op || !op.valid()) return;
    const t = ui.hold(this),
      actor = this.data.userId;
    this.setData({ busy: true, error: '' });
    try {
      const id = await ui.uuid();
      if (!op.valid() || !ui.held(this, t)) return;
      const p = { kind, path, body: { clientRequestId: id, ...body } };
      recovery.save(actor, p);
      if (!op.valid() || !ui.held(this, t)) return;
      this.setData({ pending: p });
      await this.send(p, actor, t);
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async send(p, actor, t) {
    try {
      await api.getClient().request(p.path, 'POST', p.body);
      recovery.clear(actor, p);
      if (ui.held(this, t))
        this.setData({ pending: null, message: '操作已完成，请重新读取海报列表。' });
    } catch (e) {
      if (!recovery.unknown(e)) recovery.clear(actor, p);
      if (ui.held(this, t))
        this.setData({
          pending: recovery.read(actor),
          error: ui.message(e) + (recovery.unknown(e) ? ' 请以原编号核对。' : ''),
        });
    }
  },
  generate() {
    const d = this.data;
    if (!d.workspace?.capabilities.canGenerate) return;
    return this.command('POSTER', this.base(), {
      expectedEventVersion: d.workspace.event.version,
      kind: d.kind,
      entryId: d.kind === 'ROSTER' ? d.entryId : null,
      matchId: ['MATCHUP', 'RESULT'].includes(d.kind) ? d.matchId : null,
      memberIds: [],
      includePortraits: d.includePortraits,
    });
  },
  revoke(e) {
    const id = api.uuid(e.currentTarget.dataset.id);
    return this.command('POSTER_REVOKE', this.base() + '/' + id + '/revoke', {
      reason: this.data.reason,
    });
  },
  async recover(e) {
    if (this.data.busy || !this.data.pending) return;
    const p = this.data.pending,
      actor = this.data.userId,
      op = await ui.confirmOp(
        this,
        '核对原请求',
        '查询回执或以原编号原内容重试；查不到回执不代表请求未提交。',
      );
    if (!op || !op.valid()) return;
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      if (e.currentTarget.dataset.replay) {
        if (op.valid()) await this.send(p, actor, t);
      } else {
        await repo.get('/v1/me/recruitment-requests/' + api.uuid(p.body.clientRequestId));
        if (!op.valid() || !ui.held(this, t)) return;
        recovery.clear(actor, p);
        this.setData({ pending: null, message: '原请求已提交，请重新读取核对。' });
      }
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async image(e) {
    if (this.data.busy || !this._visible || !this.data.workspace || this.data.pending) return;
    const id = api.uuid(e.currentTarget.dataset.id),
      save = e.currentTarget.dataset.save === 'yes';
    if (save) {
      const op = await ui.confirmOp(
        this,
        '保存宣传海报',
        '保存后图片会进入系统相册，授权撤回不能追回既有副本；请仅用于已获准的本届宣传。',
      );
      if (!op || !op.valid()) return;
      return this.downloadImage(id, true, op);
    }
    return this.downloadImage(id, false, null);
  },
  async downloadImage(id, save, op) {
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    let path;
    try {
      if (!wx.env?.USER_DATA_PATH || typeof wx.getFileSystemManager !== 'function')
        throw new Error('当前客户端无法安全导出图片');
      const value = await api.getClient().download(this.base() + '/' + id + '/content');
      if (!ui.held(this, t) || !this._visible || (op && !op.valid())) return;
      if (value.contentType !== 'image/png') throw new Error('图片格式无效');
      const key = await ui.uuid();
      if (!ui.held(this, t) || !this._visible || (op && !op.valid())) return;
      path = wx.env.USER_DATA_PATH + '/scb-poster-' + key + '.png';
      this._files.push(path);
      await new Promise((resolve, reject) =>
        wx.getFileSystemManager().writeFile({
          filePath: path,
          data: value.data,
          success: resolve,
          fail: () => reject(new Error('临时海报写入失败')),
        }),
      );
      if (!ui.held(this, t) || !this._visible || (op && !op.valid())) {
        this.remove(path);
        return;
      }
      await new Promise((resolve, reject) =>
        save
          ? wx.saveImageToPhotosAlbum({
              filePath: path,
              success: resolve,
              fail: () => reject(new Error('相册保存未完成，请核对系统权限后重新下载')),
            })
          : wx.previewImage({
              current: path,
              urls: [path],
              showmenu: false,
              success: resolve,
              fail: () => reject(new Error('图片预览失败')),
            }),
      );
      if (ui.held(this, t))
        this.setData({
          message: save
            ? '已保存本次授权海报；后续授权变化不影响已存副本。'
            : '当前授权海报已打开。',
        });
    } catch (e) {
      if (path) this.remove(path);
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  remove(path) {
    try {
      wx.getFileSystemManager().unlink({ filePath: path, fail() {} });
    } catch {}
    this._files = (this._files || []).filter((p) => p !== path);
  },
  clean() {
    for (const p of [...(this._files || [])]) this.remove(p);
  },
});
