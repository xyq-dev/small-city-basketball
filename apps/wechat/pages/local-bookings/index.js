const ui = require('../../utils/ui');
const ls = require('../../utils/local-services');
Page({
  data: {
    items: [],
    selected: null,
    changeSlots: [],
    newSlotId: '',
    reason: '',
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
    if (!this.data.busy) this.load();
  },
  onUnload() {
    this._alive = false;
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
      });
  },
  input(e) {
    if (!this.data.busy) this.setData({ reason: e.detail.value });
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
        ARRIVE: '登记到场',
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
  retry() {
    return ls.retry(this);
  },
});
