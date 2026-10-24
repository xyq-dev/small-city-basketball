const api = require('../../utils/api');
const ui = require('../../utils/ui');
const registration = require('../../utils/registration');
const selectedCount = (rows) => rows.filter((row) => row.selected).length;
Page({
  data: {
    entry: null,
    rows: [],
    selectedCount: 0,
    fileWorkspace: null,
    files: [],
    fileError: '',
    stage: 'roster',
    dirty: false,
    consent: false,
    fileConsent: false,
    uploadPurpose: 'PRIVATE_INSURANCE',
    uploadPurposeIndex: 0,
    purposes: ['外部已购保险凭证', '其他报名资料'],
    busy: false,
    loading: false,
    uncertain: false,
    error: '',
    message: '',
    loginRequired: false,
    reason: '',
  },
  onLoad(query) {
    this._alive = true;
    this._visible = true;
    this._temporaryFiles = [];
    try {
      this._org = registration.id(query.orgId);
      this._id = registration.id(query.entryId);
    } catch (error) {
      this._routeError = ui.message(error);
      this.setData({ error: this._routeError });
    }
    if (['documents', 'review', 'history'].includes(query.stage))
      this.setData({ stage: query.stage });
  },
  onShow() {
    this._visible = true;
    if (this._revision !== undefined && api.getClient().sessionRevision() !== this._revision) {
      this.clearPrivate();
      this.setData({ busy: false, dirty: false, uncertain: false });
    }
    if (!this.data.dirty) this.load();
  },
  onHide() {
    this._visible = false;
    this.removeTemporaryFiles();
  },
  onUnload() {
    this._alive = false;
    this._visible = false;
    this._entry = null;
    this._team = null;
    this.removeTemporaryFiles();
    ui.close(this);
  },
  path() {
    return '/pages/entry/index?orgId=' + this._org + '&entryId=' + this._id;
  },
  login() {
    ui.login(this.path());
  },
  clearPrivate() {
    this._entry = null;
    this._team = null;
    this.setData({
      entry: null,
      rows: [],
      files: [],
      fileWorkspace: null,
      selectedCount: 0,
      consent: false,
      fileConsent: false,
      reason: '',
    });
  },
  applyEntry(entry, team) {
    this._entry = entry;
    this._team = team;
    const rows = registration.rosterRows(team, entry);
    this.setData({
      entry: registration.describeEntry(entry),
      rows,
      selectedCount: selectedCount(rows),
      dirty: false,
      consent: false,
      fileConsent: false,
    });
  },
  async load() {
    if (this._routeError || this.data.busy) return;
    this.clearPrivate();
    this.setData({ loading: true, error: '', fileError: '', loginRequired: false });
    ui.begin(this);
    const session = await ui.session(this, this.path());
    if (!this._alive) return;
    if (!session) {
      this.setData({ loading: false });
      return;
    }
    this._viewer = session.user.id;
    this._revision = api.getClient().sessionRevision();
    const token = ui.begin(this),
      repo = registration.createRepository(this._org);
    try {
      const entry = await repo.entry(this._id);
      const team = entry.capabilities.canEditRoster ? await repo.team(entry.teamId) : null;
      if (!ui.live(this, token)) return;
      this.applyEntry(entry, team);
      this.setData({ uncertain: false, loading: false });
      try {
        const files = await repo.files(this._id);
        if (ui.live(this, token)) this.applyFiles(files);
      } catch (error) {
        if (ui.live(this, token))
          this.setData({ files: [], fileWorkspace: null, fileError: ui.message(error) });
      }
    } catch (error) {
      if (ui.live(this, token)) {
        this.clearPrivate();
        this.setData({ loading: false, error: ui.message(error) });
      }
    }
  },
  applyFiles(files) {
    this.setData({
      fileWorkspace: files,
      files: files.files.map((f) => ({
        ...f,
        statusLabel: { ACTIVE: '已上传 · 私有', REVOKED: '已撤销', PURGED: '内容已清除' }[f.status],
        purposeLabel: f.purpose === 'PRIVATE_INSURANCE' ? '外部已购保险凭证' : '报名资料',
        sizeText: Math.ceil(f.byteLength / 1024) + ' KiB',
      })),
      fileError: '',
      fileConsent: false,
    });
  },
  async refresh() {
    if (this.data.busy || this.data.loading) return;
    if (
      (this.data.dirty || this.data.uncertain) &&
      !(await ui.confirm(
        '重新读取本届资料',
        '未保存的名单修改将被放弃；未知结果需以本次重新读取的记录核对。',
      ))
    )
      return;
    this.setData({ dirty: false });
    this.load();
  },
  switchStage(e) {
    const stage = e.currentTarget.dataset.stage;
    if (!this.data.busy && ['roster', 'documents', 'review', 'history'].includes(stage))
      this.setData({ stage, consent: false, fileConsent: false });
  },
  togglePlayer(e) {
    if (this.data.busy || !this._entry?.capabilities.canEditRoster) return;
    const i = Number(e.currentTarget.dataset.index),
      rows = this.data.rows.map((r) => ({ ...r }));
    if (!rows[i]) return;
    rows[i].selected = !rows[i].selected;
    this.setData({ rows, selectedCount: selectedCount(rows), dirty: true, consent: false });
  },
  jersey(e) {
    if (this.data.busy || !this._entry?.capabilities.canEditRoster) return;
    const i = Number(e.currentTarget.dataset.index),
      rows = this.data.rows.map((r) => ({ ...r }));
    if (rows[i]) {
      rows[i].jerseyNo = e.detail.value;
      this.setData({ rows, dirty: true, consent: false });
    }
  },
  consent(e) {
    if (this.data.busy) return;
    this.setData({ consent: Array.isArray(e.detail.value) && e.detail.value.includes('yes') });
  },
  fileConsent(e) {
    if (this.data.busy) return;
    this.setData({ fileConsent: Array.isArray(e.detail.value) && e.detail.value.includes('yes') });
  },
  reason(e) {
    if (this.data.busy) return;
    this.setData({ reason: e.detail.value });
  },
  purpose(e) {
    if (this.data.busy) return;
    const index = Number(e.detail.value);
    if (index === 0 || index === 1)
      this.setData({
        uploadPurposeIndex: index,
        uploadPurpose: index === 0 ? 'PRIVATE_INSURANCE' : 'REGISTRATION_DOC',
        fileConsent: false,
      });
  },
  async actor() {
    const session = await ui.session(this, this.path());
    if (!this._alive || !session) return null;
    if (session.user.id !== this._viewer) {
      this.clearPrivate();
      this.setData({ busy: false, dirty: false });
      this.load();
      return null;
    }
    return session;
  },
  beginWrite(patch) {
    const token = ui.begin(this);
    this._writeToken = token;
    this.setData({ busy: true, ...patch });
    return token;
  },
  finishWrite(token) {
    if (this._writeToken === token) {
      this._writeToken = null;
      if (this._alive && ui.live(this, token)) this.setData({ busy: false });
    }
  },
  async saveRoster() {
    if (
      this.data.busy ||
      this.data.uncertain ||
      !this.data.dirty ||
      !this._entry?.capabilities.canEditRoster
    )
      return;
    const expected = this._entry.version;
    let players;
    try {
      players = registration.normalizeRoster(this.data.rows, this._entry.rules);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const token = this.beginWrite({ error: '', message: '' }),
      repo = registration.createRepository(this._org);
    let sent = false;
    try {
      if (!(await this.actor()) || !ui.live(this, token)) return;
      const fresh = await repo.entry(this._id);
      if (!ui.live(this, token)) return;
      registration.versionMatch(fresh, expected);
      if (!fresh.capabilities.canEditRoster)
        throw Object.assign(new Error('当前状态不能修改本届名单，请重新读取'), { status: 409 });
      sent = true;
      const entry = await repo.roster(this._id, expected, players);
      if (!ui.live(this, token)) return;
      this.applyEntry(entry, this._team);
      this.setData({ message: '本届名单已保存为独立版本，请核对资料后明确提交。' });
      try {
        const files = await repo.files(this._id);
        if (ui.live(this, token)) this.applyFiles(files);
      } catch (error) {
        if (ui.live(this, token))
          this.setData({ files: [], fileWorkspace: null, fileError: ui.message(error) });
      }
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          error: ui.message(error),
          uncertain: sent && (!error.status || error.status >= 500),
          message:
            sent && (!error.status || error.status >= 500)
              ? '保存结果待核对，请先重新读取当前报名。'
              : '',
        });
    } finally {
      this.finishWrite(token);
    }
  },
  async command(e) {
    const type = e.currentTarget.dataset.type;
    if (
      !['SUBMIT', 'WITHDRAW'].includes(type) ||
      this.data.busy ||
      this.data.uncertain ||
      !this._entry
    )
      return;
    const cap = type === 'SUBMIT' ? 'canSubmit' : 'canWithdraw';
    if (
      !this._entry.capabilities[cap] ||
      (type === 'SUBMIT' && (!this.data.consent || this.data.dirty))
    )
      return;
    const expected = this._entry.version,
      reason = this.data.reason.trim();
    const token = this.beginWrite({ error: '', message: '' }),
      repo = registration.createRepository(this._org);
    let sent = false;
    try {
      if (
        !(await ui.confirm(
          type === 'SUBMIT' ? '提交本队报名审核' : '撤回本队报名',
          type === 'SUBMIT'
            ? '本次将提交已保存的名单版本，之后需等待主办方独立审核；上传凭证不等于核验通过。'
            : '请确认撤回本队本届报名。撤回保留历史，不能据此新建第二份本队报名。',
        )) ||
        !ui.live(this, token)
      )
        return;
      if (!(await this.actor()) || !ui.live(this, token)) return;
      if (type === 'SUBMIT' && (!this.data.consent || this.data.dirty))
        throw Object.assign(new Error('提交前核对已变化，请重新核对名单并声明'), { status: 409 });
      const fresh = await repo.entry(this._id);
      if (!ui.live(this, token)) return;
      registration.versionMatch(fresh, expected);
      if (!fresh.capabilities[cap])
        throw Object.assign(new Error('当前操作权限或报名状态已变化，请重新读取'), { status: 409 });
      sent = true;
      const entry = await repo.command(this._id, expected, type, reason);
      if (ui.live(this, token)) {
        this.applyEntry(entry, null);
        this.setData({
          stage: 'review',
          reason: '',
          message:
            type === 'SUBMIT' ? '报名已提交，等待主办方独立审核。' : '报名已撤回，处理记录已保留。',
        });
      }
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          error: ui.message(error),
          uncertain: sent && (!error.status || error.status >= 500),
          message:
            sent && (!error.status || error.status >= 500)
              ? '处理结果待核对，请先重新读取报名状态。'
              : '',
        });
    } finally {
      this.finishWrite(token);
    }
  },
  async upload() {
    if (
      this.data.busy ||
      this.data.uncertain ||
      this.data.dirty ||
      !this.data.fileConsent ||
      !this.data.fileWorkspace?.capabilities.canUpload
    )
      return;
    if (typeof wx.chooseMessageFile !== 'function') {
      this.setData({ fileError: '当前微信无法选择资料文件，请更新客户端后重试。' });
      return;
    }
    const token = this.beginWrite({ fileError: '', message: '' }),
      repo = registration.createRepository(this._org),
      expected = this._entry.version,
      purpose = this.data.uploadPurpose;
    let sent = false;
    try {
      if (!(await this.actor()) || !ui.live(this, token)) return;
      if (!this.data.fileConsent || this.data.dirty || this.data.uploadPurpose !== purpose)
        throw Object.assign(new Error('上传声明或名单已变化，请重新核对'), { status: 409 });
      const file = await new Promise((resolve, reject) =>
        wx.chooseMessageFile({
          count: 1,
          type: 'file',
          extension: ['pdf', 'png', 'jpg', 'jpeg'],
          success(r) {
            if (Array.isArray(r.tempFiles) && r.tempFiles.length === 1) resolve(r.tempFiles[0]);
            else reject(new Error('请选择一份资料'));
          },
          fail() {
            reject(
              Object.assign(new Error('文件选择已取消或未完成'), { status: 0, cancelled: true }),
            );
          },
        }),
      );
      const metadata = registration.selectedFile(file);
      if (!ui.live(this, token)) return;
      const freshEntry = await repo.entry(this._id),
        freshFiles = await repo.files(this._id);
      if (!ui.live(this, token)) return;
      registration.versionMatch(freshEntry, expected);
      if (!freshFiles.capabilities.canUpload || freshFiles.entryVersion !== expected)
        throw Object.assign(new Error('当前资料权限或名单版本已变化，请重新读取'), { status: 409 });
      if (freshFiles.usage.usedBytes + metadata.size > freshFiles.usage.limitBytes)
        throw Object.assign(new Error('机构文件额度不足，请先整理资料'), { status: 422 });
      const input = await registration.readFileBase64(wx, file);
      if (!ui.live(this, token)) return;
      sent = true;
      await repo.upload(this._id, { ...input, purpose, expectedEntryVersion: expected });
      if (!ui.live(this, token)) return;
      this.setData({
        fileConsent: false,
        consent: false,
        message: '文件已私有上传。上传不代表投保、承保或审核通过。',
      });
      const files = await repo.files(this._id);
      if (ui.live(this, token)) this.applyFiles(files);
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          fileConsent: false,
          fileError: ui.message(error),
          uncertain: sent && (!error.status || error.status >= 500),
          message:
            sent && (!error.status || error.status >= 500)
              ? '上传结果待核对，请先刷新文件列表，避免重复上传。'
              : '',
        });
    } finally {
      this.finishWrite(token);
    }
  },
  async revoke(e) {
    if (this.data.busy || this.data.uncertain || !this.data.fileWorkspace?.capabilities.canRevoke)
      return;
    const file = this.data.files.find((f) => f.id === e.currentTarget.dataset.id);
    if (!file || file.status !== 'ACTIVE') return;
    const reason = this.data.reason.trim();
    if (Array.from(reason).length < 4 || Array.from(reason).length > 500) {
      this.setData({ fileError: '移除原因需为4–500个字符。' });
      return;
    }
    const token = this.beginWrite({ fileError: '', message: '' }),
      repo = registration.createRepository(this._org);
    let sent = false;
    try {
      if (
        !(await ui.confirm(
          '撤销这份私有文件',
          '将撤销该文件的后续读取。内容清除和额度释放需另行管理；不影响已被合法查看或保存的副本。',
        )) ||
        !ui.live(this, token)
      )
        return;
      if (!(await this.actor()) || !ui.live(this, token)) return;
      const files = await repo.files(this._id);
      if (!ui.live(this, token)) return;
      const fresh = files.files.find((f) => f.id === file.id);
      if (
        !files.capabilities.canRevoke ||
        !fresh ||
        fresh.status !== 'ACTIVE' ||
        fresh.version !== file.version
      )
        throw Object.assign(new Error('文件或当前权限已变化，请刷新后核对'), { status: 409 });
      sent = true;
      await repo.revokeFile(this._id, file.id, file.version, reason);
      if (!ui.live(this, token)) return;
      this.removeTemporaryFiles();
      this.setData({
        consent: false,
        fileConsent: false,
        reason: '',
        message: '文件已撤销，不等于内容已清除或额度已释放。',
      });
      const latest = await repo.files(this._id);
      if (ui.live(this, token)) this.applyFiles(latest);
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          fileError: ui.message(error),
          uncertain: sent && (!error.status || error.status >= 500),
        });
    } finally {
      this.finishWrite(token);
    }
  },
  removeTemporaryFiles() {
    for (const filePath of [...(this._temporaryFiles || [])]) this.unlinkTemporaryFile(filePath);
  },
  unlinkTemporaryFile(filePath) {
    if (typeof wx.getFileSystemManager !== 'function') return;
    if (!this._temporaryFiles.includes(filePath)) this._temporaryFiles.push(filePath);
    wx.getFileSystemManager().unlink({
      filePath,
      success: () => {
        this._temporaryFiles = this._temporaryFiles.filter((path) => path !== filePath);
      },
      // Keep a failed path in memory so onUnload/next cleanup can retry.
      fail() {},
    });
  },
  async viewFile(e) {
    if (this.data.busy || this.data.dirty || this.data.uncertain) return;
    const file = this.data.files.find(
      (f) => f.id === e.currentTarget.dataset.id && f.status === 'ACTIVE',
    );
    if (!file || !(await this.actor())) return;
    const token = ui.begin(this),
      client = api.getClient();
    if (
      typeof client.download !== 'function' ||
      typeof wx.getFileSystemManager !== 'function' ||
      !wx.env?.USER_DATA_PATH
    ) {
      this.setData({ fileError: '当前客户端无法安全查看私有文件，请更新后重试。' });
      return;
    }
    this.setData({ busy: true, fileError: '' });
    let filePath;
    try {
      const data = await client.download(
        '/v1/orgs/' + this._org + '/entries/' + this._id + '/media-files/' + file.id + '/content',
      );
      if (!ui.live(this, token) || !this._visible) return;
      if (
        data.contentType !== file.contentType ||
        !data.data ||
        data.data.byteLength !== file.byteLength ||
        data.data.byteLength > 8388608
      )
        throw new Error('文件内容与当前记录不一致，请重新读取');
      const extension =
        file.contentType === 'application/pdf'
          ? 'pdf'
          : file.contentType === 'image/png'
            ? 'png'
            : 'jpg';
      filePath =
        wx.env.USER_DATA_PATH + '/scb-private-' + file.id + '-' + Date.now() + '.' + extension;
      this._temporaryFiles.push(filePath);
      await new Promise((resolve, reject) =>
        wx.getFileSystemManager().writeFile({
          filePath,
          data: data.data,
          success: resolve,
          fail() {
            reject(new Error('临时文件写入失败'));
          },
        }),
      );
      if (!ui.live(this, token) || !this._visible) {
        this.unlinkTemporaryFile(filePath);
        return;
      }
      if (extension === 'pdf')
        await new Promise((resolve, reject) =>
          wx.openDocument({
            filePath,
            fileType: 'pdf',
            showMenu: false,
            success: resolve,
            fail() {
              reject(new Error('无法打开PDF资料'));
            },
          }),
        );
      else
        await new Promise((resolve, reject) =>
          wx.previewImage({
            current: filePath,
            urls: [filePath],
            showmenu: false,
            success: resolve,
            fail() {
              reject(new Error('无法打开图片资料'));
            },
          }),
        );
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          fileError: ui.message(error),
          ...([403, 404, 410].includes(error.status) ? { files: [], fileWorkspace: null } : {}),
        });
      if (filePath) {
        this.unlinkTemporaryFile(filePath);
      }
    } finally {
      if (ui.live(this, token)) this.setData({ busy: false });
    }
  },
});
