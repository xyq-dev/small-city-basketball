const api = require('../../utils/api');
const ui = require('../../utils/ui');
const model = require('../../utils/sponsor-commerce');
const client = require('../../utils/sponsor-commerce-client');
const PATH = '/pages/sponsor-commerce/index';
function summarizeContractOrder(contracts, orders) {
  const contract = contracts[0];
  if (!contract) return { paymentLabel: '待合同建立', poolLabel: '待核对' };
  const order = orders.find((item) => (item.contract_id || item.contractId) === contract.id);
  if (!order) return { paymentLabel: '尚未建立订单', poolLabel: '待核对' };
  const paid = Number.isSafeInteger(order.paid_fen) ? order.paid_fen : order.paidFen;
  const refunded = Number.isSafeInteger(order.refunded_fen)
    ? order.refunded_fen
    : Number.isSafeInteger(order.refundedFen)
      ? order.refundedFen
      : 0;
  const fee = Number.isSafeInteger(order.verified_fee_fen)
    ? order.verified_fee_fen
    : order.verifiedFeeFen;
  return {
    paymentLabel: order.stateLabel,
    poolLabel:
      Number.isSafeInteger(paid) && paid > 0 && Number.isSafeInteger(fee)
        ? '¥' + model.money(Math.max(0, paid - refunded - fee))
        : '待实收与手续费核验',
  };
}
Page({
  data: {
    organizations: [],
    orgIndex: 0,
    contracts: [],
    orders: [],
    beneficiaries: [],
    receiverOptions: [],
    campaignOptions: [],
    campaignIndex: 0,
    detail: null,
    statements: [],
    busy: false,
    loading: false,
    error: '',
    notice: '',
    pending: null,
    enabled: false,
    canManage: false,
    canFinance: false,
    title: '',
    payerEmail: '',
    total: '',
    fee: '0',
    terms: '',
    shares: [],
    evidence: '',
    reason: '',
    amount: '',
    mode: 'manage',
    workspaceView: 'contracts',
    detailView: 'delivery',
    contractOverview: { paymentLabel: '待核对', poolLabel: '待核对' },
    figmaCommercePreview: false,
    figmaState: '',
    figmaSummaryTitle: '',
  },
  onLoad(q = {}) {
    this._alive = true;
    this._visible = true;
    try {
      if (q.orgId) this._org = model.id(q.orgId);
      if (q.orderId) this._order = model.id(q.orderId);
      if (q.mode === 'statements') this.setData({ mode: 'statements' });
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
    this.setData({
      detail: null,
      contracts: [],
      orders: [],
      beneficiaries: [],
      statements: [],
      busy: false,
      contractOverview: { paymentLabel: '待核对', poolLabel: '待核对' },
    });
  },
  onUnload() {
    this._alive = false;
    this.onHide();
  },
  onSessionReset() {
    this._viewer = '';
    this._org = null;
    this._order = null;
    this.setData({
      organizations: [],
      orgIndex: 0,
      contracts: [],
      orders: [],
      beneficiaries: [],
      receiverOptions: [],
      campaignOptions: [],
      campaignIndex: 0,
      detail: null,
      statements: [],
      shares: [],
      enabled: false,
      canManage: false,
      canFinance: false,
      canAdvance: false,
      userId: null,
      title: '',
      payerEmail: '',
      total: '',
      fee: '0',
      terms: '',
      evidence: '',
      reason: '',
      amount: '',
      mode: 'manage',
      workspaceView: 'contracts',
      detailView: 'delivery',
      contractOverview: { paymentLabel: '待核对', poolLabel: '待核对' },
      pending: null,
      busy: false,
      loading: false,
      error: '登录身份已变化，请重新读取本人合同。',
      notice: '',
    });
  },
  workspace(e) {
    if (this.data.busy || this.data.pending || this.data.loading) return;
    const key = e.currentTarget.dataset.key;
    if (!['contracts', 'orders', 'setup'].includes(key)) return;
    if (key === 'setup' && !this.data.canManage && !this.data.canFinance) return;
    ui.begin(this);
    this._order = null;
    const reload = this.data.mode === 'statements';
    this.setData({ workspaceView: key, mode: 'manage', detail: null, statements: [] });
    if (reload) this.load();
  },
  detailTab(e) {
    if (this.data.busy || !this.data.detail) return;
    const key = e.currentTarget.dataset.key;
    if (['delivery', 'settlement', 'refunds'].includes(key)) this.setData({ detailView: key });
  },
  closeOrder() {
    if (this.data.busy) return;
    ui.begin(this);
    this._order = null;
    this.setData({
      detail: null,
      workspaceView: 'orders',
      detailView: 'delivery',
      loading: false,
      evidence: '',
      reason: '',
      amount: '',
    });
  },
  base() {
    return '/v1/orgs/' + model.id(this._org) + '/sponsor-commerce';
  },
  async load() {
    if (!this._alive || !this._visible || this._invalid || this.data.busy) return;
    const token = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      const returnPath = PATH + (this._org ? '?orgId=' + model.id(this._org) : '');
      const session = await ui.session(this, returnPath);
      if (!session || !ui.live(this, token)) return;
      if (this._viewer && this._viewer !== session.user.id) {
        this.onSessionReset();
      }
      this._viewer = session.user.id;
      const managed = (session.organizations || []).filter((o) =>
        ['ORG_OWNER', 'ORG_ADMIN'].includes(o.role),
      );
      const inbox =
        this.data.mode === 'statements'
          ? { organizations: [] }
          : (await api.getClient().request('/v1/me/sponsor-commerce')).data;
      if (!ui.live(this, token)) return;
      if (!inbox || !Array.isArray(inbox.organizations)) throw Error('本人合同入口资料无效');
      const organizations = [
        ...new Map(
          [
            ...managed,
            ...inbox.organizations.map((o) => ({
              id: model.id(o.id),
              name: String(o.name),
              role: 'ADVERTISER',
            })),
          ].map((o) => [o.id, o]),
        ).values(),
      ];
      if (this._org && !organizations.some((o) => o.id === this._org))
        throw Error('当前账号没有此机构的合同或管理权限');
      if (!this._org) this._org = organizations[this.data.orgIndex]?.id;
      if (!this._org) {
        this.setData({
          organizations: [],
          loading: false,
          notice: '暂无分配给当前账号的广告合同。合作方建立合同后，可在此签署和付款。',
          contracts: [],
          orders: [],
          canManage: false,
          canFinance: false,
          contractOverview: { paymentLabel: '待合同建立', poolLabel: '待核对' },
        });
        return;
      }
      this.setData({
        organizations,
        orgIndex: Math.max(
          0,
          organizations.findIndex((x) => x.id === this._org),
        ),
        pending: client.pending(this._org),
      });
      if (this.data.mode === 'statements') {
        const v = (await api.getClient().request(this.base() + '/statements')).data;
        if (ui.live(this, token))
          this.setData({ statements: model.decorate(v.items), loading: false });
        return;
      }
      const data = (await api.getClient().request(this.base())).data;
      if (!ui.live(this, token)) return;
      const contracts = model.decorate(data.contracts);
      const orders = model.decorate(data.orders);
      this.setData({
        ...data,
        error: '',
        contracts,
        orders,
        contractOverview: summarizeContractOrder(contracts, orders),
        beneficiaries: model.decorate(data.beneficiaries),
        shares: (data.receiverOptions || []).map((x) => ({ ...x, bps: '' })),
        loading: false,
      });
      if (this._order) await this.openOrder(this._order, token);
    } catch (e) {
      if (ui.live(this, token)) this.setData({ error: ui.message(e), loading: false });
    }
  },
  input(e) {
    const field = e.currentTarget.dataset.field;
    if (
      ['title', 'payerEmail', 'total', 'fee', 'terms', 'evidence', 'reason', 'amount'].includes(
        field,
      )
    )
      this.setData({ [field]: e.detail.value });
  },
  shareInput(e) {
    const n = Number(e.currentTarget.dataset.index);
    if (Number.isInteger(n) && this.data.shares[n])
      this.setData({ ['shares[' + n + '].bps']: e.detail.value });
  },
  chooseCampaign(e) {
    this.setData({ campaignIndex: Number(e.detail.value) });
  },
  chooseMode(e) {
    if (this.data.busy || this.data.pending) return;
    const mode = e.currentTarget.dataset.mode;
    if (!['manage', 'statements'].includes(mode)) return;
    if (mode === 'statements' && !this.data.canManage) return;
    this._order = null;
    this.setData({ mode, detail: null, statements: [] });
    this.load();
  },
  chooseOrg(e) {
    if (this.data.pending) return;
    const n = Number(e.detail.value),
      org = this.data.organizations[n];
    if (!org) return;
    this._org = org.id;
    this._order = null;
    this.setData({ orgIndex: n, detail: null });
    this.load();
  },
  async perform(path, body) {
    if (this.data.busy || this.data.pending || !this._visible || !this._alive) return;
    const token = ui.begin(this);
    this.setData({ busy: true, error: '', notice: '' });
    try {
      body.commandId = await ui.uuid();
      if (!ui.live(this, token)) return;
      await client.send(this._org, path, body);
      if (ui.live(this, token)) this.setData({ notice: '操作已记录，请以最新审核和渠道状态为准' });
    } catch (e) {
      if (ui.live(this, token))
        this.setData({ error: ui.message(e), pending: client.pending(this._org) });
    } finally {
      if (ui.live(this, token)) {
        this.setData({ busy: false });
        this.load();
      }
    }
  },
  async createContract() {
    try {
      const campaign = this.data.campaignOptions[this.data.campaignIndex];
      if (!campaign) throw Error('请先建立广告投放记录');
      const shares = this.data.shares
        .filter((x) => x.bps !== '')
        .map((x) => {
          if (!/^\d+$/.test(x.bps) || Number(x.bps) < 1 || Number(x.bps) > 10000)
            throw Error('比例请输入1–10000之间的整数基点');
          return { beneficiaryOrgId: x.beneficiaryOrgId, basisPoints: Number(x.bps) };
        });
      const sum = shares.reduce((n, x) => n + x.basisPoints, 0);
      if (sum > 10000) throw Error('分成比例不能超过100%');
      if (sum < 10000) shares.unshift({ beneficiaryOrgId: this._org, basisPoints: 10000 - sum });
      await this.perform(this.base() + '/contracts', {
        campaignId: campaign.id,
        payerEmail: this.data.payerEmail,
        title: this.data.title,
        totalFen: model.fen(this.data.total),
        allowedFeeFen: model.fen(this.data.fee),
        terms: this.data.terms,
        startsAt: campaign.starts_at,
        endsAt: campaign.ends_at,
        shares,
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  contractAction(e) {
    const r = this.data.contracts.find((x) => x.id === e.currentTarget.dataset.id);
    if (!r) return;
    const action = e.currentTarget.dataset.action;
    if (action === 'ORDER')
      return this.perform(this.base() + '/orders', {
        contractId: r.id,
        chargeConsent: true,
        expectedVersion: r.version,
        acceptedContractHash: r.contractHash,
      });
    return this.perform(this.base() + '/contracts/' + r.id + '/commands', {
      expectedVersion: r.version,
      action,
      ...(action === 'ADVERTISER_SIGN' ? { acceptedContractHash: r.contractHash } : {}),
    });
  },
  beneficiaryAction(e) {
    const action = e.currentTarget.dataset.action,
      id = e.currentTarget.dataset.id;
    const r = this.data.beneficiaries.find((x) => x.id === id);
    return this.perform(
      this.base() + '/beneficiaries',
      action === 'PROPOSE'
        ? { action, beneficiaryOrgId: id, evidence: this.data.evidence }
        : { action, id, expectedVersion: r?.version },
    );
  },
  async selectOrder(e) {
    if (this.data.busy || !this._visible) return;
    this._order = model.id(e.currentTarget.dataset.id);
    this.setData({ detailView: 'delivery', evidence: '', reason: '', amount: '' });
    const token = ui.begin(this);
    try {
      await this.openOrder(this._order, token);
    } catch (err) {
      if (ui.live(this, token)) this.setData({ error: ui.message(err) });
    }
  },
  async openOrder(id, token) {
    const v = (await api.getClient().request(this.base() + '/orders/' + model.id(id))).data;
    if (!ui.live(this, token)) return;
    this.setData({
      detail: {
        ...v,
        order: {
          ...v.order,
          stateLabel: model.label(v.order.status),
          amountText: model.money(v.order.total_fen),
        },
        deliveries: model.decorate(v.deliveries),
        batches: model.decorate(v.batches).map((b) => ({ ...b, items: model.decorate(b.items) })),
        items: model.decorate(v.items),
        refunds: model.decorate(v.refunds).map((p) => ({
          ...p,
          needsUnfreeze: !!p.batch_id && !v.batches.some((b) => b.id === p.batch_id && b.finished),
        })),
        refundRetries: model.decorate(v.refundRetries),
        returns: model.decorate(v.returns),
        recovery: model.decorate(v.recovery),
      },
    });
  },
  orderAction(e) {
    const d = this.data.detail;
    if (!d) return;
    const action = e.currentTarget.dataset.action,
      childId = e.currentTarget.dataset.id;
    const body = { action, expectedVersion: d.order.version };
    if (childId) body.childId = childId;
    if (
      ['DELIVERY', 'VERIFY_FEE', 'RECOVERY_PROPOSE', 'PROPOSE_RETRY', 'ADVANCE_PROPOSE'].includes(
        action,
      )
    )
      body.evidence = this.data.evidence;
    if (['DISPUTE', 'PROPOSE_REFUND', 'ACCEPT'].includes(action)) body.reason = this.data.reason;
    try {
      if (['VERIFY_FEE', 'PROPOSE_REFUND'].includes(action))
        body.amountFen = model.fen(this.data.amount);
      if (action === 'RECOVERY_APPROVE') body.outcome = e.currentTarget.dataset.outcome;
      return this.perform(
        this.base() +
          '/orders/' +
          d.order.id +
          '/' +
          (e.currentTarget.dataset.channel ? 'channel' : 'commands'),
        body,
      );
    } catch (err) {
      this.setData({ error: ui.message(err) });
    }
  },
  pay() {
    const d = this.data.detail;
    if (!d) return;
    ui.open('trade-order', { kind: 'SPONSOR_ORDER', sourceId: d.order.id });
  },
  openTradeManage() {
    if (this.data.busy || !this._org || (!this.data.canManage && !this.data.canFinance)) return;
    ui.open('trade-manage', { orgId: this._org });
  },
  async resolve(e) {
    if (this.data.busy) return;
    const token = ui.begin(this);
    this.setData({ busy: true, error: '' });
    try {
      const v = await client.resolve(this._org, e.currentTarget.dataset.cancel === 'yes');
      if (ui.live(this, token))
        this.setData({
          notice: v?.found
            ? '原操作已核对，请查看最新结果'
            : '尚无已提交回执，可继续查询或取消尚未提交的请求',
          pending: client.pending(this._org),
        });
    } catch (err) {
      if (ui.live(this, token)) this.setData({ error: ui.message(err) });
    } finally {
      if (ui.live(this, token)) {
        this.setData({ busy: false });
        this.load();
      }
    }
  },
});
