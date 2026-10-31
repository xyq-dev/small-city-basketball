const ui = require('../../utils/ui');
const ls = require('../../utils/local-services');
Page({
  data: {
    items: [],
    selected: null,
    changeSlots: [],
    newSlotId: '',
    reason: '',
    checkinDisplay: null,
    checkinInput: '',
    loading: false,
    busy: false,
    error: '',
    message: '',
    pending: null,
    pendingError: '',
    loginRequired: false,
  },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    this._visible = true;
    if (!this.data.busy) this.load();
  },
  onHide() {
    this._visible = false;
    this._checkinGeneration = (this._checkinGeneration || 0) + 1;
    this.setData({ checkinDisplay: null, checkinInput: '', busy: false });
    ui.close(this);
  },
  onUnload() {
    this._alive = false;
    this._visible = false;
    this._checkinGeneration = (this._checkinGeneration || 0) + 1;
    this.setData({ checkinDisplay: null, checkinInput: '' });
    ui.close(this);
  },
  onSessionReset() {
    this._viewer = '';
    this.setData({
      items: [],
      selected: null,
      changeSlots: [],
      newSlotId: '',
      reason: '',
      checkinDisplay: null,
      checkinInput: '',
      pending: null,
      pendingError: '',
      loading: false,
      busy: false,
      loginRequired: true,
      error: '登录身份已变化，请重新读取。',
    });
  },
  login() {
    ui.login('/pages/local-bookings/index');
  },
  async load() {
    if (this.data.busy) return;
    ui.begin(this);
    this.setData({
      loading: true,
      error: '',
      items: [],
      selected: null,
      changeSlots: [],
      newSlotId: '',
      checkinDisplay: null,
      checkinInput: '',
    });
    const session = await ui.session(this, '/pages/local-bookings/index');
    if (!this._alive || !session) return;
    this._viewer = session.user.id;
    ls.loadPending(this);
    const token = ui.begin(this);
    try {
      const items = await ls.repository().bookings();
      if (ui.live(this, token)) this.setData({ items, loading: false });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(e) });
    }
  },
  select(e) {
    if (this.data.busy) return;
    const selected = this.data.items.find((r) => r.id === e.currentTarget.dataset.id);
    if (selected)
      this.setData({
        selected: {
          ...selected,
          canRespondChange:
            !!selected.change &&
            selected.change.proposedBy !== this._viewer &&
            selected.canActAs !== 'ADMIN',
        },
        changeSlots: [],
        newSlotId: '',
        reason: '',
        checkinDisplay: null,
        checkinInput: '',
      });
  },
  input(e) {
    if (!this.data.busy) {
      const f = e.currentTarget.dataset.field === 'checkinInput' ? 'checkinInput' : 'reason';
      this.setData({ [f]: e.detail.value });
    }
  },
  async choices() {
    const row = this.data.selected;
    if (!row || !row.canChange || this.data.busy) return;
    const token = ui.begin(this);
    try {
      const detail = await ls.repository().detail(row.listingId);
      if (ui.live(this, token) && this.data.selected && this.data.selected.id === row.id)
        this.setData({
          changeSlots: detail.slots.filter((s) => s.available && s.id !== row.slotId),
          newSlotId: '',
        });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ error: ui.message(e) });
    }
  },
  chooseSlot(e) {
    if (!this.data.busy) this.setData({ newSlotId: e.currentTarget.dataset.id });
  },
  async command(e) {
    const row = this.data.selected;
    if (!row) return;
    try {
      const type = e.currentTarget.dataset.type,
        body = {
          expectedVersion: row.version,
          type,
          reason: ls.text(this.data.reason, '履约或改期说明', 4, 500),
        };
      if (type === 'REDEEM_CHECKIN') body.checkinCode = ls.checkinCode(this.data.checkinInput);
      if (type === 'PROPOSE_CHANGE') {
        if (!this.data.changeSlots.some((s) => s.id === this.data.newSlotId))
          throw new Error('请先选择一个新的有效档期。');
        body.newSlotId = this.data.newSlotId;
      }
      const names = {
        CONFIRM: '确认球场预约',
        ACCEPT: '接单',
        DECLINE: '拒绝订单',
        CANCEL: '取消预约',
        ARRIVE: '本人登记到场',
        REDEEM_CHECKIN: '核销球场到场',
        DELIVER: '登记交付',
        COMPLETE: '确认服务完成',
        DISPUTE: '提出履约争议',
        PROPOSE_CHANGE: '提出改期',
        ACCEPT_CHANGE: '确认对方改期',
        REJECT_CHANGE: '拒绝对方改期',
      };
      const result = await ls.write(this, {
        path: '/v1/local-bookings/' + row.id + '/commands',
        body,
        label: names[type],
        content:
          row.title +
          '，' +
          row.timeText +
          '，' +
          row.address +
          '。' +
          (type === 'ACCEPT_CHANGE'
            ? '确认后将同一事务释放旧档期并占用新档期，冲突时保持原档期。'
            : type === 'PROPOSE_CHANGE'
              ? '改期需要另一方重新确认，在此之前保留原档期。'
              : type === 'CANCEL'
                ? '取消会释放未履约占用，并取消关联球队约赛。'
                : '请按真实履约事实操作。'),
      });
      if (result) await this.load();
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async issueCheckin() {
    const row = this.data.selected,
      generation = this._checkinGeneration || 0,
      actor = this._viewer;
    if (!row || !row.canIssueCheckin) return;
    try {
      const value = await ls.write(this, {
        path: '/v1/local-bookings/' + row.id + '/checkin',
        body: { expectedVersion: row.version },
        label: '生成或换发现场核销码',
        content:
          row.title +
          '，' +
          row.timeText +
          '。仅在现场临近服务时段生成；换发会立即作废旧码。请当面向实际经营方出示，码只在本页显示一次，离开即清除。',
      });
      if (!value) return;
      await this.load();
      if (
        !this._alive ||
        !this._visible ||
        generation !== (this._checkinGeneration || 0) ||
        actor !== this._viewer
      )
        return;
      this.select({ currentTarget: { dataset: { id: row.id } } });
      this.setData({
        checkinDisplay: value.checkin
          ? { ...value.checkin, expiresText: ui.localTime(value.checkin.expiresAt, true) }
          : null,
        message: value.checkin
          ? '现场核销码已生成，请当面出示给实际经营方。'
          : '原签发已确认。出于安全原码不再显示；如确需使用，可明确换发新码使旧码失效。',
      });
    } catch (e) {
      if (this._alive) this.setData({ error: ui.message(e) });
    }
  },
  copyCheckin() {
    const c = this.data.checkinDisplay;
    if (c && typeof wx.setClipboardData === 'function') wx.setClipboardData({ data: c.code });
  },
  governance(e) {
    const row = this.data.selected,
      review = e.currentTarget.dataset.kind === 'review';
    if (
      this.data.busy ||
      !row ||
      row.canActAs === 'ADMIN' ||
      !this.data.items.some((v) => v.id === row.id) ||
      (review && row.status !== 'COMPLETED')
    )
      return;
    ui.open(review ? 'governance-reviews' : 'governance', {
      sourceKind: 'LOCAL_BOOKING',
      sourceId: ls.id(row.id),
    });
  },
  navigate() {
    const r = this.data.selected;
    if (r) ls.navigate(r.location, r.address, r.title);
  },
  find() {
    ls.open('local');
  },
  matchups() {
    ls.open('local-matchups');
  },
  recover() {
    return ls.recover(this);
  },
  async retry() {
    const pending = this.data.pending,
      generation = this._checkinGeneration || 0,
      actor = this._viewer;
    const value = await ls.retry(this);
    if (value && pending && /\/checkin$/.test(pending.path)) {
      await this.load();
      if (
        this._alive &&
        this._visible &&
        generation === (this._checkinGeneration || 0) &&
        actor === this._viewer
      ) {
        this.select({ currentTarget: { dataset: { id: value.resourceId } } });
        this.setData({
          checkinDisplay: value.checkin
            ? { ...value.checkin, expiresText: ui.localTime(value.checkin.expiresAt, true) }
            : null,
          message: value.checkin
            ? '原签发请求现已确认，请当面出示本次核销码。'
            : '原签发已确认，原码出于安全不能重显；如确需使用请明确换发。',
        });
      }
    } else if (value) {
      this.setData({ checkinInput: '' });
      await this.load();
    }
    return value;
  },
});
