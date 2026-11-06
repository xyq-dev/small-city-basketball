const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const figmaPreview = require('../../utils/figma-preview');
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
    uiPreview: false,
    figmaState: '',
    contentHeight: 672,
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
    workspaceTab: 'personal',
    ordersOpen: false,
    navigationMoreOpen: false,
    emailOpen: false,
    settingsOpen: false,
    agreement: '',
    wechatState: 'loading',
    workspaceOpen: false,
    consentOpen: false,
    termsRead: false,
    loginPhase: '',
    loginNotice: '',
    roles: [],
    managedOrgs: [],
    roleSummary: '',
    teamCount: 0,
  },
  onLoad(query = {}) {
    this.returnTo = ui.safeReturn(query.returnTo || '');
    this.uiPreview = figmaPreview.enabled(query, wx);
    this.uiPreviewState = ['closed', 'unknown', 'open', 'loading', 'unbound', 'failed'].includes(
      query.state,
    )
      ? query.state
      : 'closed';
    this.setData({ hasReturn: !!this.returnTo, uiPreview: this.uiPreview });
    this.syncChrome();
  },
  onShow() {
    this.closed = false;
    this.syncChrome();
    if (this.uiPreview) {
      const state = this.uiPreviewState;
      const wechatState = ['unbound', 'failed'].includes(state) ? 'open' : state;
      this.commandBusy = false;
      this.setData({
        busy: false,
        loading: state === 'loading',
        user: null,
        binding: null,
        connected: false,
        enabled: wechatState === 'open',
        wechatState,
        loginPhase: '',
        loginNotice: ['unbound', 'failed'].includes(state) ? state : '',
        message: '',
        messageTone: 'info',
        emailOpen: false,
        registerMode: false,
        consentOpen: false,
        agreement: '',
        termsRead: false,
        password: '',
        consent: false,
        roles: [],
        managedOrgs: [],
        roleSummary: '',
        teamCount: 0,
      });
      return;
    }
    this.setData({ busy: this.commandBusy === true, password: '', consent: false });
    if (!this.unsubscribe)
      this.unsubscribe = api.getClient().onSessionChange(() => {
        if (!this.closed)
          this.setData({
            user: null,
            binding: null,
            connected: false,
            securityOpen: false,
            workspaceTab: 'personal',
            ordersOpen: false,
            navigationMoreOpen: false,
            workspaceOpen: false,
            consentOpen: false,
            loginPhase: '',
            loginNotice: '',
            password: '',
            consent: false,
            roles: [],
            managedOrgs: [],
            teamCount: 0,
          });
      });
    this.load();
  },
  onResize() {
    this._headerHeight = 0;
    this.syncChrome();
  },
  syncChrome() {
    let contentHeight = this.data.contentHeight;
    try {
      const info =
        typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const statusBarHeight = Number.isFinite(info.statusBarHeight) ? info.statusBarHeight : 44;
      const screenHeight = Number.isFinite(info.screenHeight)
        ? info.screenHeight
        : info.windowHeight;
      const safeBottom =
        info.safeArea && Number.isFinite(info.safeArea.bottom)
          ? Math.max(0, screenHeight - info.safeArea.bottom)
          : 0;
      const headerHeight =
        Number.isFinite(this._headerHeight) && this._headerHeight > 0
          ? this._headerHeight
          : statusBarHeight + 44;
      if (Number.isFinite(info.windowHeight))
        contentHeight = Math.max(320, info.windowHeight - headerHeight - 50 - safeBottom);
    } catch {}
    if (contentHeight !== this.data.contentHeight) this.setData({ contentHeight });
  },
  headerLayout(e) {
    const height = Number(e && e.detail && e.detail.height);
    if (!Number.isFinite(height) || height <= 0 || height === this._headerHeight) return;
    this._headerHeight = height;
    this.syncChrome();
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
    if (this.uiPreview) return;
    const seq = (this.seq || 0) + 1;
    this.seq = seq;
    this.setData({
      loading: true,
      loginPhase: '',
      loginNotice: '',
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
      const wechat = results[0];
      const wechatState =
        wechat.status !== 'fulfilled'
          ? 'unknown'
          : wechat.value.data.enabled === true
            ? 'open'
            : 'closed';
      this.setData({
        enabled: wechatState === 'open',
        wechatState,
        canRegister:
          results[1].status === 'fulfilled' &&
          results[1].value.data.canRegisterParticipant === true,
      });
      if (!client.hasSession()) {
        if (wechatState === 'unknown') this.setData({ message: '', messageTone: 'info' });
        return;
      }
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
          workspaceTab:
            roleView(current).roles.length && this.data.workspaceTab === 'work'
              ? 'work'
              : 'personal',
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
    if (this.uiPreview) {
      this.setData({
        message: 'Figma UI 预览不执行真实登录或业务提交',
        messageTone: 'info',
      });
      return;
    }
    if (this.commandBusy) return;
    this.commandBusy = true;
    this.setData({ busy: true, message: '', messageTone: 'info' });
    try {
      await action();
    } catch (error) {
      if (!this.closed) {
        const code = error && error.code;
        const loginNotice = this.wechatAttempt
          ? code === 'WECHAT_BINDING_REQUIRED'
            ? 'unbound'
            : 'failed'
          : '';
        this.setData({
          message: loginNotice ? '' : ui.message(error),
          messageTone: loginNotice ? 'info' : 'error',
          loginNotice,
        });
      }
    } finally {
      this.commandBusy = false;
      this.wechatAttempt = false;
      if (!this.closed) this.setData({ busy: false, password: '', consent: false, loginPhase: '' });
    }
  },
  login() {
    const email = this.data.email,
      password = this.data.password;
    if (
      typeof email !== 'string' ||
      email.length === 0 ||
      typeof password !== 'string' ||
      password.length === 0
    ) {
      this.setData({
        message:
          email.length === 0 && password.length === 0
            ? '请填写账号和密码'
            : email.length === 0
              ? '请填写账号或邮箱'
              : '请填写密码',
        messageTone: 'error',
      });
      return;
    }
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
    if (
      typeof email !== 'string' ||
      email.length === 0 ||
      typeof password !== 'string' ||
      password.length === 0 ||
      typeof displayName !== 'string' ||
      displayName.length === 0
    ) {
      this.setData({ message: '请填写注册邮箱、显示名称和密码', messageTone: 'error' });
      return;
    }
    this.setData({ password: '' });
    this.task(async () => {
      await api
        .getClient()
        .request('/v1/auth/register-participant', 'POST', { email, password, displayName });
      await this.load();
      if (!this.closed && this.data.user && this.returnTo) wx.redirectTo({ url: this.returnTo });
    });
  },
  openEmail() {
    if (this.data.busy) return;
    this.setData({ emailOpen: true, registerMode: false, message: '', consentOpen: false });
  },
  useEmailAfterWechat() {
    if (this.data.busy || this.commandBusy) return;
    this.setData({
      loginPhase: '',
      loginNotice: '',
      emailOpen: true,
      registerMode: false,
      message: '',
      consentOpen: false,
      consent: false,
    });
  },
  closeEmail() {
    if (this.data.busy) return;
    this.setData({ emailOpen: false, registerMode: false, password: '', message: '' });
  },
  toggleSettings() {
    if (this.data.busy) return;
    this.setData({ settingsOpen: !this.data.settingsOpen });
  },
  openAgreement(e) {
    const doc = e.currentTarget.dataset.doc;
    if (doc === 'terms' || doc === 'privacy') this.setData({ agreement: doc });
  },
  closeAgreement() {
    this.setData({ agreement: '' });
  },
  retryWechat() {
    if (this.data.busy || this.data.loading) return;
    if (this.uiPreview) {
      wx.showToast({ title: 'Figma UI 预览不发起认证请求', icon: 'none' });
      return;
    }
    if (this.data.loginNotice === 'failed' && this.data.wechatState === 'open') {
      this.setData({ loginNotice: '', message: '', consent: false, consentOpen: true });
      return;
    }
    this.load();
  },
  startWechat() {
    if (
      this.data.busy ||
      this.data.loading ||
      this.data.wechatState !== 'open' ||
      this.data.loginNotice === 'unbound' ||
      this.data.loginNotice === 'failed'
    )
      return;
    this.setData({
      consentOpen: true,
      consent: false,
      message: '',
    });
  },
  closeConsent() {
    if (this.data.busy || this.commandBusy) return;
    this.setData({ consentOpen: false, consent: false });
  },
  markTerms(e) {
    if (this.data.busy || this.commandBusy) return;
    this.setData({ termsRead: e.detail.value.includes('yes') });
  },
  wechatLogin() {
    if (
      this.data.loading ||
      this.data.wechatState === 'loading' ||
      this.data.wechatState !== 'open'
    )
      return;
    if (!this.data.consent) {
      this.setData({
        consentOpen: true,
        message: '请先明确同意本次微信身份认证',
        messageTone: 'error',
      });
      return;
    }
    this.task(async () => {
      this.wechatAttempt = true;
      if (!this.closed) this.setData({ loginPhase: 'wechat', loginNotice: '', consentOpen: false });
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
    if (this.uiPreview) return;
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
  workspace(e) {
    if (this.data.busy || this.commandBusy) return;
    const key = e.currentTarget.dataset.key;
    if (key === 'personal' || (key === 'work' && this.data.roles.length))
      this.setData({ workspaceTab: key });
  },
  toggleOrders() {
    if (this.data.user && !this.data.busy && !this.commandBusy)
      this.setData({ ordersOpen: !this.data.ordersOpen });
  },
  toggleMore() {
    if (this.data.user && !this.data.busy && !this.commandBusy)
      this.setData({ navigationMoreOpen: !this.data.navigationMoreOpen });
  },
  toggleWorkspace() {
    if (this.data.user && this.data.roles.length && !this.data.busy && !this.commandBusy)
      this.setData({ workspaceOpen: !this.data.workspaceOpen });
  },
  copyMemberId() {
    if (this.uiPreview) return;
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
    if (this.uiPreview) return;
    const key = e.currentTarget.dataset.page;
    if (this.data.busy) return;
    if (key === 'watch') {
      wx.redirectTo({ url: '/pages/watch/index' });
      return;
    }
    const kind = e.currentTarget.dataset.kind;
    const query =
      [
        'seasons',
        'team-requests',
        'staff-configuration',
        'local-manage',
        'sponsorships',
        'public-ledgers',
        'trade-manage',
        'training-manage',
        'sponsor-commerce',
      ].includes(key) &&
      (key !== 'sponsor-commerce' || e.currentTarget.dataset.org)
        ? { orgId: api.uuid(e.currentTarget.dataset.org) }
        : key === 'bookings'
          ? { view: 'sent' }
          : key === 'planned' && ['funds', 'messages', 'profile'].includes(kind)
            ? { kind }
            : {};
    ui.open(key, query);
  },
});
