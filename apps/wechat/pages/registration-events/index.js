const api = require('../../utils/api');
const ui = require('../../utils/ui');
const registration = require('../../utils/registration');
function view(rows) {
  return rows.map((r) => ({
    ...r,
    id: r.event.id,
    statusLabel: registration.stateLabel(r.event.status),
    entryStatus: r.entry ? registration.stateLabel(r.entry.status) : '',
  }));
}
Page({
  data: {
    team: null,
    events: [],
    nextCursor: null,
    loading: false,
    busy: false,
    error: '',
    message: '',
    loginRequired: false,
  },
  onLoad(query) {
    this._alive = true;
    try {
      this._org = registration.id(query.orgId);
      this._team = registration.id(query.teamId);
    } catch (error) {
      this._routeError = ui.message(error);
      this.setData({ error: this._routeError });
    }
  },
  onShow() {
    if (this._revision !== undefined && api.getClient().sessionRevision() !== this._revision)
      this.setData({ busy: false });
    this.load();
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  path() {
    return '/pages/registration-events/index?orgId=' + this._org + '&teamId=' + this._team;
  },
  login() {
    ui.login(this.path());
  },
  async load() {
    if (this._routeError || this.data.busy) return;
    this.setData({
      team: null,
      events: [],
      nextCursor: null,
      loading: true,
      error: '',
      loginRequired: false,
    });
    ui.begin(this);
    const session = await ui.session(this, this.path());
    if (!this._alive) return;
    if (!session) {
      this.setData({ loading: false });
      return;
    }
    this._viewer = session.user.id;
    this._revision = api.getClient().sessionRevision();
    const token = ui.begin(this),
      repo = registration.createRepository(this._org);
    try {
      const team = await repo.team(this._team),
        result = await repo.events(this._team);
      if (ui.live(this, token))
        this.setData({
          team,
          events: view(result.items),
          nextCursor: result.nextCursor,
          loading: false,
        });
    } catch (error) {
      if (ui.live(this, token))
        this.setData({ team: null, events: [], loading: false, error: ui.message(error) });
    }
  },
  async more() {
    if (!this.data.nextCursor || this.data.loading || this.data.busy) return;
    const session = await ui.session(this, this.path());
    if (!session || !this._alive || session.user.id !== this._viewer) {
      if (this._alive) this.load();
      return;
    }
    const token = ui.begin(this),
      cursor = this.data.nextCursor;
    this.setData({ loading: true, error: '' });
    try {
      const result = await registration.createRepository(this._org).events(this._team, cursor);
      if (ui.live(this, token))
        this.setData({
          events: registration.mergePage(this.data.events, view(result.items), 'eventId'),
          nextCursor: result.nextCursor,
          loading: false,
        });
    } catch (error) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  async enter(e) {
    if (this.data.busy) return;
    const eventId = e.currentTarget.dataset.id,
      item = this.data.events.find((r) => r.event.id === eventId);
    if (!item) return;
    if (item.entry) {
      ui.open('entry', { orgId: this._org, entryId: item.entry.id });
      return;
    }
    if (!item.capabilities.canCreateEntry) return;
    if (
      !(await ui.confirm(
        '创建本队报名草稿',
        '仅为' + this.data.team.name + '创建本届报名草稿，之后需保存名单并明确提交审核。',
      ))
    )
      return;
    const session = await ui.session(this, this.path());
    if (!this._alive || !session || session.user.id !== this._viewer) {
      if (this._alive) this.load();
      return;
    }
    const token = ui.begin(this),
      repo = registration.createRepository(this._org);
    this.setData({ busy: true, error: '', message: '' });
    try {
      const entry = await repo.createEntry(eventId, this._team);
      if (ui.live(this, token)) {
        this.setData({ busy: false });
        ui.open('entry', { orgId: this._org, entryId: entry.id });
      }
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          busy: false,
          error: ui.message(error),
          message: '请先刷新本队报名列表核对结果。已存在的本队报名不会再次创建。',
        });
    }
  },
});
