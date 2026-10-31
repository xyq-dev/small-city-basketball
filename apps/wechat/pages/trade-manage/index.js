const ui = require('../../utils/ui');
const trade = require('../trade-order/client');
Page({
  data: {
    orgId: '',
    orders: [],
    terms: [],
    busy: false,
    error: '',
    message: '',
    kind: 'LOCAL_BOOKING',
    sourceId: '',
    amount: '',
    termsText: '',
    reason: '',
    date: '',
    pending: null,
    pendingAcknowledged: false,
  },
  onLoad(q) {
    this._alive = true;
    try {
      this.orgId = q.orgId ? trade.id(q.orgId) : '';
      this.setData({
        orgId: this.orgId,
        date: ui.today(),
        ...(q.eventId ? { sourceId: trade.id(q.eventId), kind: 'ENTRY_FEE' } : {}),
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  onShow() {
    this._visible = true;
    if (this.orgId) this.load();
  },
  onHide() {
    this._visible = false;
    this.setData({
      orders: [],
      terms: [],
      pending: null,
      amount: '',
      termsText: '',
      reason: '',
      message: '',
      pendingAcknowledged: false,
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
    this.orgId = '';
    this.setData({
      orgId: '',
      sourceId: '',
      amount: '',
      termsText: '',
      reason: '',
      message: '',
      pendingAcknowledged: false,
      busy: false,
      orders: [],
      terms: [],
      pending: null,
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
          message: '仅移除本机标记，不取消原操作。',
        });
      } catch (e) {
        this.setData({ error: ui.message(e) });
      }
    }
  },
  input(e) {
    const k = e.currentTarget.dataset.field;
    if (
      ['orgId', 'sourceId', 'amount', 'termsText', 'reason', 'date'].includes(k) &&
      !this.data.busy
    )
      this.setData({ [k]: e.detail.value });
  },
  kind(e) {
    if (['LOCAL_BOOKING', 'ENTRY_FEE', 'ENTRY_DEPOSIT'].includes(e.currentTarget.dataset.kind))
      this.setData({ kind: e.currentTarget.dataset.kind });
  },
  async load() {
    if (this.data.busy || !this._alive || !this._visible) return;
    try {
      this.orgId = trade.id(this.data.orgId);
      const s = await ui.session(this, '/pages/trade-manage/index?orgId=' + this.orgId);
      if (!s) return;
      this.actor = s.user.id;
      const token = ui.begin(this);
      const [orders, terms] = await Promise.all([
        trade.read('/orders?orgId=' + this.orgId),
        trade.read('/orgs/' + this.orgId + '/terms'),
      ]);
      if (ui.live(this, token) && this._visible)
        this.setData({
          orders: orders.orders.map((x) => ({ ...x, totalText: trade.money(x.totalFen) })),
          terms: terms.terms.map((x) => ({ ...x, amountText: trade.money(x.amount_fen) })),
          pending: this.pendingState(),
          error: '',
        });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async command(path, body) {
    if (this.data.busy || !this.actor) return;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const result = await trade.execute(this.actor, path, {
        clientRequestId: await ui.uuid(),
        ...body,
      });
      if (this._alive && this._visible)
        this.setData({
          message: result.reconciliation
            ? JSON.stringify(result.reconciliation)
            : '已记录，请读取服务端最新状态。',
        });
    } catch (e) {
      if (this._alive && this._visible)
        this.setData({ error: ui.message(e), pending: this.pendingState() });
    } finally {
      this.setData({ busy: false });
      await this.load();
    }
  },
  create() {
    try {
      if (
        !/^\d{1,9}$/.test(this.data.amount) ||
        Number(this.data.amount) < 1 ||
        Number(this.data.amount) > 100000000
      )
        throw Error('费用须为整数分');
      if (String(this.data.termsText).trim().length < 4) throw Error('请填写完整收费条款');
      return this.command('/orgs/' + this.orgId + '/terms', {
        kind: this.data.kind,
        sourceId: trade.id(this.data.sourceId),
        amountFen: Number(this.data.amount),
        terms: this.data.termsText,
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  review(e) {
    if (String(this.data.reason).trim().length < 4) {
      this.setData({ error: '请填写至少4字审核理由' });
      return;
    }
    const d = e.currentTarget.dataset;
    return this.command('/orgs/' + this.orgId + '/terms/' + trade.id(d.id) + '/review', {
      expectedVersion: Number(d.version),
      decision: d.decision,
      reason: this.data.reason,
    });
  },
  reconcile() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.data.date)) {
      this.setData({ error: '账日格式须YYYY-MM-DD' });
      return;
    }
    return this.command('/orgs/' + this.orgId + '/reconcile', { date: this.data.date });
  },
  open(e) {
    wx.navigateTo({ url: '/pages/trade-order/index?id=' + trade.id(e.currentTarget.dataset.id) });
  },
  async recover() {
    this.setData({ busy: true });
    try {
      await trade.recover(this.actor);
    } catch (e) {
      this.setData({ error: ui.message(e) });
    } finally {
      this.setData({ busy: false });
      await this.load();
    }
  },
  async retry() {
    this.setData({ busy: true });
    try {
      await trade.retry(this.actor);
    } catch (e) {
      this.setData({ error: ui.message(e) });
    } finally {
      this.setData({ busy: false });
      await this.load();
    }
  },
});
