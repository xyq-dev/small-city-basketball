const api = require('../../utils/api');
const ui = require('../../utils/ui');
const root = '/v1/account-recovery';
const pendingKey = 'scb-account-recovery-pending-v1';
function clearPending(id) {
  const current = wx.getStorageSync(pendingKey);
  if (current && current.id === id) wx.removeStorageSync(pendingKey);
}
Page({
  data: {
    email: '',
    token: '',
    newPassword: '',
    enabled: false,
    verified: false,
    signedIn: false,
    busy: false,
    pending: false,
    message: '',
    error: '',
  },
  onShow() {
    this._closed = false;
    this.setData({
      busy: false,
      token: '',
      newPassword: '',
      pending: !!wx.getStorageSync(pendingKey),
    });
    this.load();
  },
  onHide() {
    ui.close(this);
    this.setData({ token: '', newPassword: '' });
  },
  onUnload() {
    this.onHide();
  },
  onSessionReset() {
    this.setData({
      email: '',
      busy: false,
      token: '',
      newPassword: '',
      signedIn: false,
      verified: false,
    });
  },
  input(e) {
    if (
      !this.data.busy &&
      ['email', 'token', 'newPassword'].includes(e.currentTarget.dataset.field)
    )
      this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  async load() {
    const t = ui.begin(this);
    try {
      const cap = (await api.getClient().request(root + '/capabilities', 'GET', undefined, true))
        .data;
      if (!ui.live(this, t)) return;
      this.setData({ enabled: cap.canResetPassword === true });
      if (api.getClient().hasSession()) {
        const me = (await api.getClient().request(root + '/me')).data;
        if (ui.live(this, t))
          this.setData({ email: me.email, verified: me.emailVerified, signedIn: true });
      }
    } catch (e) {
      if (ui.live(this, t)) this.setData({ error: ui.message(e) });
    }
  },
  async request(e) {
    if (this.data.busy || !this.data.enabled) return;
    const verify = e.currentTarget.dataset.kind === 'verify';
    const t = ui.hold(this);
    this.setData({ busy: true, error: '', message: '' });
    try {
      const id = await ui.uuid();
      if (!ui.held(this, t)) return;
      await api
        .getClient()
        .request(
          root + (verify ? '/verification-requests' : '/reset-requests'),
          'POST',
          { clientRequestId: id, ...(verify ? {} : { email: this.data.email }) },
          !verify,
        );
      if (ui.held(this, t))
        this.setData({
          message: '申请已受理；若账号存在且通道可用，请查收邮件。通道受理不代表已经送达。',
        });
    } catch (err) {
      if (ui.held(this, t)) this.setData({ error: ui.message(err) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async consume() {
    if (this.data.busy || !this.data.enabled || this.data.pending) return;
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    let operationId;
    try {
      const id = await ui.uuid();
      if (!ui.held(this, t)) return;
      operationId = id;
      wx.setStorageSync(pendingKey, { id });
      this.setData({ pending: true });
      await api.getClient().request(
        root + '/consume',
        'POST',
        {
          clientRequestId: id,
          token: this.data.token,
          ...(this.data.newPassword ? { newPassword: this.data.newPassword } : {}),
        },
        true,
      );
      clearPending(id);
      if (ui.held(this, t))
        this.setData({
          pending: false,
          token: '',
          newPassword: '',
          message: '操作已完成。重置密码后，原账号所有旧登录需重新登录。',
        });
    } catch (err) {
      if (err.status >= 400 && err.status < 500 && ![408, 429].includes(err.status))
        clearPending(operationId);
      if (ui.held(this, t))
        this.setData({
          pending: !!wx.getStorageSync(pendingKey),
          error: ui.message(err),
          newPassword: '',
        });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async resolve(e) {
    if (this.data.busy) return;
    const p = wx.getStorageSync(pendingKey);
    if (!p || !p.id) return;
    const cancel = e.currentTarget.dataset.kind === 'cancel';
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      const result = (
        await api
          .getClient()
          .request(
            root + (cancel ? '/cancel' : '/receipts'),
            'POST',
            { clientRequestId: p.id, token: this.data.token },
            true,
          )
      ).data;
      const done = result.completed || result.cancelled;
      if (done) clearPending(p.id);
      if (ui.held(this, t))
        this.setData({
          pending: !done,
          token: done ? '' : this.data.token,
          newPassword: '',
          message: result.completed
            ? '原操作已完成，请使用当前密码重新登录。'
            : result.cancelled
              ? '原请求已取消，迟到请求也不会执行。可以重新确认后操作。'
              : '原操作尚未确认；保留编号继续核对，或明确取消原请求后重新操作。',
        });
    } catch (err) {
      if (ui.held(this, t)) this.setData({ error: ui.message(err) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  login() {
    ui.open('account');
  },
});
