const api = require('../../utils/api');
function wxCode() {
  return new Promise((resolve, reject) =>
    wx.login({
      timeout: 5000,
      success(result) {
        if (result.code) resolve(result.code);
        else reject(new Error('微信未返回登录凭据'));
      },
      fail() {
        reject(new Error('微信登录未完成，请重新发起'));
      },
    }),
  );
}
Page({
  data: {
    email: '',
    password: '',
    consent: false,
    user: null,
    binding: null,
    enabled: false,
    busy: false,
    message: '',
  },
  onShow() {
    this.load();
  },
  input(e) {
    const field = e.currentTarget.dataset.field;
    if (field === 'email' || field === 'password') this.setData({ [field]: e.detail.value });
  },
  consent(e) {
    this.setData({ consent: e.detail.value.includes('yes') });
  },
  async load() {
    try {
      const client = api.getClient();
      const cap = (await client.request('/v1/auth/wechat/capabilities')).data;
      this.setData({ enabled: cap.enabled === true });
      try {
        const session = (await client.request('/v1/auth/session')).data;
        const binding = (await client.request('/v1/auth/wechat/binding')).data;
        this.setData({ user: session.user, binding });
      } catch {
        this.setData({ user: null, binding: null });
      }
    } catch {
      this.setData({
        enabled: false,
        message: '当前服务尚未提供微信入口；仍可使用已有应用账号登录。',
      });
    }
  },
  async task(action) {
    if (this.data.busy) return;
    this.setData({ busy: true, message: '' });
    try {
      await action();
    } catch (error) {
      this.setData({ message: error.message || '操作未完成，请重新发起' });
    } finally {
      this.setData({ busy: false, password: '' });
    }
  },
  login() {
    const email = this.data.email,
      password = this.data.password;
    this.setData({ password: '' });
    this.task(async () => {
      await api.getClient().request('/v1/auth/login', 'POST', { email, password });
      await this.load();
    });
  },
  wechatLogin() {
    if (!this.data.enabled || !this.data.consent) return;
    this.task(async () => {
      const client = api.getClient();
      const attempt = (
        await client.request('/v1/auth/wechat/challenges', 'POST', {
          purpose: 'LOGIN',
          consent: true,
        })
      ).data;
      const code = await wxCode();
      await client.request('/v1/auth/wechat/login', 'POST', {
        challengeId: attempt.challengeId,
        state: attempt.state,
        code,
        consent: true,
      });
      await this.load();
    });
  },
  bind() {
    if (!this.data.user || !this.data.enabled || !this.data.consent) return;
    const password = this.data.password;
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
      await client.request('/v1/auth/wechat/bind', 'POST', {
        challengeId: attempt.challengeId,
        state: attempt.state,
        code,
        consent: true,
      });
      await this.load();
      this.setData({ message: '微信身份已绑定当前应用账号。' });
    });
  },
  unbind() {
    if (!this.data.binding || !this.data.binding.connected || !this.data.consent) return;
    const password = this.data.password,
      expectedVersion = this.data.binding.version;
    this.setData({ password: '' });
    wx.showModal({
      title: '解除微信绑定',
      content: '本操作会退出该账号所有设备，需重新登录。',
      success: (result) => {
        if (result.confirm)
          this.task(async () => {
            await api.getClient().request('/v1/auth/wechat/unbind', 'POST', {
              password,
              expectedVersion,
              consent: true,
            });
            api.getClient().clearSession();
            this.setData({ user: null, binding: null, message: '已解绑并退出所有设备。' });
          });
      },
    });
  },
  logout() {
    this.task(async () => {
      await api.getClient().request('/v1/auth/logout', 'POST');
      api.getClient().clearSession();
      this.setData({ user: null, binding: null, message: '已退出登录。' });
    });
  },
});
