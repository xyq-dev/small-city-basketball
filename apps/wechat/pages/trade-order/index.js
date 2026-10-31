const ui = require('../../utils/ui');
const trade = require('./client');
Page({
  data: {
    loading: false,
    busy: false,
    error: '',
    message: '',
    order: null,
    orders: [],
    pending: null,
    pendingAcknowledged: false,
    consent: false,
    amount: '',
    reason: '',
    evidence: '',
    noCharge: false,
  },
  onLoad(q) {
    this._alive = true;
    try {
      this.id = q.id ? trade.id(q.id) : '';
      this.kind = q.kind || '';
      this.sourceId = q.sourceId ? trade.id(q.sourceId) : '';
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  onShow() {
    this._visible = true;
    this.load();
  },
  onHide() {
    this._visible = false;
    this.setData({
      consent: false,
      order: null,
      amount: '',
      reason: '',
      evidence: '',
      pendingAcknowledged: false,
      message: '',
    });
    ui.close(this);
  },
  onUnload() {
    this._alive = false;
    this._visible = false;
    ui.close(this);
  },
  onSessionReset() {
    this.actor = '';
    this.setData({
      order: null,
      orders: [],
      pending: null,
      amount: '',
      reason: '',
      evidence: '',
      message: '',
      pendingAcknowledged: false,
      busy: false,
      consent: false,
      error: '身份已变化，请重新读取',
    });
  },
  pendingState() {
    try {
      return trade.pending(this.actor);
    } catch {
      return { invalid: true, body: { clientRequestId: '恢复记录无法核验' } };
    }
  },
  pendingConsent(e) {
    this.setData({ pendingAcknowledged: (e.detail.value || []).includes('yes') });
  },
  clearPending() {
    if (this.actor && this.data.pendingAcknowledged && !this.data.busy) {
      try {
        trade.clear(this.actor);
        this.setData({
          pending: null,
          pendingAcknowledged: false,
          message: '仅移除本机标记，不取消服务端原操作。',
        });
      } catch (e) {
        this.setData({ error: ui.message(e) });
      }
    }
  },
  reason() {
    const v = String(this.data.reason || '').trim();
    if (v.length < 4 || v.length > 1000) throw Error('请填写4至1000字的真实说明');
    return v;
  },
  input(e) {
    if (!this.data.busy && ['amount', 'reason', 'evidence'].includes(e.currentTarget.dataset.field))
      this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  consent(e) {
    this.setData({ consent: (e.detail.value || []).includes('yes') });
  },
  async load() {
    if (!this._alive || !this._visible || this.data.busy) return;
    const token = ui.begin(this);
    this.setData({ loading: true, error: '', order: null });
    try {
      const s = await ui.session(this, '/pages/trade-order/index');
      if (!s || !ui.live(this, token)) return;
      this.actor = s.user.id;
      const pending = this.pendingState();
      if (!this.id && this.sourceId) {
        const binding = await trade.read(
          '/source?kind=' + encodeURIComponent(this.kind) + '&sourceId=' + this.sourceId,
        );
        this.id = binding.orderId ? trade.id(binding.orderId) : '';
        if (!this.id) {
          this.setData({ noCharge: true, loading: false, pending });
          return;
        }
      }
      if (this.id) {
        const order = trade.order(await trade.read('/orders/' + this.id));
        if (ui.live(this, token))
          this.setData({ order, pending, loading: false, noCharge: false, consent: false });
      } else {
        const result = await trade.read('/orders');
        if (!Array.isArray(result.orders)) throw Error('资金列表格式无效');
        if (ui.live(this, token))
          this.setData({
            orders: result.orders.map((x) => ({ ...x, totalText: trade.money(x.totalFen) })),
            pending,
            loading: false,
          });
      }
    } catch (e) {
      if (ui.live(this, token)) this.setData({ error: ui.message(e), loading: false });
    }
  },
  open(e) {
    wx.navigateTo({ url: '/pages/trade-order/index?id=' + trade.id(e.currentTarget.dataset.id) });
  },
  async run(path, body, code) {
    if (this.data.busy || !this.actor) return;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const id = await ui.uuid();
      const result = await trade.execute(this.actor, path, { clientRequestId: id, ...body }, code);
      if (!this._alive || !this._visible) return;
      return result;
    } catch (e) {
      if (this._alive && this._visible)
        this.setData({ error: ui.message(e), pending: this.pendingState() });
    } finally {
      if (this._alive && this._visible) this.setData({ busy: false });
    }
  },
  async pay(e) {
    const o = this.data.order;
    if (!o || !this.data.consent) return;
    const channel = e.currentTarget.dataset.channel;
    let code;
    if (channel === 'JSAPI') {
      try {
        code = await new Promise((resolve, reject) =>
          wx.login({
            success: (r) => (r.code ? resolve(r.code) : reject(Error('微信登录码不可用'))),
            fail: reject,
          }),
        );
      } catch (err) {
        this.setData({ error: ui.message(err) });
        return;
      }
    }
    const result = await this.run(
      '/orders/' + o.id + '/payments',
      { expectedVersion: o.version, channel },
      code,
    );
    await this.load();
    if (result && channel === 'JSAPI')
      await this.continueJsapi({ currentTarget: { dataset: { id: result.attemptId } } });
  },
  async continueJsapi(e) {
    const o = this.data.order,
      a = o && o.attempts.find((x) => x.id === e.currentTarget.dataset.id),
      c = a && a.checkout;
    if (!c || c.mode !== 'JSAPI' || this.data.busy) return;
    try {
      await new Promise((resolve, reject) =>
        wx.requestPayment({
          timeStamp: c.timeStamp,
          nonceStr: c.nonceStr,
          package: c.package,
          signType: c.signType,
          paySign: c.paySign,
          success: resolve,
          fail: reject,
        }),
      );
      if (this._alive && this._visible)
        this.setData({ message: '微信界面已返回，付款仍待服务端核实。请查询原支付结果。' });
    } catch (err) {
      if (this._alive && this._visible)
        this.setData({ message: '微信支付界面已关闭，是否扣款请查询原支付结果。' });
    }
  },
  copy(e) {
    const a = this.data.order.attempts.find((x) => x.id === e.currentTarget.dataset.id);
    if (a && a.checkout && a.checkout.mode === 'NATIVE')
      wx.setClipboardData({ data: a.checkout.codeUrl });
  },
  async query(e) {
    const o = this.data.order;
    if (!o || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const type = e.currentTarget.dataset.type,
        id = trade.id(e.currentTarget.dataset.id);
      await trade.post('/orders/' + o.id + '/' + type + '/' + id + '/query', {});
    } catch (err) {
      this.setData({ error: ui.message(err) });
    } finally {
      this.setData({ busy: false });
      await this.load();
    }
  },
  fen() {
    if (!/^\d{1,9}$/.test(this.data.amount)) throw Error('请填写整数分，1元为100分');
    const n = Number(this.data.amount);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100000000) throw Error('金额无效');
    return n;
  },
  async refund() {
    const o = this.data.order;
    if (!o) return;
    try {
      await this.run('/orders/' + o.id + '/refunds', {
        expectedVersion: o.version,
        amountFen: this.fen(),
        reason: this.reason(),
      });
      await this.load();
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async deduction() {
    const o = this.data.order;
    if (!o) return;
    try {
      await this.run('/orders/' + o.id + '/deductions', {
        expectedVersion: o.version,
        amountFen: this.fen(),
        reason: this.reason(),
        evidenceReference: this.data.evidence,
      });
      await this.load();
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async settlement() {
    const o = this.data.order;
    if (o) {
      await this.run('/orders/' + o.id + '/settlements', { expectedVersion: o.version });
      await this.load();
    }
  },
  async review(e) {
    try {
      const o = this.data.order,
        d = e.currentTarget.dataset;
      if (o) {
        await this.run('/orders/' + o.id + '/reviews/' + d.type + '/' + trade.id(d.id), {
          expectedVersion: o.version,
          decision: d.decision,
          reason: this.reason(),
        });
        await this.load();
      }
    } catch (err) {
      this.setData({ error: ui.message(err) });
    }
  },
  async dispatch(e) {
    try {
      const o = this.data.order,
        d = e.currentTarget.dataset;
      if (o) {
        await this.run('/orders/' + o.id + '/' + d.type + '/' + trade.id(d.id) + '/' + d.action, {
          expectedVersion: o.version,
          ...(d.action === 'return' ? { reason: this.reason() } : {}),
        });
        await this.load();
      }
    } catch (err) {
      this.setData({ error: ui.message(err) });
    }
  },
  async returnQuery(e) {
    const o = this.data.order;
    if (!o) return;
    this.setData({ busy: true });
    try {
      await trade.post(
        '/orders/' +
          o.id +
          '/settlements/' +
          trade.id(e.currentTarget.dataset.id) +
          '/return-query',
        {},
      );
    } catch (err) {
      this.setData({ error: ui.message(err) });
    } finally {
      this.setData({ busy: false });
      await this.load();
    }
  },
  async recover() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await trade.recover(this.actor);
      this.setData({ message: '原操作已核对，请查看服务端资金记录。' });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    } finally {
      this.setData({ busy: false });
      await this.load();
    }
  },
  async retry() {
    if (this.data.busy) return;
    const p = this.pendingState();
    if (!p) return;
    let code;
    if (p.body.channel === 'JSAPI')
      code = await new Promise((res, rej) => wx.login({ success: (r) => res(r.code), fail: rej }));
    this.setData({ busy: true });
    try {
      await trade.retry(this.actor, code);
    } catch (e) {
      this.setData({ error: ui.message(e) });
    } finally {
      this.setData({ busy: false });
      await this.load();
    }
  },
  login() {
    ui.login('/pages/trade-order/index');
  },
});
