const api = require('../../utils/api');
const ui = require('../../utils/ui');
function wxCode() {
  return new Promise((resolve, reject) =>
    wx.login({
      timeout: 5000,
      success: (v) => (v.code ? resolve(v.code) : reject(new Error('微信未返回登录凭据'))),
      fail: () => reject(new Error('微信登录未完成，请重新发起')),
    }),
  );
}
Page({
  data: {
    email: '',
    password: '',
    displayName: '',
    registerMode: false,
    canRegister: false,
    consent: false,
    user: null,
    binding: null,
    connected: false,
    enabled: false,
    busy: false,
    loading: false,
    message: '',
    hasReturn: false,
  },
  onLoad(query = {}) {
    this.returnTo = ui.safeReturn(query.returnTo || '');
    this.setData({ hasReturn: !!this.returnTo });
  },
  onShow() {
    this.closed = false;
    this.setData({ busy: this.commandBusy === true, password: '', consent: false });
    if (!this.unsubscribe)
      this.unsubscribe = api.getClient().onSessionChange(() => {
        if (!this.closed)
          this.setData({
            user: null,
            binding: null,
            connected: false,
            password: '',
            consent: false,
          });
      });
    this.load();
  },
  onUnload() {
    this.closed = true;
    this.seq = (this.seq || 0) + 1;
    if (this.unsubscribe) this.unsubscribe();
  },
  onHide() {
    this.closed = true;
    this.seq = (this.seq || 0) + 1;
    this.setData({ password: '', consent: false });
  },
  input(e) {
    const field = e.currentTarget.dataset.field;
    if (['email', 'password', 'displayName'].includes(field))
      this.setData({ [field]: e.detail.value });
  },
  consent(e) {
    this.setData({ consent: e.detail.value.includes('yes') });
  },
  toggleRegister() {
    if (!this.data.busy)
      this.setData({ registerMode: !this.data.registerMode, password: '', message: '' });
  },
  async load() {
    const seq = (this.seq || 0) + 1;
    this.seq = seq;
    this.setData({ loading: true, user: null, binding: null, connected: false });
    try {
      const client = api.getClient();
      const results = await Promise.allSettled([
        client.request('/v1/auth/wechat/capabilities'),
        client.request('/v1/auth/capabilities'),
      ]);
      if (this.closed || seq !== this.seq) return;
      this.setData({
        enabled: results[0].status === 'fulfilled' && results[0].value.data.enabled === true,
        canRegister:
          results[1].status === 'fulfilled' &&
          results[1].value.data.canRegisterParticipant === true,
      });
      if (!client.hasSession()) return;
      const current = (await client.request('/v1/auth/session')).data;
      if (
        !current ||
        !current.user ||
        typeof current.user.displayName !== 'string' ||
        typeof current.user.email !== 'string'
      )
        throw new Error('登录资料无效，请重新登录');
      api.uuid(current.user.id);
      if (this.closed || seq !== this.seq || client.viewerId() !== current.user.id) return;
      let binding = null;
      try {
        binding = (await client.request('/v1/auth/wechat/binding')).data;
      } catch (error) {
        if (error.status === 401 || error.code === 'SESSION_CHANGED') throw error;
      }
      if (!this.closed && seq === this.seq && client.viewerId() === current.user.id)
        this.setData({
          user: current.user,
          binding,
          connected: !!(binding && binding.connected),
          platformOperator: current.platformOperator === true,
          registerMode: false,
          message: '',
        });
    } catch (error) {
      if (!this.closed && seq === this.seq)
        this.setData({ user: null, binding: null, connected: false, message: ui.message(error) });
    } finally {
      if (!this.closed && seq === this.seq) this.setData({ loading: false });
    }
  },
  async task(action) {
    if (this.commandBusy) return;
    this.commandBusy = true;
    this.setData({ busy: true, message: '' });
    try {
      await action();
    } catch (error) {
      if (!this.closed) this.setData({ message: ui.message(error) });
    } finally {
      this.commandBusy = false;
      if (!this.closed) this.setData({ busy: false, password: '', consent: false });
    }
  },
  login() {
    const email = this.data.email,
      password = this.data.password;
    this.setData({ password: '' });
    this.task(async () => {
      await api.getClient().request('/v1/auth/login', 'POST', { email, password });
      await this.load();
      if (!this.closed && this.data.user && this.returnTo) wx.redirectTo({ url: this.returnTo });
    });
  },
  register() {
    if (!this.data.canRegister) return;
    const email = this.data.email,
      password = this.data.password,
      displayName = this.data.displayName;
    this.setData({ password: '' });
    this.task(async () => {
      await api
        .getClient()
        .request('/v1/auth/register-participant', 'POST', { email, password, displayName });
      await this.load();
      if (!this.closed && this.data.user && this.returnTo) wx.redirectTo({ url: this.returnTo });
    });
  },
  wechatLogin() {
    if (!this.data.enabled || !this.data.consent) return;
    this.task(async () => {
      const client = api.getClient();
      const revision = client.sessionRevision();
      const attempt = (
        await client.request('/v1/auth/wechat/challenges', 'POST', {
          purpose: 'LOGIN',
          consent: true,
        })
      ).data;
      const code = await wxCode();
      if (this.closed || client.sessionRevision() !== revision) return;
      await client.request('/v1/auth/wechat/login', 'POST', {
        challengeId: attempt.challengeId,
        state: attempt.state,
        code,
        consent: true,
      });
      await this.load();
      if (!this.closed && this.data.user && this.returnTo) wx.redirectTo({ url: this.returnTo });
    });
  },
  bind() {
    if (!this.data.user || !this.data.enabled || !this.data.consent) return;
    const password = this.data.password,
      viewer = this.data.user.id,
      revision = api.getClient().sessionRevision();
    this.setData({ password: '' });
    this.task(async () => {
      const client = api.getClient();
      const attempt = (
        await client.request('/v1/auth/wechat/challenges', 'POST', {
          purpose: 'BIND',
          password,
          consent: true,
        })
      ).data;
      const code = await wxCode();
      if (this.closed || client.sessionRevision() !== revision || client.viewerId() !== viewer)
        return;
      await client.request('/v1/auth/wechat/bind', 'POST', {
        challengeId: attempt.challengeId,
        state: attempt.state,
        code,
        consent: true,
      });
      await this.load();
      if (!this.closed) this.setData({ message: '微信身份已绑定当前应用账号。' });
    });
  },
  async unbind() {
    if (!this.data.connected || !this.data.consent || this.commandBusy) return;
    const password = this.data.password,
      expectedVersion = this.data.binding.version,
      revision = api.getClient().sessionRevision();
    this.setData({ password: '' });
    if (
      !(await ui.confirm('解除微信绑定', '本操作会退出该账号所有设备，需重新登录。')) ||
      this.closed ||
      api.getClient().sessionRevision() !== revision
    )
      return;
    this.task(async () => {
      await api
        .getClient()
        .request('/v1/auth/wechat/unbind', 'POST', { password, expectedVersion, consent: true });
      api.getClient().clearSession();
      if (!this.closed)
        this.setData({
          user: null,
          binding: null,
          connected: false,
          message: '已解绑并退出全部设备。',
        });
    });
  },
  logout() {
    this.task(async () => {
      await api.getClient().request('/v1/auth/logout', 'POST');
      api.getClient().clearSession();
      if (!this.closed)
        this.setData({ user: null, binding: null, connected: false, message: '已退出登录。' });
    });
  },
  continue() {
    if (this.data.user && this.returnTo) wx.redirectTo({ url: this.returnTo });
  },
  go(e) {
    const key = e.currentTarget.dataset.page;
    const query = key === 'bookings' ? { view: 'sent' } : {};
    ui.open(key, query);
  },
});
