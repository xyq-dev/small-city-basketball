const ui = require('../../utils/ui');
const sdk = require('../../utils/booking');
const orders = require('../../utils/booking-orders');
const STATUS_VALUES = [
  'ALL',
  'REQUESTED',
  'ACCEPTED',
  'CONDITIONAL',
  'ARRIVED',
  'COMPLETED',
  'DISPUTED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
];
Page({
  data: {
    view: 'sent',
    status: 'ALL',
    statusIndex: 0,
    statusLabels: [
      '全部状态',
      '待接单',
      '已接单',
      '条件意向',
      '已到场',
      '已完成',
      '争议中',
      '已拒绝',
      '已取消',
      '已到期',
    ],
    rows: [],
    loading: false,
    loginRequired: false,
    error: '',
    hasMore: false,
    paymentNotice: '',
  },
  onLoad(query) {
    this.setData({ view: query && query.view === 'received' ? 'received' : 'sent' });
  },
  onShow() {
    this.hidden = false;
    this.visit = (this.visit || 0) + 1;
    this.load();
  },
  onHide() {
    this.hidden = true;
    this.visit = (this.visit || 0) + 1;
    this.raw = null;
    this.viewer = null;
    this.loadedToken = null;
    this.setData({ rows: [], loading: false, paymentNotice: '', hasMore: false });
  },
  onUnload() {
    this.hidden = true;
    this.raw = null;
    this.viewer = null;
    this.loadedToken = null;
    ui.close(this);
  },
  async load() {
    const visit = this.visit;
    const request = (this.request = (this.request || 0) + 1);
    this.raw = null;
    this.viewer = null;
    this.loadedToken = null;
    this.setData({
      rows: [],
      loading: true,
      loginRequired: false,
      error: '',
      paymentNotice: '',
      hasMore: false,
    });
    let token;
    try {
      const session = await ui.session(this, '/pages/bookings/index?view=' + this.data.view);
      if (!session || this.hidden || this.visit !== visit || this.request !== request) return;
      token = ui.begin(this);
      const workspace = await sdk.workspace();
      if (this.hidden || this.visit !== visit || this.request !== request || !ui.live(this, token))
        return;
      if (workspace.viewerUserId !== session.user.id)
        throw new Error('当前账号已变化，请重新读取预约');
      this.raw = workspace;
      this.viewer = session.user.id;
      this.loadedToken = token;
      this.setData({
        loading: false,
        hasMore: workspace.ordersHasMore === true,
        paymentNotice: workspace.paymentNotice || '',
      });
      this.render();
    } catch (error) {
      if (
        !this.hidden &&
        this.visit === visit &&
        this.request === request &&
        (!token || ui.live(this, token))
      )
        this.setData({ rows: [], loading: false, error: ui.message(error) });
    } finally {
      if (!this.hidden && this.visit === visit && this.request === request)
        this.setData({ loading: false });
    }
  },
  render() {
    if (!this.raw || !this.viewer || !ui.live(this, this.loadedToken)) return;
    try {
      const rows = orders
        .list(this.raw, this.viewer, this.data.view, this.data.status)
        .map((order) => orders.decorateOrder(order, this.viewer, this.data.view, ui));
      this.setData({ rows });
    } catch (error) {
      this.raw = null;
      this.setData({ rows: [], error: ui.message(error) });
    }
  },
  changeView(event) {
    const view = event.currentTarget.dataset.view;
    if (!['sent', 'received'].includes(view) || view === this.data.view) return;
    this.setData({ view, rows: [] });
    this.load();
  },
  changeStatus(event) {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || !STATUS_VALUES[index]) return;
    this.setData({ statusIndex: index, status: STATUS_VALUES[index] });
    this.render();
  },
  detail(event) {
    if (!this.loadedToken || !ui.live(this, this.loadedToken)) return;
    const id = event.currentTarget.dataset.id;
    if (!this.data.rows.some((row) => row.id === id)) return;
    ui.open('booking-detail', { id, view: this.data.view });
  },
  login() {
    ui.login('/pages/bookings/index?view=' + this.data.view);
  },
  players() {
    ui.open('players');
  },
});
