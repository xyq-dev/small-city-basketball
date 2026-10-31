const api = require('../../utils/api'),
  ui = require('../../utils/ui'),
  recovery = require('../../utils/insurance-recovery'),
  files = require('../../utils/participant-materials');
Page({
  data: {
    orgId: '',
    entryId: '',
    memberId: '',
    userId: '',
    workspace: null,
    quote: null,
    selectedProduct: '',
    consent: false,
    pending: null,
    busy: false,
    loading: false,
    error: '',
    message: '',
    checkoutUrl: '',
  },
  onLoad(q) {
    this._temporaryFiles = [];
    try {
      if (q.orgId) this.setData({ orgId: api.uuid(q.orgId) });
      if (q.entryId) this.setData({ entryId: api.uuid(q.entryId) });
      if (q.memberId) this.setData({ memberId: api.uuid(q.memberId) });
    } catch (e) {
      this._invalid = true;
      this.setData({ error: ui.message(e) });
    }
  },
  onShow() {
    this._closed = false;
    this.load();
  },
  onHide() {
    ui.close(this);
    for (const p of this._temporaryFiles || []) files.releaseTemp(wx, p);
    this._temporaryFiles = [];
    this.setData({
      busy: false,
      loading: false,
      workspace: null,
      quote: null,
      userId: '',
      pending: null,
      checkoutUrl: '',
      consent: false,
    });
  },
  onUnload() {
    this.onHide();
  },
  onSessionReset() {
    this.onHide();
    this.setData({ busy: false, loading: false, error: '登录身份已变化，请重新读取。' });
  },
  async load() {
    if (this._invalid || this.data.busy) return;
    const t = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      const s = await ui.session(this, '/pages/insurance/index');
      if (!s || !ui.live(this, t)) return;
      const w = (await api.getClient().request('/v1/insurance')).data;
      if (ui.live(this, t))
        this.setData({ userId: s.user.id, workspace: w, pending: recovery.read(s.user.id) });
    } catch (e) {
      if (ui.live(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.live(this, t)) this.setData({ loading: false });
    }
  },
  select(e) {
    if (!this.data.busy && !this.data.pending)
      this.setData({
        selectedProduct: api.uuid(e.currentTarget.dataset.id),
        quote: null,
        consent: false,
      });
  },
  consent() {
    if (!this.data.busy && !this.data.pending) this.setData({ consent: !this.data.consent });
  },
  async quote() {
    if (!this.data.entryId || !this.data.memberId || !this.data.selectedProduct)
      return this.setData({ error: '请从本人赛事资料选择球员及保险产品。' });
    return this.write('QUOTE', '/v1/insurance/quotes', {
      entryId: this.data.entryId,
      memberId: this.data.memberId,
      productId: this.data.selectedProduct,
    });
  },
  async purchase() {
    if (!this.data.quote || !this.data.consent) return;
    return this.write('PURCHASE', '/v1/insurance/purchases', {
      quoteId: this.data.quote.quoteId,
      acceptedTermsVersion: 'insurance-purchase-consent-v1',
    });
  },
  async command(e) {
    if (this.data.busy || this.data.pending) return;
    const o = this.data.workspace.orders.find((x) => x.id === e.currentTarget.dataset.id);
    if (!o) return;
    const type = e.currentTarget.dataset.type;
    const op =
      type === 'REQUEST_CANCELLATION'
        ? await ui.confirmOp(
            this,
            '申请退保',
            '退保与退款依服务方条款，提交不表示已退保或款项到账。',
          )
        : null;
    if (type === 'REQUEST_CANCELLATION' && !op) return;
    return this.write(
      'COMMAND',
      '/v1/insurance/orders/' + o.id + '/commands',
      {
        expectedVersion: o.version,
        type,
      },
      op,
    );
  },
  async write(kind, path, body, op) {
    if (this.data.busy || this.data.pending || !this.data.userId || (op && !op.valid())) return;
    const t = ui.hold(this),
      actor = this.data.userId;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const id = await ui.uuid();
      if (!ui.held(this, t) || (op && !op.valid())) return;
      const value = { kind, path, body: { clientRequestId: id, ...body } };
      recovery.save(actor, value);
      if (ui.held(this, t)) this.setData({ pending: value });
      await this.send(actor, value, t);
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async send(actor, value, t) {
    if (!ui.held(this, t)) return;
    try {
      const result = (await api.getClient().request(value.path, 'POST', value.body)).data;
      recovery.clear(actor, value);
      if (ui.held(this, t)) {
        this.setData({
          pending: null,
          quote: value.kind === 'QUOTE' ? result : null,
          consent: false,
          message:
            value.kind === 'PURCHASE'
              ? '投保申请已记录，请查单；尚不代表付款、出单或报名通过。'
              : '操作已记录，请重新读取实际进度。',
        });
        if (value.kind !== 'QUOTE') {
          this.setData({ busy: false });
          await this.load();
        }
      }
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status))
        recovery.clear(actor, value);
      if (ui.held(this, t)) this.setData({ pending: recovery.read(actor), error: ui.message(e) });
    }
  },
  async recover() {
    if (this.data.busy || !this.data.pending) return;
    const t = ui.hold(this),
      actor = this.data.userId,
      value = this.data.pending;
    this.setData({ busy: true, error: '' });
    try {
      const r = (await api.getClient().request(recovery.receipt(value))).data;
      if (!ui.held(this, t)) return;
      if (r.found) {
        recovery.clear(actor, value);
        this.setData({
          pending: null,
          quote: value.kind === 'QUOTE' ? r.result : null,
          message: '原请求已完成；请读取保单实际进度。',
        });
      } else await this.send(actor, value, t);
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  terms(e) {
    const p = this.data.workspace?.products.find((x) => x.id === e.currentTarget.dataset.id);
    if (p && !this.data.busy && !this.data.pending) this.setData({ checkoutUrl: p.termsUrl });
  },
  async checkout(e) {
    if (this.data.busy || this.data.pending) return;
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      const d = (
        await api
          .getClient()
          .request('/v1/insurance/orders/' + api.uuid(e.currentTarget.dataset.id) + '/checkout')
      ).data;
      if (ui.held(this, t)) this.setData({ checkoutUrl: d.url });
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async document(e) {
    if (this.data.busy || this.data.pending) return;
    if (!wx.env?.USER_DATA_PATH || typeof wx.getFileSystemManager !== 'function')
      return this.setData({ error: '当前客户端无法安全查看私有文件。' });
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    let path;
    try {
      const value = await api
        .getClient()
        .download('/v1/insurance/orders/' + api.uuid(e.currentTarget.dataset.id) + '/document');
      if (!ui.held(this, t)) return;
      if (
        value.contentType !== 'application/pdf' ||
        !value.data?.byteLength ||
        value.data.byteLength > 2 * 1024 * 1024
      )
        throw Error('保单文件元数据无效，请重新查单。');
      const id = await ui.uuid();
      if (!ui.held(this, t)) return;
      path = wx.env.USER_DATA_PATH + '/scb-participant-insurance-' + id + '.pdf';
      if (!files.trackTemp(wx, path)) throw Error('无法记录私有临时文件，已停止预览。');
      this._temporaryFiles.push(path);
      await new Promise((resolve, reject) =>
        wx.getFileSystemManager().writeFile({
          filePath: path,
          data: value.data,
          success: resolve,
          fail: () => reject(Error('私有文件写入失败')),
        }),
      );
      if (!ui.held(this, t)) {
        files.releaseTemp(wx, path);
        return;
      }
      wx.openDocument({
        filePath: path,
        fileType: 'pdf',
        showMenu: false,
        fail: () => files.releaseTemp(wx, path),
      });
    } catch (e) {
      if (path) files.releaseTemp(wx, path);
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  qualification() {
    if (this.data.orgId && this.data.entryId)
      ui.open('qualification-precheck', { orgId: this.data.orgId, entryId: this.data.entryId });
  },
  returnFromCheckout() {
    this.setData({ checkoutUrl: '' });
    this.load();
  },
});
