const api = require('../../utils/api');
const ui = require('../../utils/ui');
const orgRoles = ['ORG_ADMIN', 'EVENT_MANAGER', 'REVIEWER', 'SCORER', 'STREAMER'];
const eventRoles = ['EVENT_MANAGER', 'REVIEWER', 'SCORER', 'STREAMER'];
Page({
  data: {
    organizations: [],
    selectedOrg: 0,
    eventId: '',
    userId: '',
    type: 'MEMBER',
    roles: orgRoles,
    roleIndex: 0,
    disabled: false,
    workspace: null,
    members: [],
    staff: [],
    loginRequired: false,
    busy: false,
    pending: false,
    message: '',
    error: '',
  },
  onLoad(q) {
    this._org = q.orgId || null;
    this.setData({ eventId: q.eventId || '' });
  },
  onShow() {
    this._closed = false;
    this.load();
  },
  onHide() {
    ui.close(this);
    this.clear();
  },
  onUnload() {
    this.onHide();
  },
  onSessionReset() {
    this.clear();
  },
  clear() {
    this._viewer = null;
    this._pending = null;
    this.setData({
      organizations: [],
      workspace: null,
      members: [],
      staff: [],
      userId: '',
      busy: false,
      pending: false,
    });
  },
  key() {
    return 'scb-staff-command-v1:' + this._viewer + ':' + this._org;
  },
  path() {
    return '/v1/orgs/' + api.uuid(this._org) + '/staff-configuration';
  },
  async load() {
    if (this.data.busy) return;
    const t = ui.begin(this);
    const s = await ui.session(this, '/pages/staff-configuration/index');
    if (!s || !ui.live(this, t)) return;
    const orgs = s.organizations.filter((o) => ['ORG_OWNER', 'ORG_ADMIN'].includes(o.role));
    this._viewer = s.user.id;
    if (!orgs.some((o) => o.id === this._org)) this._org = orgs[0]?.id;
    this.setData({
      organizations: orgs,
      selectedOrg: orgs.findIndex((o) => o.id === this._org),
      error: '',
    });
    if (!this._org) {
      this.setData({ error: '当前没有可管理的机构权限' });
      return;
    }
    try {
      this._pending = wx.getStorageSync(this.key()) || null;
      const q = this.data.eventId ? '?eventId=' + api.uuid(this.data.eventId) : '';
      const w = (await api.getClient().request(this.path() + q)).data;
      if (ui.live(this, t))
        this.setData({
          workspace: w,
          members: w.members,
          staff: w.staff,
          pending: !!this._pending,
        });
    } catch (e) {
      if (ui.live(this, t)) this.setData({ error: ui.message(e) });
    }
  },
  input(e) {
    if (
      !this.data.busy &&
      !this.data.pending &&
      ['eventId', 'userId'].includes(e.currentTarget.dataset.field)
    )
      this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  organization(e) {
    if (this.data.busy || this.data.pending) return;
    this._org = this.data.organizations[Number(e.detail.value)]?.id;
    this.setData({ workspace: null, userId: '' });
    this.load();
  },
  type(e) {
    if (this.data.busy || this.data.pending) return;
    const type = e.currentTarget.dataset.type;
    if (!['MEMBER', 'STAFF'].includes(type)) return;
    this.setData({ type, roles: type === 'STAFF' ? eventRoles : orgRoles, roleIndex: 0 });
  },
  role(e) {
    if (!this.data.busy && !this.data.pending) this.setData({ roleIndex: Number(e.detail.value) });
  },
  status(e) {
    if (!this.data.busy && !this.data.pending) this.setData({ disabled: e.detail.value === true });
  },
  select(e) {
    if (this.data.busy || this.data.pending) return;
    this.setData({ userId: e.currentTarget.dataset.id });
  },
  async save() {
    const w = this.data.workspace;
    if (this.data.busy || this.data.pending || !w) return;
    const staff = this.data.type === 'STAFF';
    if (!(staff ? w.capabilities.canManageStaff : w.capabilities.canManageMembers)) return;
    this.setData({ busy: true });
    const before = ui.guard(this);
    const confirmed = await ui.confirmOp(
      this,
      '确认权限变更',
      '请核对目标用户和角色。停用后该用户将失去对应权限；机构负责人不能在本页修改。',
    );
    if (!confirmed || !confirmed.valid()) {
      if (ui.held(this, before)) this.setData({ busy: false });
      return;
    }
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      const id = await ui.uuid();
      if (!confirmed.valid() || !ui.held(this, t)) return;
      const userId = api.uuid(this.data.userId),
        row = (staff ? w.staff : w.members).find((r) => r.id === userId);
      const command = {
        clientRequestId: id,
        type: this.data.type,
        userId,
        eventId: staff ? api.uuid(this.data.eventId) : null,
        role: this.data.roles[this.data.roleIndex],
        status: this.data.disabled ? 'DISABLED' : 'ACTIVE',
        expectedVersion: row ? row.version : null,
      };
      this._pending = { actor: this._viewer, org: this._org, command };
      wx.setStorageSync(this.key(), this._pending);
      this.setData({ pending: true });
      await this.send(t);
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async send(t) {
    const p = this._pending;
    if (!p || p.actor !== this._viewer || p.org !== this._org || !ui.held(this, t)) return;
    const key = 'scb-staff-command-v1:' + p.actor + ':' + p.org;
    const clear = () => {
      const current = wx.getStorageSync(key);
      if (current?.command?.clientRequestId === p.command.clientRequestId)
        wx.removeStorageSync(key);
    };
    try {
      await api.getClient().request(this.path() + '/commands', 'POST', p.command);
      clear();
      if (this._pending?.command?.clientRequestId === p.command.clientRequestId)
        this._pending = null;
      if (ui.held(this, t))
        this.setData({ pending: false, message: '权限变更已确认，请刷新查看当前状态。' });
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status)) {
        clear();
        if (this._pending?.command?.clientRequestId === p.command.clientRequestId)
          this._pending = null;
      }
      if (ui.held(this, t)) this.setData({ pending: !!this._pending, error: ui.message(e) });
    }
  },
  async retry() {
    if (this.data.busy || !this._pending) return;
    const t = ui.hold(this);
    this.setData({ busy: true });
    try {
      await this.send(t);
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  login() {
    ui.login('/pages/staff-configuration/index');
  },
});
