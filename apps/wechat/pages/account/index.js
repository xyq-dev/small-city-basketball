const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
function wxCode() {
  return new Promise((resolve, reject) =>
    wx.login({
      timeout: 5000,
      success: (v) => (v.code ? resolve(v.code) : reject(new Error('微信未返回登录凭据'))),
      fail: () => reject(new Error('微信登录未完成，请重新发起')),
    }),
  );
}
// Display hints only: every management page re-reads its own capabilities from the API.
function roleView(session) {
  const organizations = events.organizations(session);
  const roles = organizations.map((o) => ({
    key: o.id,
    text: o.name + ' · ' + o.roleLabel,
  }));
  return {
    roles,
    managedOrgs: organizations.filter((o) => ['ORG_OWNER', 'ORG_ADMIN'].includes(o.role)),
    roleSummary:
      roles
        .map((r) => r.text)
        .slice(0, 2)
        .join('；') + (roles.length > 2 ? ' 等' : ''),
    teamCount: Array.isArray(session.teamContexts) ? session.teamContexts.length : 0,
  };
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
    messageTone: 'info',
    hasReturn: false,
    securityOpen: false,
    roles: [],
    managedOrgs: [],
    roleSummary: '',
    teamCount: 0,
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
            securityOpen: false,
            password: '',
            consent: false,
            roles: [],
            managedOrgs: [],
            teamCount: 0,
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
    if (this.data.busy || this.commandBusy) return;
    const field = e.currentTarget.dataset.field;
    if (['email', 'password', 'displayName'].includes(field))
      this.setData({ [field]: e.detail.value });
  },
  consent(e) {
    if (this.data.busy || this.commandBusy) return;
    this.setData({ consent: e.detail.value.includes('yes') });
  },
  toggleRegister() {
    if (!this.data.busy)
      this.setData({ registerMode: !this.data.registerMode, password: '', message: '' });
  },
  async load() {
    const seq = (this.seq || 0) + 1;
    this.seq = seq;
    this.setData({
      loading: true,
      user: null,
      binding: null,
      connected: false,
      roles: [],
      managedOrgs: [],
      teamCount: 0,
    });
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
          ...roleView(current),
          registerMode: false,
          message: '',
        });
    } catch (error) {
      if (!this.closed && seq === this.seq)
        this.setData({
          user: null,
          binding: null,
          connected: false,
          message: ui.message(error),
          messageTone: 'error',
        });
    } finally {
      if (!this.closed && seq === this.seq) this.setData({ loading: false });
    }
  },
  async task(action) {
    if (this.commandBusy) return;
    this.commandBusy = true;
    this.setData({ busy: true, message: '', messageTone: 'info' });
    try {
      await action();
    } catch (error) {
      if (!this.closed) this.setData({ message: ui.message(error), messageTone: 'error' });
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
      if (!this.closed)
        this.setData({ message: '微信身份已绑定当前应用账号。', messageTone: 'success' });
    });
  },
  async unbind() {
    if (!this.data.connected || !this.data.consent || this.commandBusy) return;
    const password = this.data.password,
      expectedVersion = this.data.binding.version,
      revision = api.getClient().sessionRevision();
    this.setData({ password: '' });
    return this.task(async () => {
      if (
        !(await ui.confirm('解除微信绑定', '本操作会退出该账号所有设备，需重新登录。')) ||
        this.closed ||
        api.getClient().sessionRevision() !== revision
      )
        return;
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
          messageTone: 'success',
        });
    });
  },
  logout() {
    this.task(async () => {
      await api.getClient().request('/v1/auth/logout', 'POST');
      api.getClient().clearSession();
      if (!this.closed)
        this.setData({
          user: null,
          binding: null,
          connected: false,
          message: '已退出登录。',
          messageTone: 'success',
        });
    });
  },
  switchAccount() {
    this.task(async () => {
      await api.getClient().request('/v1/auth/logout', 'POST');
      api.getClient().clearSession();
      if (!this.closed)
        this.setData({
          user: null,
          binding: null,
          connected: false,
          roles: [],
          teamCount: 0,
          registerMode: false,
          message: '已退出上一账号，请登录要切换的账号。',
          messageTone: 'success',
        });
    });
  },
  continue() {
    if (this.data.user && this.returnTo) wx.redirectTo({ url: this.returnTo });
  },
  showSecurity() {
    if (!this.data.user || this.data.busy || this.commandBusy) return;
    this.setData({ securityOpen: true });
  },
  closeSecurity() {
    if (this.data.busy || this.commandBusy) return;
    this.setData({ securityOpen: false });
  },
  copyMemberId() {
    if (
      !this.closed &&
      !this.data.busy &&
      this.data.user?.id &&
      api.getClient().viewerId() === this.data.user.id &&
      typeof wx.setClipboardData === 'function'
    )
      wx.setClipboardData({ data: this.data.user.id });
  },
  go(e) {
    const key = e.currentTarget.dataset.page;
    if (this.data.busy) return;
    if (key === 'watch') {
      wx.redirectTo({ url: '/pages/watch/index' });
      return;
    }
    const kind = e.currentTarget.dataset.kind;
    const query = [
      'seasons',
      'team-requests',
      'staff-configuration',
      'local-manage',
      'sponsorships',
      'public-ledgers',
      'trade-manage',
    ].includes(key)
      ? { orgId: api.uuid(e.currentTarget.dataset.org) }
      : key === 'bookings'
        ? { view: 'sent' }
        : key === 'planned' && ['funds', 'messages', 'profile'].includes(kind)
          ? { kind }
          : {};
    ui.open(key, query);
  },
});
