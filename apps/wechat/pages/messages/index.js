const api = require('../../utils/api');
const ui = require('../../utils/ui');
const root = '/v1/me/notifications';
const journal = (viewer) => 'scb-notification-retry-v1:' + viewer;
const labels = {
  WAITING_PERMISSION: '待本人订阅',
  PENDING: '等待发送',
  SENDING: '正在核对发送',
  ACCEPTED: '微信已受理，送达未确认',
  UNKNOWN: '发送结果未知，不会自动重发',
  FAILED: '发送未完成',
  CANCELLED: '已取消',
  EXPIRED: '已过期',
};
function view(item) {
  return {
    ...item,
    deliveryLabel: labels[item.delivery] || '状态待核对',
    timeLabel: api.publicTime(item.time),
    createdLabel: api.publicTime(item.createdAt),
  };
}
function removeIf(viewer, id) {
  const key = journal(viewer),
    current = wx.getStorageSync(key);
  if (current && current.clientRequestId === id) wx.removeStorageSync(key);
}
Page({
  data: {
    items: [],
    nextCursor: null,
    loading: false,
    loadingMore: false,
    busy: false,
    error: '',
    message: '',
    pending: false,
    loginRequired: false,
  },
  onShow() {
    this._closed = false;
    this.setData({ items: [], busy: false });
    this.load();
  },
  onHide() {
    ui.close(this);
    this.setData({
      items: [],
      nextCursor: null,
      error: '',
      message: '',
      busy: false,
      loading: false,
      loadingMore: false,
    });
  },
  onUnload() {
    this.onHide();
  },
  onSessionReset() {
    this._viewer = null;
    this.setData({
      items: [],
      nextCursor: null,
      busy: false,
      pending: false,
      loading: false,
      loadingMore: false,
      loginRequired: true,
    });
  },
  login() {
    ui.login('/pages/messages/index');
  },
  async load() {
    if (this.data.busy) return;
    const t = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      const session = await ui.session(this, '/pages/messages/index');
      if (!session || !ui.live(this, t)) return;
      this._viewer = session.user.id;
      const r = (await api.getClient().request(root)).data;
      if (ui.live(this, t))
        this.setData({
          items: r.items.map(view),
          nextCursor: r.nextCursor,
          pending: !!wx.getStorageSync(journal(this._viewer)),
        });
    } catch (e) {
      if (ui.live(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.live(this, t)) this.setData({ loading: false });
    }
  },
  async more() {
    if (!this.data.nextCursor || this.data.loadingMore || this.data.busy) return;
    const cursor = this.data.nextCursor,
      t = ui.hold(this);
    this.setData({ loadingMore: true, error: '' });
    try {
      const r = (await api.getClient().request(root + '?cursor=' + encodeURIComponent(cursor)))
        .data;
      if (ui.held(this, t))
        this.setData({
          items: [...this.data.items, ...r.items.map(view)],
          nextCursor: r.nextCursor,
        });
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ loadingMore: false });
    }
  },
  async read(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id,
      t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      const requestId = await ui.uuid();
      if (!ui.held(this, t)) return;
      await api.getClient().request(root + '/' + encodeURIComponent(id) + '/read', 'POST', {
        clientRequestId: requestId,
      });
      if (ui.held(this, t))
        this.setData({
          items: this.data.items.map((x) => (x.id === id ? { ...x, readAt: 'read' } : x)),
        });
    } catch (err) {
      if (ui.held(this, t)) this.setData({ error: ui.message(err) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async retry(e) {
    if (this.data.busy || this.data.pending || !this._viewer) return;
    const id = e.currentTarget.dataset.id,
      t = ui.hold(this),
      viewer = this._viewer;
    this.setData({ busy: true, error: '' });
    try {
      const choice = await new Promise((resolve) =>
        wx.showModal({
          title: '重新发起微信提醒',
          content: '请先重新订阅一次。原结果若未知，新提醒可能重复；确认只发起本次新请求。',
          confirmText: '确认重试',
          success: resolve,
          fail: () => resolve({ confirm: false }),
        }),
      );
      if (!choice.confirm || !ui.held(this, t)) return;
      const clientRequestId = await ui.uuid();
      if (!ui.held(this, t)) return;
      const p = { clientRequestId, messageId: id };
      wx.setStorageSync(journal(viewer), p);
      this.setData({ pending: true });
      await this.sendRetry(p, viewer, t);
    } catch (err) {
      if (ui.held(this, t)) this.setData({ error: ui.message(err) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async resume() {
    if (this.data.busy || !this._viewer) return;
    const viewer = this._viewer,
      p = wx.getStorageSync(journal(viewer));
    if (!p) return;
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      await this.sendRetry(p, viewer, t);
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async sendRetry(p, viewer, t) {
    await api.getClient().request(root + '/' + encodeURIComponent(p.messageId) + '/retry', 'POST', {
      clientRequestId: p.clientRequestId,
      acknowledgePossibleDuplicate: true,
    });
    removeIf(viewer, p.clientRequestId);
    if (ui.held(this, t))
      this.setData({
        pending: false,
        message: '原编号已核对，本次提醒等待派发。微信受理与实际送达分别记录。',
      });
  },
  settings() {
    ui.open('notification-settings');
  },
});
