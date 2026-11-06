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
    approvedRefundRejectId: '',
    amount: '',
    reason: '',
    evidence: '',
    noCharge: false,
    loginRequired: false,
    figmaState: '',
    activeSection: 'summary',
    workflowSteps: [
      { key: 'summary', label: '费用' },
      { key: 'payments', label: '支付' },
      { key: 'resolution', label: '退款' },
    ],
  },
  onLoad(q) {
    this._alive = true;
    try {
      this.id = q.id ? trade.id(q.id) : '';
      this.kind = q.kind || '';
      if (
        q.sourceId &&
        ![
          'ENTRY_FEE',
          'ENTRY_DEPOSIT',
          'LOCAL_BOOKING',
          'PLAYER_APPEARANCE',
          'TRAINING_ENROLLMENT',
          'SPONSOR_ORDER',
        ].includes(this.kind)
      )
        throw Error('资金来源类型无效');
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
      approvedRefundRejectId: '',
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
    this.setData({ approvedRefundRejectId: '' });
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
      approvedRefundRejectId: '',
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
  changeSection(e) {
    const key = e.detail.key;
    if (this.data.busy || !this.data.workflowSteps.some((item) => item.key === key)) return;
    this.setData({ activeSection: key });
    if (typeof wx.pageScrollTo === 'function')
      wx.pageScrollTo({ selector: '#funds-' + key, duration: 200 });
  },
  fundingProgress() {
    this.changeSection({ detail: { key: 'resolution' } });
  },
  queryLatestPayment() {
    if (this.data.busy || this.data.loading) return;
    const attempts = this.data.order?.attempts || [];
    const attempt = attempts[0];
    if (!attempt) {
      this.changeSection({ detail: { key: 'payments' } });
      return;
    }
    return this.query({
      currentTarget: { dataset: { type: 'payments', id: attempt.id } },
    });
  },
  input(e) {
    if (!this.data.busy && ['amount', 'reason', 'evidence'].includes(e.currentTarget.dataset.field))
      this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  consent(e) {
    this.setData({ consent: (e.detail.value || []).includes('yes') });
  },
  approvedRefundRejectConsent(e) {
    if (this.data.busy || this.data.loading) return;
    const o = this.data.order,
      id = e.currentTarget.dataset.id,
      refund = o && o.refunds.find((x) => x.id === id);
    if (
      !o ||
      o.capabilities.canManage !== true ||
      refund?.status !== 'APPROVED' ||
      refund.canRejectApprovedRefund !== true
    )
      return;
    this.setData({ approvedRefundRejectId: (e.detail.value || []).includes('yes') ? id : '' });
  },
  async load() {
    if (!this._alive || !this._visible || this.data.busy) return;
    const token = ui.begin(this);
    this.setData({ loading: true, error: '', order: null, approvedRefundRejectId: '' });
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
  async run(path, body, code, beforeSend) {
    if (this.data.busy || !this.actor) return;
    if (
      this.data.order?.balanceConflict &&
      !(
        body.decision === 'REJECT' &&
        /^\/orders\/[a-f0-9-]{36}\/reviews\/REFUND\/[a-f0-9-]{36}$/i.test(path)
      )
    ) {
      this.setData({ error: '资金占用冲突待核对，当前仅可查询原编号或撤回允许的退款' });
      return;
    }
    this.setData({ busy: true, error: '', message: '' });
    try {
      const id = await ui.uuid();
      if (beforeSend && !beforeSend()) throw Error('退款记录或身份已变化，请重新读取并确认撤回');
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
    if (!o || o.balanceConflict || !this.data.consent) return;
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
    if (!c || c.mode !== 'JSAPI' || this.data.busy || o.balanceConflict) return;
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
    if (this.data.order?.balanceConflict) return;
    const a = this.data.order.attempts.find((x) => x.id === e.currentTarget.dataset.id);
    if (a && a.checkout && a.checkout.mode === 'NATIVE')
      wx.setClipboardData({ data: a.checkout.codeUrl });
  },
  queryCurrent() {
    const attempt = this.data.order && (this.data.order.attempts || [])[0];
    if (!attempt || this.data.busy) return;
    return this.query({ currentTarget: { dataset: { type: 'payments', id: attempt.id } } });
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
        if (o.balanceConflict && !(d.type === 'REFUND' && d.decision === 'REJECT'))
          throw Error('资金占用冲突待核对，当前仅可查询或拒绝允许撤回的退款');
        let beforeSend;
        if (d.type === 'REFUND') {
          const refund = o.refunds.find((x) => x.id === d.id);
          if (o.capabilities.canManage !== true || !refund) throw Error('当前没有退款审核权限');
          if (refund.status !== 'PENDING_REVIEW') {
            if (
              refund.status !== 'APPROVED' ||
              d.decision !== 'REJECT' ||
              refund.canRejectApprovedRefund !== true
            )
              throw Error('此退款不能撤回，请查询原退款结果');
            if (this.data.approvedRefundRejectId !== refund.id)
              throw Error('请单独勾选确认撤回这一笔尚未发送的退款后继');
            const actor = this.actor;
            beforeSend = () => {
              const current = this.data.order,
                row = current?.refunds.find((x) => x.id === refund.id);
              return (
                this._alive &&
                this._visible &&
                this.actor === actor &&
                current?.id === o.id &&
                current.version === o.version &&
                current.capabilities.canManage === true &&
                row?.status === 'APPROVED' &&
                row.canRejectApprovedRefund === true &&
                this.data.approvedRefundRejectId === refund.id
              );
            };
          }
        }
        await this.run(
          '/orders/' + o.id + '/reviews/' + d.type + '/' + trade.id(d.id),
          {
            expectedVersion: o.version,
            decision: d.decision,
            reason: this.reason(),
          },
          undefined,
          beforeSend,
        );
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
    if (this.data.order?.balanceConflict) {
      this.setData({ error: '资金占用冲突时请查询原操作回执，暂不能重试资金执行' });
      return;
    }
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
