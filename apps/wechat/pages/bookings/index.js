const ui = require('../../utils/ui');
const sdk = require('../../utils/booking');
const orders = require('../../utils/booking-orders');
function scheduleText(item) {
  if (item.status === 'CONDITIONAL') return '条件满足后补齐具体时间';
  const date = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(item.startText);
  if (!date || !item.endText || !item.reportText) return '';
  const day =
    date[1] === ui.today().slice(0, 4)
      ? Number(date[2]) + '月' + Number(date[3]) + '日'
      : date[1] + '年' + Number(date[2]) + '月' + Number(date[3]) + '日';
  const startDate = item.startText.slice(0, 10);
  const end = item.endText.startsWith(startDate + ' ') ? item.endText.slice(11) : item.endText;
  const report = item.reportText.startsWith(startDate + ' ')
    ? item.reportText.slice(11)
    : item.reportText;
  return day + ' ' + date[4] + '–' + end + ' · 报到' + report;
}
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
    quickStatuses: [
      { value: 'ALL', index: 0, label: '全部' },
      { value: 'REQUESTED', index: 1, label: '待接单' },
      { value: 'ACCEPTED', index: 2, label: '已接单' },
      { value: 'COMPLETED', index: 5, label: '已完成' },
    ],
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
        .map((order) => {
          const decorated = orders.decorateOrder(order, this.viewer, this.data.view, ui);
          return {
            ...decorated,
            appearances: decorated.appearances.map((item) => ({
              ...item,
              scheduleText: scheduleText(item),
            })),
          };
        });
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
  statusTab(event) {
    this.changeStatus({ detail: { value: event.currentTarget.dataset.index } });
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
