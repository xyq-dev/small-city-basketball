const ui = require('../../utils/ui');
const sdk = require('../../utils/booking');
Page({
  data: {
    loading: false,
    busy: false,
    loginRequired: false,
    error: '',
    allowed: false,
    reviewQueue: [],
    orders: [],
    feePercent: '',
    feeDirty: false,
    reviewOpen: false,
    reviewId: '',
    reviewName: '',
    reviewVersion: 0,
    reviewSnapshot: null,
    reviewStatus: 'APPROVED',
    reviewReason: '',
    statuses: ['资料审核通过', '需要修改', '停用'],
    statusIndex: 0,
    consent: false,
    paymentNotice: '',
  },
  onShow() {
    if (!this.data.reviewOpen && !this.data.feeDirty) this.load();
  },
  onUnload() {
    ui.close(this);
    this.raw = null;
  },
  login() {
    ui.login('/pages/platform/index');
  },
  async load() {
    if (this.data.reviewOpen || this.data.feeDirty) {
      this.setData({ error: '先保存或关闭当前编辑，再刷新。' });
      return;
    }
    this.raw = null;
    this.loadedToken = null;
    this.setData({ loading: true, allowed: false, reviewQueue: [], orders: [], error: '' });
    const session = await ui.session(this, '/pages/platform/index');
    if (!session) return;
    const token = ui.begin(this);
    try {
      const value = await sdk.workspace();
      if (!ui.live(this, token)) return;
      if (!value.isPlatformOperator) throw new Error('当前账号没有平台运营权限');
      this.raw = value;
      this.loadedToken = token;
      this.setData({
        allowed: true,
        reviewQueue: value.reviewQueue.map((p) => ({
          ...p,
          stateLabel: ui.state(p.status),
          price: ui.money(p.priceFen),
          positionLabel: ui.position(p.position),
        })),
        orders: value.orders.map((o) => ({
          id: o.id,
          eventName: o.eventName,
          teamName: o.teamName,
          total: ui.money(o.totals.confirmedTotalFen),
          disputed: o.appearances.some((a) => a.capabilities.canResolveDispute),
        })),
        feePercent: (value.settings.feeBps / 100).toFixed(2),
        paymentNotice: value.paymentNotice,
      });
    } catch (error) {
      if (ui.live(this, token))
        this.setData({ error: ui.message(error), allowed: false, reviewQueue: [], orders: [] });
    } finally {
      if (ui.live(this, token)) this.setData({ loading: false });
    }
  },
  feeInput(e) {
    if (ui.live(this, this.loadedToken))
      this.setData({ feePercent: e.detail.value, feeDirty: true, error: '' });
  },
  async saveFee() {
    if (this.data.busy || !ui.live(this, this.loadedToken) || !this.raw) return;
    const value = this.data.feePercent;
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(value)) {
      this.setData({ error: '请填写0–99.99的百分比，最多2位小数' });
      return;
    }
    const pair = value.split('.'),
      bps = Number(pair[0]) * 100 + Number((pair[1] || '').padEnd(2, '0'));
    const token = this.loadedToken;
    this.setData({ busy: true, error: '' });
    try {
      if (
        !(await ui.confirm(
          '更新新预约的平台费率',
          '新费率只影响后续新建预约，已有订单保留原快照。',
        )) ||
        !ui.live(this, token)
      )
        return;
      const commandId = await ui.uuid();
      if (!ui.live(this, token)) return;
      await sdk.updateFee(this.raw.settings.version, bps, commandId);
      if (!ui.live(this, token)) return;
      this.setData({ feeDirty: false, busy: false });
      await this.load();
    } catch (error) {
      if (ui.live(this, token)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.live(this, token)) this.setData({ busy: false });
    }
  },
  discardFee() {
    if (!this.data.busy && this.raw && ui.live(this, this.loadedToken))
      this.setData({
        feePercent: (this.raw.settings.feeBps / 100).toFixed(2),
        feeDirty: false,
        error: '',
      });
  },
  review(e) {
    if (!ui.live(this, this.loadedToken) || !this.raw) return;
    const p = this.raw.reviewQueue.find((v) => v.id === e.currentTarget.dataset.id);
    if (p)
      this.setData({
        reviewOpen: true,
        reviewId: p.id,
        reviewName: p.displayName,
        reviewVersion: p.version,
        reviewSnapshot: {
          city: p.city,
          height: p.heightCm,
          bio: p.bio,
          price: ui.money(p.priceFen),
          travel: ui.money(p.travelFen),
          accommodation: ui.money(p.accommodationFen),
          availability: p.availability.map(
            (w) => ui.localTime(w.startAt, true) + ' — ' + ui.localTime(w.endAt, true),
          ),
        },
        statusIndex: 0,
        reviewReason: '',
        consent: false,
        error: '',
      });
  },
  reason(e) {
    this.setData({ reviewReason: e.detail.value });
  },
  status(e) {
    const index = Number(e.detail.value);
    if ([0, 1, 2].includes(index)) this.setData({ statusIndex: index, consent: false });
  },
  agree(e) {
    this.setData({ consent: e.detail.value.includes('yes') });
  },
  closeReview() {
    if (!this.data.busy)
      this.setData({ reviewOpen: false, reviewId: '', reviewReason: '', consent: false });
  },
  async submitReview() {
    if (
      this.data.busy ||
      !this.data.consent ||
      !ui.live(this, this.loadedToken) ||
      this.data.reviewReason.trim().length < 2
    )
      return;
    const token = this.loadedToken,
      id = this.data.reviewId,
      reason = this.data.reviewReason.trim(),
      status = ['APPROVED', 'REJECTED', 'DISABLED'][this.data.statusIndex];
    this.setData({ busy: true, error: '' });
    try {
      const current = await sdk.workspace();
      if (!ui.live(this, token)) return;
      const profile = current.reviewQueue.find((p) => p.id === id);
      if (!current.isPlatformOperator || !profile)
        throw new Error('当前审核对象或权限已变化，请关闭后刷新');
      if (profile.version !== this.data.reviewVersion) {
        this.setData({
          consent: false,
          error: '球员资料已更新，请关闭本次处理并刷新，重新核对新资料后再同意。',
        });
        return;
      }
      const commandId = await ui.uuid();
      if (!ui.live(this, token)) return;
      await sdk.reviewProfile(id, profile.version, status, reason, commandId);
      if (!ui.live(this, token)) return;
      this.setData({
        reviewOpen: false,
        reviewId: '',
        reviewReason: '',
        consent: false,
        busy: false,
      });
      await this.load();
    } catch (error) {
      if (ui.live(this, token)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.live(this, token)) this.setData({ busy: false });
    }
  },
  order(e) {
    if (ui.live(this, this.loadedToken))
      ui.open('booking-detail', { id: e.currentTarget.dataset.id });
  },
});
