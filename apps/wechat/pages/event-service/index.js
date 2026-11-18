const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const schedule = require('../../utils/trial-schedule');
const drafts = require('../../utils/trial-draft');
const service = require('../../utils/event-service-client');

const ORDER_TEXT = {
  PENDING_PAYMENT: '待支付',
  PAID: '已支付',
  REFUND_PENDING: '退款中',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
};
function cell(text) {
  return { key: text, text };
}
function check(key) {
  return { key, check: true };
}
const SCALE_ROWS = [
  { id: 'quota', cells: [cell('正式赛事额度'), cell('草稿'), cell('1届'), cell('1届')] },
  { id: 'teams', cells: [cell('球队上限'), cell('16队'), cell('8队'), cell('16队')] },
  { id: 'matches', cells: [cell('比赛上限'), cell('128场'), cell('32场'), cell('128场')] },
  { id: 'publish', cells: [cell('正式发布'), cell('—'), check('std-publish'), check('pro-publish')] },
  { id: 'window', cells: [cell('激活期限'), cell('—'), cell('90天'), cell('180天')] },
];
const TOOL_ROWS = [
  { id: 'edit', cells: [cell('编排与调整'), cell('支持'), check('std-edit'), check('pro-edit')] },
  { id: 'score', cells: [cell('记分与排名'), cell('模拟体验'), check('std-score'), check('pro-score')] },
  { id: 'ops', cells: [cell('正式赛务协作'), cell('按原权限'), check('std-ops'), check('pro-ops')] },
  { id: 'public', cells: [cell('公开赛事页面'), cell('仅预览'), check('std-public'), check('pro-public')] },
];
const GUARD_ROWS = [
  { id: 'cover', cells: [cell('一次开通覆盖整届'), cell('支持'), cell('支持')] },
  { id: 'adjust', cells: [cell('调整赛程不重复扣费'), cell('支持'), cell('支持')] },
  { id: 'refund', cells: [cell('未激活可申请退款'), cell('原单核验'), cell('原单核验')] },
];

function digitsOf(fen) {
  if (!Number.isInteger(fen) || fen < 0) return '';
  const yuan = fen / 100;
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
}
function pickPlan(plans, teams, matches) {
  return (
    (plans || [])
      .filter(
        (plan) =>
          plan &&
          plan.available === true &&
          plan.currency === 'CNY' &&
          plan.maxTeams === teams &&
          plan.maxMatches === matches &&
          Number.isInteger(plan.amountFen),
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0] || null
  );
}
function cardsFrom(plans, offer) {
  const standard = pickPlan(plans, 8, 32);
  const pro = pickPlan(plans, 16, 128);
  const row = (key, title, plan, quota) => ({
    key,
    title,
    quota,
    digits: plan ? digitsOf(plan.amountFen) : '暂无可售',
    planId: plan ? plan.id : '',
    amountFen: plan ? plan.amountFen : null,
    validDays: plan ? plan.validDays : null,
    selected: key === offer,
  });
  return [
    row('standard', '标准办赛', standard, '最多8队 · 32场'),
    row('pro', '专业办赛', pro, '最多16队 · 128场'),
  ];
}
function store() {
  return {
    getItem(key) {
      const value = wx.getStorageSync(key);
      return typeof value === 'string' ? value : '';
    },
    setItem(key, value) {
      wx.setStorageSync(key, value);
    },
  };
}

Page({
  data: {
    view: 'home',
    compact: false,
    navTitle: '小城市篮球办赛服务',
    scrollHeight: 560,
    safeBottom: 0,
    designPreview: false,
    offer: 'standard',
    cards: cardsFrom([], 'standard'),
    scaleRows: SCALE_ROWS,
    toolRows: TOOL_ROWS,
    guardRows: GUARD_ROWS,
    orgId: '',
    orgName: '',
    orgs: [],
    loginRequired: false,
    loading: false,
    busy: false,
    error: '',
    notice: '试排与保存免费，正式办赛按届收费，建议99元起；实际价格以可售方案为准。',
    periodNote: '',
    teamText: '',
    datesText: '2026-11-21',
    courtsText: '1号场',
    hard: '',
    soft: '',
    trialRows: [],
    savedLabel: '',
    events: [],
    selectedEventId: '',
    orders: [],
    order: null,
    termsAccepted: false,
    purchaseNotice: '',
    canPurchase: false,
    realPaymentEnabled: false,
    reason: '',
    unknown: false,
    quoteTitle: '',
    quoteAmount: '',
    quoteLimit: '',
  },
  onLoad(query) {
    this._load = 0;
    const orgId = query && query.orgId ? api.uuid(query.orgId) : '';
    this.setData({ orgId, view: query && query.view === 'trial' ? 'trial' : 'home' });
    this.syncChrome();
  },
  onShow() {
    if (this.data.designPreview) return;
    return this.load();
  },
  onUnload() {
    this._closed = true;
    ui.close(this);
  },
  onSessionReset() {
    this._userId = '';
    this._commerce = null;
    this._membership = null;
    this.setData({
      trialRows: [],
      orders: [],
      order: null,
      events: [],
      savedLabel: '',
      periodNote: '',
      loginRequired: true,
      error: '登录身份已变化，请重新登录并读取当前资料。',
    });
  },
  syncChrome() {
    const info = wx.getSystemInfoSync();
    const width = info.windowWidth || 390;
    const height = info.windowHeight || 844;
    const header = (info.statusBarHeight || 20) + 44;
    const safe = info.safeArea ? Math.max(0, height - info.safeArea.bottom) : 0;
    const dock = this.data.view === 'home' || this.data.view === 'review' ? 168 : 0;
    this.setData({
      compact: width <= 360,
      navTitle: width < 360 ? '办赛服务' : '小城市篮球办赛服务',
      scrollHeight: Math.max(240, height - header - dock - safe),
      safeBottom: safe,
    });
  },
  async load() {
    const token = ui.begin(this);
    const generation = (this._load = (this._load || 0) + 1);
    this.setData({ loading: true, error: '' });
    const session = await ui.session(this);
    if (!ui.live(this, token) || generation !== this._load) return;
    this._userId = session && session.user ? session.user.id : '';
    const orgs = session
      ? events.organizations(session).filter((org) => ['ORG_OWNER', 'ORG_ADMIN'].includes(org.role))
      : [];
    let orgId = this.data.orgId;
    if (orgId && !orgs.some((org) => org.id === orgId)) orgId = '';
    const org = orgs.find((item) => item.id === orgId);
    this.setData({ orgs, orgId, orgName: org ? org.name : '', loginRequired: !session });
    if (!orgId) {
      this.setData({
        loading: false,
        cards: this.data.designPreview ? this.data.cards : cardsFrom([], this.data.offer),
      });
      return;
    }
    try {
      const read = await service.readWorkspace(orgId);
      if (!ui.live(this, token) || generation !== this._load || this.data.orgId !== orgId) return;
      this._commerce = read.commerce;
      this._membership = read.membership;
      this.publishRead();
      await this.recover();
    } catch (error) {
      if (!ui.live(this, token) || generation !== this._load) return;
      this.setData({
        loading: false,
        error: (error && error.message) || '方案读取失败',
        cards: cardsFrom([], this.data.offer),
      });
    }
  },
  publishRead() {
    const commerce = this._commerce || {};
    const membership = this._membership || {};
    const active = (membership.periods || []).find(
      (period) =>
        period && period.state === 'ACTIVE' && !period.revokedAt && period.remainingEvents > 0,
    );
    const orders = (commerce.orders || [])
      .filter((order) => order && order.eventId)
      .map((order) => ({
        id: order.id,
        eventName: order.eventName || '赛事订单',
        statusText: ORDER_TEXT[order.status] || '待核对',
        amount: order.quote ? '¥' + digitsOf(order.quote.amountFen) : '',
      }));
    const events = (commerce.events || [])
      .filter((event) => event && !['CANCELLED', 'COMPLETED', 'ARCHIVED'].includes(event.status))
      .map((event) => ({
        id: event.id,
        name: event.name,
        version: event.version,
        status: event.status,
      }));
    this.setData({
      loading: false,
      cards: cardsFrom(commerce.plans, this.data.offer),
      orders,
      events,
      canPurchase: commerce.mode === 'ENFORCED' && commerce.canPurchase === true,
      realPaymentEnabled: commerce.realPaymentEnabled === true,
      purchaseNotice:
        typeof membership.purchaseNotice === 'string' ? membership.purchaseNotice : '',
      periodNote: active ? '当前办赛空间已有可用周期权益，正式发布时优先使用，不必再买本届。' : '',
    });
  },
  blocked() {
    return !!(
      this.data.designPreview ||
      (this.data.__scbUiAcceptance && this.data.__scbUiAcceptance.businessDisabled)
    );
  },
  selectedCard() {
    return (
      (this.data.cards || []).find((card) => card.key === this.data.offer) || this.data.cards[0]
    );
  },
  selectOffer(e) {
    const offer = e.currentTarget.dataset.offer === 'pro' ? 'pro' : 'standard';
    const cards = (this.data.cards || []).map((card) => ({
      ...card,
      selected: card.key === offer,
    }));
    this.setData({ offer, cards });
  },
  openView(view) {
    this.setData({ view, error: '' });
    this.syncChrome();
  },
  back() {
    if (this.data.view === 'home') {
      wx.navigateBack({ fail() {} });
      return;
    }
    this.openView(this.data.view === 'order' ? 'orders' : 'home');
  },
  openTrial() {
    this.openView('trial');
  },
  loadSample() {
    this.setData({ teamText: schedule.SAMPLE.join('\n'), hard: '', soft: '' });
  },
  onTeams(e) {
    this.setData({ teamText: e.detail.value });
  },
  onDates(e) {
    this.setData({ datesText: e.detail.value });
  },
  onCourts(e) {
    this.setData({ courtsText: e.detail.value });
  },
  generate() {
    if (this.data.busy || this.blocked()) return;
    const result = schedule.planTrial({
      teams: this.data.teamText.split('\n'),
      dates: this.data.datesText.split(/[\s,，]+/),
      courts: this.data.courtsText.split(/[\s,，]+/),
    });
    this.setData({
      hard: result.hard,
      soft: result.soft,
      trialRows: result.placed.map((game) => ({
        key: game.roundNo + '-' + game.position,
        text:
          game.date + ' ' + game.time + ' ' + game.court + '  ' + game.home + ' 对 ' + game.away,
      })),
      view: 'result',
    });
    this.syncChrome();
  },
  saveCurrent() {
    if (this.blocked()) return;
    const result = drafts.saveDraft(store(), this._userId, this.data.orgId, {
      teamText: this.data.teamText,
      datesText: this.data.datesText,
      courtsText: this.data.courtsText,
      trialRows: this.data.trialRows,
      hard: this.data.hard,
      soft: this.data.soft,
    });
    this.setData(
      result.ok
        ? { savedLabel: '已保存在当前设备，不会同步到其他手机。', error: '' }
        : { error: result.message },
    );
  },
  restore() {
    let result = drafts.loadDraft(store(), this._userId, this.data.orgId);
    if (result.ok && !result.draft && this.data.orgId)
      result = drafts.loadDraft(store(), this._userId, '');
    if (!result.ok) {
      this.setData({ error: result.message });
      return;
    }
    if (!result.draft) {
      this.setData({ error: '当前设备没有这份身份的试排草稿。' });
      return;
    }
    this.setData({
      teamText: result.draft.teamText || '',
      datesText: result.draft.datesText || '',
      courtsText: result.draft.courtsText || '',
      trialRows: result.draft.trialRows || [],
      hard: result.draft.hard || '',
      soft: result.draft.soft || '',
      savedLabel: '已恢复当前设备草稿。',
      view: result.draft.trialRows && result.draft.trialRows.length ? 'result' : 'trial',
      error: '',
    });
  },
  openConvert() {
    this.saveCurrent();
    this.openView('convert');
  },
  openExisting(e) {
    if (this.blocked()) return;
    this.saveCurrent();
    ui.open(e.currentTarget.dataset.page);
  },
  openHome() {
    this.openView('home');
  },
  openSetup() {
    if (this.blocked()) return;
    if (!this.data.orgId) {
      this.setData({ error: '转正式需要已有办赛空间。当前不能自行创建机构或获得负责人权限。' });
      return;
    }
    ui.open('event-setup', { orgId: this.data.orgId });
  },
  selectEvent(e) {
    this.setData({ selectedEventId: e.currentTarget.dataset.id || '' });
  },
  openReview() {
    const card = this.selectedCard();
    const event = (this.data.events || []).find((item) => item.id === this.data.selectedEventId);
    const entitled = ((this._commerce && this._commerce.entitlements) || []).some(
      (item) =>
        item && item.eventId === this.data.selectedEventId && item.activated && !item.revokedAt,
    );
    this.setData({
      view: 'review',
      termsAccepted: false,
      unknown: false,
      quoteTitle: card.title,
      quoteAmount: card.planId ? '¥' + card.digits : '暂无可售方案',
      quoteLimit:
        card.quota + (card.validDays ? ' · 付款后 ' + card.validDays + ' 天内首次激活' : ''),
      error: entitled ? '本届已有权益，请直接进入正式发布，不要重复购买。' : this.data.periodNote,
    });
    this.syncChrome();
    if (!event)
      this.setData({
        error: (this.data.error ? this.data.error + ' ' : '') + '核对不会下单。请先选择真实赛事。',
      });
  },
  toggleTerms() {
    this.setData({ termsAccepted: !this.data.termsAccepted });
  },
  openOrders() {
    this.openView('orders');
  },
  openOrder(e) {
    const order = ((this._commerce && this._commerce.orders) || []).find(
      (item) => item.id === e.currentTarget.dataset.id,
    );
    this.setData({ view: 'order', order: order || null, unknown: false, reason: '' });
  },
  async submit() {
    if (this._submitting || this.data.busy || this.blocked()) return;
    this._submitting = true;
    try {
      const card = this.selectedCard();
      const event = (this.data.events || []).find((item) => item.id === this.data.selectedEventId);
      const openOrder = ((this._commerce && this._commerce.orders) || []).some(
        (item) =>
          item &&
          item.eventId === event?.id &&
          ['PENDING_PAYMENT', 'PAID', 'REFUND_PENDING'].includes(item.status),
      );
      const entitled = ((this._commerce && this._commerce.entitlements) || []).some(
        (item) => item && item.eventId === event?.id && !item.revokedAt,
      );
      if (openOrder || entitled || this.data.periodNote) {
        this.setData({
          error: openOrder
            ? '该届已有订单，请先核对原订单，不要重复购买。'
            : entitled
              ? '本届已有权益，请直接进入正式发布，不要重复购买。'
              : this.data.periodNote,
        });
        return;
      }
      if (
        !this.data.termsAccepted ||
        !card.planId ||
        !event ||
        !this.data.canPurchase ||
        !this.data.purchaseNotice
      ) {
        this.setData({
          error: this.data.purchaseNotice
            ? '请先勾选条款并选择真实赛事和可售方案。'
            : '尚未确认服务条款，暂不能创建订单。',
        });
        return;
      }
      const op = await ui.confirmOp(
        this,
        '确认方案',
        '将按服务器报价为当前赛事创建订单，不会在页面上改价。',
      );
      if (!op || !op.valid()) return;
      this.setData({ busy: true });
      const commandId = await ui.uuid();
      if (!op.valid()) return;
      const result = await service.createEventOrder(this.data.orgId, {
        commandId,
        eventId: event.id,
        planId: card.planId,
        expectedEventVersion: event.version,
        actorId: this._userId,
      });
      if (!op.valid()) return;
      this.setData({
        busy: false,
        unknown: result.kind === 'unknown',
        error: result.ok ? '' : (result.error && result.error.message) || '订单结果待核对',
      });
      if (result.ok) {
        this.setData({ order: result.data, view: 'order' });
        await this.reread();
      }
    } finally {
      this._submitting = false;
      if (this.data.busy) this.setData({ busy: false });
    }
  },
  async recover() {
    if (this._recovering || this.blocked() || !this.data.orgId || !this._userId) return;
    this._recovering = true;
    try {
      for (const event of this.data.events || []) {
        const result = await service.recoverEventOrder(this.data.orgId, event.id, this._userId);
        if (!result || result.skipped) continue;
        if (result.ok) {
          await this.reread();
          return;
        }
        if (result.kind === 'unknown') this.setData({ unknown: true, error: '订单结果待核对' });
      }
    } finally {
      this._recovering = false;
    }
  },
  async reread() {
    this.setData({ unknown: false });
    await this.load();
  },
  switchOrg(e) {
    const orgId = e.currentTarget.dataset.id;
    if (!orgId || orgId === this.data.orgId) return;
    this._commerce = null;
    this._membership = null;
    this.setData({ orgId, trialRows: [], orders: [], order: null, savedLabel: '', view: 'home' });
    this.load();
  },
});
