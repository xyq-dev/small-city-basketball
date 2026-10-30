const api = require('../../utils/api');
const ui = require('../../utils/ui');
const materials = require('../../utils/participant-materials');
const PATH = '/pages/participant-materials/index';
const emptyForm = () => ({
  realName: '',
  identityNumber: '',
  insurer: '',
  policyNumber: '',
  startDate: '',
  endDate: '',
  acceptedTerms: false,
  publicityConsent: false,
});
Page({
  data: {
    mode: 'list',
    entries: [],
    workspace: null,
    material: null,
    members: [],
    form: emptyForm(),
    privateDetails: null,
    reason: '',
    identityChecked: false,
    portraitChecked: false,
    insuranceChecked: false,
    loading: false,
    busy: false,
    dirty: false,
    pending: false,
    storageError: '',
    error: '',
    message: '',
    loginRequired: false,
  },
  onLoad(query = {}) {
    this._alive = true;
    this._visible = true;
    this._temporaryFiles = [];
    if (query.orgId || query.entryId) {
      try {
        this._org = materials.id(query.orgId);
        this._entry = materials.id(query.entryId);
        this.setData({ mode: query.mode === 'review' ? 'review' : 'mine' });
      } catch (error) {
        this._invalid = true;
        this.setData({ error: ui.message(error) });
      }
    }
  },
  onShow() {
    this._visible = true;
    materials.sweepTemps(wx);
    if (!this.data.busy) this.load();
  },
  onHide() {
    this._visible = false;
    ui.close(this);
    this.clearPrivate();
    this.cleanupFiles();
  },
  onUnload() {
    this._alive = false;
    this.onHide();
  },
  onSessionReset() {
    this.clearPrivate();
    this.setData({ loginRequired: true, error: '登录身份已变化，已清除上一账号的私有资料。' });
    this.cleanupFiles();
  },
  clearPrivate() {
    this._workspace = null;
    this._selected = null;
    this._viewer = null;
    this.setData({
      entries: [],
      workspace: null,
      material: null,
      members: [],
      privateDetails: null,
      form: emptyForm(),
      reason: '',
      identityChecked: false,
      portraitChecked: false,
      insuranceChecked: false,
      dirty: false,
      busy: false,
      loading: false,
      pending: false,
    });
  },
  path() {
    return this._org
      ? PATH +
          '?orgId=' +
          this._org +
          '&entryId=' +
          this._entry +
          (this.data.mode === 'review' ? '&mode=review' : '')
      : PATH;
  },
  login() {
    ui.login(this.path());
  },
  repo() {
    return materials.createRepository(this._org, this._entry);
  },
  async actor(token) {
    const session = await ui.session(this, this.path());
    return session && ui.held(this, token) && this._visible && session.user.id === this._viewer;
  },
  applyMine(workspace) {
    this._workspace = workspace;
    const m = workspace.material;
    this._selected = m;
    this.setData({
      workspace,
      material: m ? materials.view(m) : null,
      privateDetails: null,
      form: {
        realName: m?.realName || '',
        identityNumber: '',
        insurer: m?.insurance?.insurer || '',
        policyNumber: '',
        startDate: m?.insurance?.startDate || '',
        endDate: m?.insurance?.endDate || '',
        acceptedTerms: m?.status !== 'STALE' && m?.acceptedTerms === true,
        publicityConsent: m?.publicityConsent === true,
      },
      dirty: false,
      reason: '',
      identityChecked: false,
      portraitChecked: false,
      insuranceChecked: false,
    });
  },
  async load() {
    if (this._invalid || this.data.busy || !this._visible) return;
    let token = ui.begin(this);
    this.clearPrivate();
    this.setData({ loading: true, error: '', message: '', storageError: '' });
    const session = await ui.session(this, this.path());
    if (!this._alive || !this._visible) return;
    if (!session) {
      this.setData({ loading: false });
      return;
    }
    if (api.getClient().viewerId() !== session.user.id) return;
    this._viewer = session.user.id;
    token = ui.begin(this);
    this.setData({ loading: true, loginRequired: false, error: '' });
    try {
      if (this.data.mode === 'list') {
        const entries = await materials.myEntries();
        if (ui.live(this, token)) this.setData({ entries });
      } else if (this.data.mode === 'mine') {
        const workspace = await this.repo().mine();
        if (!ui.live(this, token)) return;
        this.applyMine(workspace);
        const stored = materials.readPending(wx, this._viewer, this._org, this._entry);
        this._pending = stored.record;
        this.setData({ pending: !!stored.record, storageError: stored.error });
        if (stored.record) await this.reconcile(token, stored.record);
      } else {
        const workspace = await this.repo().progress();
        if (ui.live(this, token)) {
          this._workspace = workspace;
          this.setData({ workspace, members: workspace.members.map(materials.view) });
        }
      }
    } catch (error) {
      if (ui.live(this, token)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.live(this, token)) this.setData({ loading: false });
    }
  },
  async reconcile(token, record) {
    try {
      const receipt = await this.repo().receipt(record.clientRequestId);
      if (!ui.live(this, token)) return;
      if (!materials.clearPending(wx, record)) {
        this.setData({
          storageError: '原请求已核对，但本机保护记录无法清除；请修复存储后再保存。',
        });
        return;
      }
      this._pending = null;
      this.setData({
        pending: false,
        message: receipt.isCurrent
          ? '原请求已由服务器确认保存。请核对当前资料。'
          : '原请求已保存，之后已有新版本。当前显示服务器最新资料。',
      });
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          pending: true,
          error:
            error?.status === 404
              ? '服务器尚未找到原请求回执；请求仍可能在途，请稍后重新核对，不能另建请求覆盖。'
              : ui.message(error),
        });
    }
  },
  openEntry(e) {
    const item = this.data.entries.find(
      (v) => v.entryId === e.currentTarget.dataset.id && v.orgId === e.currentTarget.dataset.org,
    );
    if (!item || this.data.busy) return;
    ui.open('participant-materials', { orgId: item.orgId, entryId: item.entryId });
  },
  async openMember(e) {
    if (this.data.busy || this.data.loading) return;
    const memberId = e.currentTarget.dataset.id,
      row = this.data.members.find((m) => m.memberId === memberId);
    if (!row) return;
    const token = ui.begin(this);
    this._selected = row;
    this.setData({
      material: materials.view(row),
      privateDetails: null,
      reason: '',
      identityChecked: false,
      portraitChecked: false,
      insuranceChecked: false,
    });
    if (!row.capabilities.canReadPrivate) return;
    try {
      const current = await this.repo().member(memberId);
      if (ui.live(this, token) && this._selected?.memberId === memberId) {
        this._selected = current;
        this.setData({ material: materials.view(current) });
      }
    } catch (error) {
      if (ui.live(this, token)) this.setData({ error: ui.message(error) });
    }
  },
  closeMember() {
    if (this.data.busy) return;
    this._selected = null;
    this.setData({
      material: null,
      privateDetails: null,
      reason: '',
      identityChecked: false,
      portraitChecked: false,
      insuranceChecked: false,
    });
    this.cleanupFiles();
  },
  field(e) {
    if (this.data.busy || this.data.pending || !this._workspace?.capabilities?.canSave) return;
    const key = e.currentTarget.dataset.field;
    if (
      !['realName', 'identityNumber', 'insurer', 'policyNumber', 'startDate', 'endDate'].includes(
        key,
      )
    )
      return;
    this.setData({ ['form.' + key]: e.detail.value, dirty: true, privateDetails: null });
  },
  checkbox(e) {
    if (this.data.busy) return;
    const key = e.currentTarget.dataset.field,
      checked = Array.isArray(e.detail.value) && e.detail.value.includes('yes');
    if (['acceptedTerms', 'publicityConsent'].includes(key)) {
      if (this.data.pending || !this._workspace?.capabilities?.canSave) return;
      this.setData({ ['form.' + key]: checked, dirty: true });
    } else if (['identityChecked', 'portraitChecked', 'insuranceChecked'].includes(key))
      this.setData({ [key]: checked });
  },
  reasonInput(e) {
    if (!this.data.busy) this.setData({ reason: e.detail.value });
  },
  insuranceInput() {
    const f = this.data.form,
      patch = {};
    for (const key of ['insurer', 'policyNumber', 'startDate', 'endDate']) {
      const value = f[key].trim();
      if (!value) continue;
      if (['startDate', 'endDate'].includes(key) && !/^\d{4}-\d{2}-\d{2}$/.test(value))
        throw new Error('保障日期请使用 YYYY-MM-DD 格式。');
      patch[key] = value;
    }
    return patch;
  },
  async save() {
    await this.saveDraft();
  },
  async saveInsurance() {
    let insurance;
    try {
      insurance = this.insuranceInput();
      if (!Object.keys(insurance).length)
        throw new Error('请先填写需要保存的保单资料；留空会保留服务端原值。');
    } catch (e) {
      this.setData({ error: ui.message(e) });
      return;
    }
    await this.saveDraft(async () => ({ insurance }));
  },
  async upload(e) {
    const kind = e.currentTarget.dataset.kind;
    if (!['portrait', 'insurance'].includes(kind)) return;
    let insurance;
    if (kind === 'insurance') {
      try {
        insurance = this.insuranceInput();
      } catch (error) {
        this.setData({ error: ui.message(error) });
        return;
      }
    }
    await this.saveDraft(async (token) => {
      const chosen = await materials.chooseFile(wx, kind);
      if (!ui.held(this, token) || !this._visible) return null;
      const op = await ui.confirmOp(
        this,
        kind === 'portrait' ? '上传本人照片' : '提交外部保单',
        kind === 'portrait'
          ? '请确认照片为本人近期清晰正面单人照。保存后须经人工核对；宣传使用另行选择。'
          : '保存不代表保障有效或审核通过，不会要求你重复购买保险。',
      );
      if (!op || !op.valid() || !ui.held(this, token)) return null;
      const base64 = await materials.readBase64(wx, chosen);
      if (!op.valid() || !ui.held(this, token) || !this._visible) return null;
      const input = { fileName: chosen.name, contentType: chosen.contentType, base64 };
      return kind === 'portrait'
        ? { portrait: input, publicityConsent: false }
        : { insurance: { ...insurance, document: input } };
    });
  },
  async saveDraft(extra) {
    if (
      this.data.busy ||
      this.data.loading ||
      this.data.pending ||
      this.data.storageError ||
      !this._workspace?.capabilities.canSave
    )
      return;
    const f = { ...this.data.form },
      expectedVersion = this._workspace.material?.version || 0,
      token = ui.hold(this),
      viewer = this._viewer;
    this.setData({ busy: true, error: '', message: '', privateDetails: null });
    let sent = false,
      record;
    try {
      if (!(await this.actor(token))) return;
      const additional = extra ? await extra(token) : {};
      if (additional === null || !ui.held(this, token) || !this._visible) return;
      const clientRequestId = await ui.uuid();
      if (!ui.held(this, token) || this._viewer !== viewer) return;
      const body = {
        clientRequestId,
        expectedVersion,
        realName: f.realName.trim() || null,
        ...(f.identityNumber.trim()
          ? { identityNumber: f.identityNumber.trim().toUpperCase() }
          : {}),
        acceptedTerms: f.acceptedTerms,
        publicityConsent: f.publicityConsent,
        ...additional,
      };
      record = {
        userId: viewer,
        orgId: this._org,
        entryId: this._entry,
        clientRequestId,
        expectedVersion,
      };
      if (!materials.writePending(wx, record))
        throw new Error('原请求保护记录未能保存；未发送任何资料。请修复本机存储后重试。');
      this._pending = record;
      this.setData({ pending: true });
      if (!ui.held(this, token) || !this._visible) {
        materials.clearPending(wx, record);
        return;
      }
      sent = true;
      const result = await this.repo().save(body);
      if (!ui.held(this, token)) return;
      this.applyMine(result);
      if (materials.clearPending(wx, record)) {
        this._pending = null;
        this.setData({
          pending: false,
          message: '草稿已私有保存。资料审核与最终报名资格分别核验。',
        });
      } else
        this.setData({
          pending: true,
          storageError: '服务器已保存，但本机保护记录未清除；请先重新核对。',
        });
    } catch (error) {
      // Resolve a definitive rejection's exact account/entry/request even after this Page
      // closes. Only live callbacks may touch UI; unknown transport outcomes keep protection.
      const resolved =
        record && (!sent || !materials.unknown(error)) && materials.clearPending(wx, record);
      if (!ui.held(this, token)) return;
      if (resolved) {
        this._pending = null;
        this.setData({ pending: false });
      }
      this.setData({
        error: error?.cancelled ? '' : ui.message(error),
        message:
          sent && materials.unknown(error)
            ? '保存结果未知，原请求编号已保留。请重新核对回执，避免另建请求。'
            : '',
      });
    } finally {
      if (ui.held(this, token))
        this.setData({ busy: false, 'form.identityNumber': '', 'form.policyNumber': '' });
    }
  },
  async command(e) {
    const action = e.currentTarget.dataset.action;
    if (
      !['submit', 'withdraw'].includes(action) ||
      this.data.busy ||
      this.data.pending ||
      !this._workspace
    )
      return;
    const workspace = this._workspace,
      version = workspace.material?.version,
      cap = action === 'submit' ? 'canSubmit' : 'canWithdrawPublicity';
    if (!version || !workspace.capabilities[cap] || (action === 'submit' && this.data.dirty))
      return;
    if (
      action === 'submit' &&
      (!workspace.material.portrait || !workspace.material.acceptedTerms)
    ) {
      this.setData({ error: '请先私有保存本人照片并完成本人确认，再提交资料。' });
      return;
    }
    const op = await ui.confirmOp(
      this,
      action === 'submit' ? '提交本人资料审核' : '撤回宣传照片授权',
      action === 'submit'
        ? '提交已保存的本人资料，等待独立人工审核；资料通过后仍需队伍报名审核与冻结。'
        : '停止后续使用该照片制作宣传素材；这不会因拒绝宣传而影响参赛资格。已转发的图片无法保证追回。',
    );
    if (!op || this.data.busy || this._workspace !== workspace) return;
    const token = ui.hold(this);
    this.setData({ busy: true, error: '', message: '', privateDetails: null });
    try {
      if (!(await this.actor(token)) || !op.valid()) return;
      const result = await this.repo()[action](version);
      if (ui.held(this, token)) {
        this.applyMine(result);
        this.setData({
          message:
            action === 'submit'
              ? '本人资料已提交，等待组委会独立审核。'
              : '宣传授权已撤回；参赛审核状态不因此改变。',
        });
      }
    } catch (error) {
      if (ui.held(this, token))
        this.setData({
          error: ui.message(error),
          message: materials.unknown(error) ? '处理结果待核对，请重新读取当前状态。' : '',
        });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async revealPrivate() {
    const selected = this._selected;
    if (!selected?.capabilities.canReadPrivate || this.data.busy || this.data.pending) return;
    const op = await ui.confirmOp(
      this,
      '查看受保护的报名文字资料',
      '仅用于本人核对或独立资格审核，本次访问会记录审计。请勿截图、转发或复制给无权人员。',
    );
    if (!op || this._selected !== selected) return;
    const token = ui.hold(this);
    this.setData({ busy: true, error: '', privateDetails: null });
    try {
      if (!(await this.actor(token)) || !op.valid()) return;
      const value = await this.repo().private(selected.memberId);
      if (ui.held(this, token) && op.valid() && this._visible && this._selected === selected)
        this.setData({ privateDetails: value });
    } catch (error) {
      if (ui.held(this, token)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  concealPrivate() {
    this.setData({ privateDetails: null });
  },
  async review(e) {
    const viewer = this._viewer,
      sessionRevision = api.getClient().sessionRevision();
    const selected = this._selected,
      decision = e.currentTarget.dataset.decision,
      reason = this.data.reason.trim();
    if (
      !selected?.capabilities.canReview ||
      !['APPROVE', 'REQUEST_CHANGES'].includes(decision) ||
      this.data.busy
    )
      return;
    if (Array.from(reason).length < 4 || Array.from(reason).length > 500) {
      this.setData({ error: '请填写4–500字审核说明。' });
      return;
    }
    if (
      decision === 'APPROVE' &&
      (!this.data.identityChecked ||
        !this.data.portraitChecked ||
        (selected.insurance && !this.data.insuranceChecked))
    ) {
      this.setData({ error: '请完成身份、照片及适用的保障材料人工核对。' });
      return;
    }
    const body = {
      decision,
      expectedVersion: selected.version,
      reason,
      identityChecked: this.data.identityChecked,
      portraitChecked: this.data.portraitChecked,
      insuranceChecked: this.data.insuranceChecked,
    };
    const op = await ui.confirmOp(
      this,
      decision === 'APPROVE' ? '通过这版本人资料' : '退回补齐本人资料',
      '仅处理当前成员的已提交版本；不代替本队最终报名审核。版本或权限变化时操作会被拒绝。',
    );
    if (!op || this.data.busy || this._selected !== selected) return;
    const token = ui.hold(this);
    this.setData({ busy: true, error: '', privateDetails: null });
    try {
      if (!(await this.actor(token)) || !op.valid() || this._selected !== selected) return;
      await this.repo().review(selected.memberId, body);
      if (!ui.held(this, token)) return;
      this.setData({ busy: false });
      await this.load();
      if (
        this._visible &&
        this._viewer === viewer &&
        api.getClient().sessionRevision() === sessionRevision
      )
        this.setData({
          message:
            decision === 'APPROVE'
              ? '当前版本本人资料审核通过。'
              : '已退回本人补齐，审核说明已保存。',
        });
    } catch (error) {
      if (ui.held(this, token))
        this.setData({
          error: ui.message(error),
          message: materials.unknown(error) ? '审核结果待核对，请重新读取。' : '',
        });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async viewFile(e) {
    const selected = this._selected,
      kind = e.currentTarget.dataset.kind,
      file = kind === 'portrait' ? selected?.portrait : selected?.insurance?.document;
    if (!file || !selected.capabilities.canReadPrivate || this.data.busy || this.data.pending)
      return;
    if (!wx.env?.USER_DATA_PATH || typeof wx.getFileSystemManager !== 'function') {
      this.setData({ error: '当前客户端无法安全查看私有文件。' });
      return;
    }
    const token = ui.hold(this);
    this.setData({ busy: true, error: '', privateDetails: null });
    let path;
    try {
      if (!(await this.actor(token))) return;
      const value = await this.repo().download(selected.memberId, kind);
      if (!ui.held(this, token) || !this._visible || this._selected !== selected) return;
      if (value.contentType !== file.contentType || value.data.byteLength !== file.byteLength)
        throw new Error('私有文件元数据已变化，请重新读取后查看。');
      const suffix =
        file.contentType === 'application/pdf'
          ? 'pdf'
          : file.contentType === 'image/png'
            ? 'png'
            : 'jpg';
      const key = await ui.uuid();
      if (!ui.held(this, token)) return;
      path = wx.env.USER_DATA_PATH + '/scb-participant-' + key + '.' + suffix;
      if (!materials.trackTemp(wx, path)) throw new Error('无法记录私有临时文件，已停止预览。');
      this._temporaryFiles.push(path);
      await new Promise((resolve, reject) =>
        wx.getFileSystemManager().writeFile({
          filePath: path,
          data: value.data,
          success: resolve,
          fail: () => reject(new Error('私有临时文件写入失败')),
        }),
      );
      if (!ui.held(this, token) || !this._visible || this._selected !== selected) {
        materials.releaseTemp(wx, path);
        return;
      }
      if (suffix === 'pdf')
        wx.openDocument({
          filePath: path,
          fileType: 'pdf',
          showMenu: false,
          fail: () => materials.releaseTemp(wx, path),
        });
      else
        wx.previewImage({
          current: path,
          urls: [path],
          showmenu: false,
          fail: () => materials.releaseTemp(wx, path),
        });
    } catch (error) {
      if (path) materials.releaseTemp(wx, path);
      if (ui.held(this, token)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  cleanupFiles() {
    for (const path of this._temporaryFiles || []) materials.releaseTemp(wx, path);
    this._temporaryFiles = [];
  },
});
