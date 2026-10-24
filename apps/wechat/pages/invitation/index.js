const api = require('../../utils/api');
const ui = require('../../utils/ui');
const registration = require('../../utils/registration');
Page({
  data: {
    invitationId: '',
    tokenVisible: true,
    consent: false,
    user: null,
    accepted: null,
    busy: false,
    error: '',
    message: '',
    loginRequired: false,
  },
  onLoad(query) {
    this._alive = true;
    this._token = '';
    if (query.id || query.invitationId) {
      try {
        this.setData({ invitationId: registration.id(query.id || query.invitationId) });
      } catch (error) {
        this.setData({ error: ui.message(error) });
      }
    }
    if (typeof query.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(query.token))
      this._token = query.token;
  },
  onShow() {
    this.setData({ tokenVisible: true });
    this.load();
  },
  onHide() {
    this._token = '';
    this.setData({
      tokenVisible: false,
      consent: false,
      message: '返回本页后需重新填写邀请凭据；凭据不会保存或分享。',
    });
  },
  onUnload() {
    this._alive = false;
    this._token = '';
    ui.close(this);
  },
  login() {
    ui.login(
      '/pages/invitation/index' +
        (this.data.invitationId ? '?invitationId=' + this.data.invitationId : ''),
    );
  },
  async load() {
    this.setData({ user: null, accepted: null, consent: false, loginRequired: false });
    ui.begin(this);
    const session = await ui.session(this, '/pages/invitation/index');
    if (!this._alive) return;
    if (session) {
      if (this._viewer && this._viewer !== session.user.id) this._token = '';
      this._viewer = session.user.id;
      this._revision = api.getClient().sessionRevision();
      this.setData({ user: session.user, busy: false });
    }
  },
  invitation(e) {
    if (!this.data.busy) this.setData({ invitationId: e.detail.value, consent: false });
  },
  token(e) {
    if (!this.data.busy) {
      this._token = e.detail.value;
      this.setData({ consent: false });
    }
  },
  consent(e) {
    this.setData({ consent: Array.isArray(e.detail.value) && e.detail.value.includes('yes') });
  },
  async accept() {
    if (this.data.busy || !this.data.consent || !this.data.user) return;
    let invitationId;
    try {
      invitationId = registration.id(this.data.invitationId);
      if (!/^[A-Za-z0-9_-]{43}$/.test(this._token)) throw new Error('请重新填写有效的43位邀请凭据');
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    if (
      !(await ui.confirm(
        '以当前账号接受球队授权',
        '请确认当前登录账号是邀请的目标账号。服务端将核验邀请对象、期限及发布者当前权限。',
      ))
    )
      return;
    const session = await ui.session(this, '/pages/invitation/index');
    if (!this._alive || !session || session.user.id !== this._viewer) {
      this._token = '';
      if (this._alive) this.load();
      return;
    }
    const token = ui.begin(this),
      secret = this._token;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const accepted = await registration.acceptInvitation(invitationId, secret);
      if (ui.live(this, token)) {
        this._token = '';
        this.setData({
          accepted,
          busy: false,
          consent: false,
          message: '球队授权已接受，请在我的球队中核对当前权限。',
        });
      }
    } catch (error) {
      if (ui.live(this, token))
        this.setData({ busy: false, consent: false, error: ui.message(error) });
    }
  },
  openTeam() {
    if (this.data.accepted)
      ui.open('team', { orgId: this.data.accepted.orgId, teamId: this.data.accepted.teamId });
  },
});
