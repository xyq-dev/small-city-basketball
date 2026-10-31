const api = require('../../utils/api');
const ui = require('../../utils/ui');
const root = '/v1/me/notifications';
const key = (viewer) => 'scb-notification-consent-v1:' + viewer;
const labels = {
  REGISTRATION_REVIEW: '报名审核更新',
  MATCH_RESCHEDULED: '比赛改期通知',
  MATCH_STARTING: '开赛前提醒',
};
function clear(viewer, id) {
  const p = wx.getStorageSync(key(viewer));
  if (p && p.clientRequestId === id) wx.removeStorageSync(key(viewer));
}
Page({
  data: {
    enabled: false,
    kinds: [],
    selected: 'MATCH_STARTING',
    intent: null,
    pending: false,
    busy: false,
    error: '',
    message: '',
    subscriptions: [],
    loginRequired: false,
  },
  onShow() {
    this._closed = false;
    this.setData({ intent: null, busy: false, error: '', message: '' });
    this.load();
  },
  onHide() {
    ui.close(this);
    this.setData({ intent: null, busy: false, subscriptions: [] });
  },
  onUnload() {
    this.onHide();
  },
  onSessionReset() {
    this._viewer = null;
    this.setData({
      intent: null,
      pending: false,
      busy: false,
      subscriptions: [],
      kinds: [],
      enabled: false,
      loginRequired: true,
    });
  },
  login() {
    ui.login('/pages/notification-settings/index');
  },
  async load() {
    const t = ui.begin(this);
    try {
      const session = await ui.session(this, '/pages/notification-settings/index');
      if (!session || !ui.live(this, t)) return;
      this._viewer = session.user.id;
      const data = (await api.getClient().request(root + '/settings')).data;
      if (ui.live(this, t))
        this.setData({
          enabled: data.wechatEnabled,
          kinds: data.kinds.map((x) => ({ ...x, label: labels[x.kind] })),
          subscriptions: data.subscriptions,
          pending: !!wx.getStorageSync(key(this._viewer)),
        });
    } catch (e) {
      if (ui.live(this, t)) this.setData({ error: ui.message(e) });
    }
  },
  choose(e) {
    if (this.data.busy || this.data.pending) return;
    const kind = e.currentTarget.dataset.kind;
    if (labels[kind]) this.setData({ selected: kind, intent: null, message: '' });
  },
  async prepare() {
    if (this.data.busy || this.data.pending || !this.data.enabled || !this._viewer) return;
    const t = ui.hold(this),
      viewer = this._viewer,
      kind = this.data.selected;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const clientRequestId = await ui.uuid();
      if (!ui.held(this, t)) return;
      const p = { phase: 'PREPARE', clientRequestId, kind };
      wx.setStorageSync(key(viewer), p);
      this.setData({ pending: true });
      await this.prepareOriginal(p, viewer, t);
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async prepareOriginal(p, viewer, t) {
    const intent = (
      await api
        .getClient()
        .request(root + '/intents', 'POST', { clientRequestId: p.clientRequestId, kind: p.kind })
    ).data;
    clear(viewer, p.clientRequestId);
    if (ui.held(this, t))
      this.setData({
        intent,
        pending: false,
        selected: p.kind,
        message: '请点击下方按钮，在微信弹窗中决定本次订阅。',
      });
  },
  // WeChat requires the native prompt synchronously inside the actual tap callback.
  subscribe() {
    const intent = this.data.intent;
    if (this.data.busy || this.data.pending || !intent || !this._viewer) return;
    const t = ui.hold(this),
      viewer = this._viewer;
    this.setData({ busy: true, error: '', message: '' });
    if (typeof wx.requestSubscribeMessage !== 'function') {
      this.setData({
        busy: false,
        error: '当前环境不支持微信订阅弹窗，请在正式支持的小程序中操作。',
      });
      return;
    }
    try {
      wx.requestSubscribeMessage({
        tmplIds: [intent.templateId],
        success: (choice) => {
          void this.finishChoice(t, viewer, intent, choice);
        },
        fail: () => {
          if (ui.held(this, t))
            this.setData({ busy: false, error: '微信订阅未确认，未提交发送许可。' });
        },
      });
    } catch (e) {
      if (ui.held(this, t)) this.setData({ busy: false, error: ui.message(e) });
    }
  },
  async finishChoice(t, viewer, intent, choice) {
    try {
      if (!ui.held(this, t)) return;
      const result = choice[intent.templateId];
      if (!['accept', 'reject', 'ban', 'filter'].includes(result))
        throw Error('微信未返回有效的本次订阅选择');
      let code;
      if (result === 'accept') {
        const login = await new Promise((resolve, reject) =>
          wx.login({ success: resolve, fail: reject }),
        );
        if (!ui.held(this, t)) return;
        if (!login || typeof login.code !== 'string') throw Error('微信身份确认未完成');
        code = login.code;
      }
      const clientRequestId = await ui.uuid();
      if (!ui.held(this, t)) return;
      const p = { phase: 'CONFIRM', clientRequestId, intentId: intent.id, kind: intent.kind };
      wx.setStorageSync(key(viewer), p);
      this.setData({ pending: true });
      const response = (
        await api.getClient().request(root + '/confirmations', 'POST', {
          clientRequestId,
          intentId: intent.id,
          result,
          ...(code ? { code } : {}),
        })
      ).data;
      clear(viewer, clientRequestId);
      if (ui.held(this, t))
        this.setData({
          pending: false,
          intent: null,
          message:
            response.state === 'ACCEPTED'
              ? '本次客户端许可已记录；微信发送仍以官方实际响应为准，一次许可只安排一次提醒。'
              : '本次未允许微信提醒，站内业务照常。',
        });
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async recover() {
    if (this.data.busy || !this._viewer) return;
    const viewer = this._viewer,
      p = wx.getStorageSync(key(viewer));
    if (!p) return;
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      if (p.phase === 'PREPARE') {
        await this.prepareOriginal(p, viewer, t);
        return;
      }
      if (p.phase === 'REVOKE') {
        await this.revokeOriginal(p, viewer, t);
        return;
      }
      const r = (await api.getClient().request(root + '/intents/' + encodeURIComponent(p.intentId)))
        .data;
      if (['ACCEPTED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(r.state))
        clear(viewer, p.clientRequestId);
      if (ui.held(this, t))
        this.setData({
          pending: !!wx.getStorageSync(key(viewer)),
          message: ['ACCEPTED', 'REJECTED', 'FAILED', 'EXPIRED'].includes(r.state)
            ? '原订阅请求已核对，可重新选择。'
            : '原确认结果仍待核对，可稍后查询，或明确撤销本类许可后重试。',
        });
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async revoke() {
    if (this.data.busy || !this._viewer) return;
    const t = ui.hold(this),
      viewer = this._viewer,
      current = wx.getStorageSync(key(viewer)),
      kind = current?.kind || this.data.selected;
    this.setData({ busy: true, error: '' });
    try {
      const decision = await new Promise((resolve) =>
        wx.showModal({
          title: '撤销本类微信提醒',
          content: '取消尚未完成的本类订阅确认与待发提醒。已被微信受理的内容无法追回。',
          success: resolve,
          fail: () => resolve({ confirm: false }),
        }),
      );
      if (!decision.confirm || !ui.held(this, t)) return;
      const clientRequestId = await ui.uuid();
      if (!ui.held(this, t)) return;
      const p = { phase: 'REVOKE', clientRequestId, kind };
      wx.setStorageSync(key(viewer), p);
      this.setData({ pending: true });
      await this.revokeOriginal(p, viewer, t);
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async revokeOriginal(p, viewer, t) {
    await api.getClient().request(root + '/subscriptions/revoke', 'POST', {
      clientRequestId: p.clientRequestId,
      kind: p.kind,
    });
    clear(viewer, p.clientRequestId);
    if (ui.held(this, t))
      this.setData({
        intent: null,
        pending: false,
        message: '已核对本类撤销；旧的迟到确认不能恢复许可。',
      });
  },
  messages() {
    ui.open('messages');
  },
});
