const api = require('../../utils/api');
const ui = require('../../utils/ui');
const registration = require('../../utils/registration');
Page({
  data: {
    teams: [],
    organizations: [],
    selectedOrg: '',
    orgIndex: 0,
    nextCursor: null,
    canCreateTeam: false,
    loading: false,
    busy: false,
    error: '',
    message: '',
    loginRequired: false,
    newName: '',
    uncertain: false,
  },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    if (this._revision !== undefined && api.getClient().sessionRevision() !== this._revision)
      this.setData({ busy: false, newName: '', uncertain: false });
    this.load();
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  login() {
    ui.login('/pages/teams/index');
  },
  async load() {
    if (this.data.busy) return;
    this.setData({
      teams: [],
      organizations: [],
      nextCursor: null,
      canCreateTeam: false,
      loading: true,
      error: '',
      loginRequired: false,
    });
    ui.begin(this);
    const session = await ui.session(this, '/pages/teams/index');
    if (!this._alive) return;
    if (!session) {
      this.setData({ loading: false });
      return;
    }
    const token = ui.begin(this);
    const organizations = (session.organizations || []).map((o) => ({
      id: o.id,
      name: o.name,
      role: o.role,
    }));
    for (const c of session.teamContexts || [])
      if (!organizations.some((o) => o.id === c.orgId))
        organizations.push({ id: c.orgId, name: c.organizationName, role: 'TEAM_MANAGER' });
    const selected = organizations.find((o) => o.id === this.data.selectedOrg) || organizations[0];
    this._viewer = session.user.id;
    this._revision = api.getClient().sessionRevision();
    this._contexts = session.teamContexts || [];
    this.setData({
      organizations,
      selectedOrg: selected ? selected.id : '',
      orgIndex: selected ? organizations.indexOf(selected) : 0,
    });
    if (!selected) {
      this.setData({ loading: false });
      return;
    }
    try {
      const result = await registration.createRepository(selected.id).teams();
      if (ui.live(this, token))
        this.setData({
          teams: result.items.map((t) => ({
            ...t,
            canRegister: this._contexts.some((c) => c.orgId === t.orgId && c.teamId === t.id),
          })),
          nextCursor: result.nextCursor,
          canCreateTeam: result.canCreateTeam,
          loading: false,
        });
    } catch (error) {
      if (ui.live(this, token))
        this.setData({ teams: [], loading: false, error: ui.message(error) });
    }
  },
  async more() {
    if (!this.data.nextCursor || this.data.loading || this.data.busy) return;
    const session = await ui.session(this, '/pages/teams/index');
    if (!this._alive || !session || session.user.id !== this._viewer) {
      if (this._alive) this.load();
      return;
    }
    const org = this.data.selectedOrg,
      cursor = this.data.nextCursor;
    const token = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      const result = await registration.createRepository(org).teams(cursor);
      if (ui.live(this, token) && this.data.selectedOrg === org)
        this.setData({
          teams: registration.mergePage(
            this.data.teams,
            result.items.map((t) => ({
              ...t,
              canRegister: this._contexts.some((c) => c.orgId === t.orgId && c.teamId === t.id),
            })),
          ),
          nextCursor: result.nextCursor,
          loading: false,
        });
    } catch (error) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  selectOrg(e) {
    if (this.data.busy) return;
    this.setData({
      selectedOrg: this.data.organizations[Number(e.detail.value)]?.id || '',
      newName: '',
      uncertain: false,
    });
    this.load();
  },
  input(e) {
    this.setData({ newName: e.detail.value });
  },
  team(e) {
    ui.open('team', { orgId: this.data.selectedOrg, teamId: e.currentTarget.dataset.id });
  },
  events(e) {
    ui.open('registration-events', {
      orgId: this.data.selectedOrg,
      teamId: e.currentTarget.dataset.id,
    });
  },
  invitation() {
    ui.open('invitation');
  },
  async create() {
    if (this.data.busy || !this.data.canCreateTeam || this.data.uncertain) return;
    let intent;
    try {
      intent = {
        org: registration.id(this.data.selectedOrg),
        name: registration.text(this.data.newName, '球队名称'),
        viewer: this._viewer,
        sessionRevision: api.getClient().sessionRevision(),
      };
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    // Freeze the institution and reviewed name before the first asynchronous
    // preflight; a picker change must never retarget an existing create intent.
    this._createIntent = intent;
    const preflight = ui.begin(this);
    this.setData({ busy: true, error: '', message: '' });
    let session;
    try {
      session = await ui.session(this, '/pages/teams/index');
    } catch (error) {
      if (this._alive && this._createIntent === intent) {
        this._createIntent = null;
        this.setData({ busy: false, error: ui.message(error) });
      }
      return;
    }
    if (this._createIntent !== intent) return;
    if (
      !this._alive ||
      !session ||
      !ui.live(this, preflight) ||
      session.user.id !== intent.viewer ||
      api.getClient().sessionRevision() !== intent.sessionRevision ||
      this.data.selectedOrg !== intent.org ||
      this.data.newName.trim() !== intent.name ||
      !this.data.canCreateTeam ||
      this.data.uncertain
    ) {
      this._createIntent = null;
      if (this._alive) {
        this.setData({ busy: false, error: '创建上下文已变化，请重新核对机构、账号和球队名称。' });
        if (!session || session.user.id !== intent.viewer) this.load();
      }
      return;
    }
    const token = ui.begin(this);
    try {
      const result = await registration.createRepository(intent.org).createTeam(intent.name);
      if (ui.live(this, token)) {
        this.setData({ busy: false, newName: '' });
        ui.open('team', { orgId: intent.org, teamId: result.id });
      }
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          busy: false,
          error: ui.message(error),
          uncertain: !error.status || error.status >= 500,
          message:
            !error.status || error.status >= 500
              ? '创建结果待核对，请先刷新球队列表；不要重复创建。'
              : '',
        });
    } finally {
      if (this._createIntent === intent) this._createIntent = null;
    }
  },
  async acknowledgeUnknown() {
    if (!this.data.uncertain || this.data.busy) return;
    await this.load();
    if (!this._alive || this.data.error) return;
    if (
      await ui.confirm('先核对球队列表', '请确认已核对本次创建结果；重新创建可能产生另一支球队。')
    )
      this.setData({ uncertain: false, message: '' });
  },
});
