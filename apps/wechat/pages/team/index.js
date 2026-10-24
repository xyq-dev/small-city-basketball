const api = require('../../utils/api');
const ui = require('../../utils/ui');
const registration = require('../../utils/registration');
const rows = (members) => members.map((m) => ({ id: m.id, key: m.id, name: m.name }));
Page({
  data: {
    team: null,
    name: '',
    members: [],
    canRegister: false,
    nameDirty: false,
    membersDirty: false,
    busy: false,
    loading: false,
    uncertain: false,
    error: '',
    message: '',
    loginRequired: false,
  },
  onLoad(query) {
    this._alive = true;
    this._nextDraft = 0;
    try {
      this._org = registration.id(query.orgId);
      this._id = registration.id(query.teamId);
    } catch (error) {
      this._routeError = ui.message(error);
      this.setData({ error: this._routeError });
    }
  },
  onShow() {
    if (this._revision !== undefined && api.getClient().sessionRevision() !== this._revision)
      this.setData({
        team: null,
        name: '',
        members: [],
        nameDirty: false,
        membersDirty: false,
        uncertain: false,
        busy: false,
      });
    if (!this.data.nameDirty && !this.data.membersDirty) this.load();
  },
  onUnload() {
    this._alive = false;
    this._team = null;
    ui.close(this);
  },
  path() {
    return '/pages/team/index?orgId=' + this._org + '&teamId=' + this._id;
  },
  login() {
    ui.login(this.path());
  },
  apply(team) {
    this._team = team;
    this.setData({
      team,
      ...(this.data.nameDirty ? {} : { name: team.name }),
      ...(this.data.membersDirty ? {} : { members: rows(team.members) }),
    });
  },
  async load() {
    if (this._routeError || this.data.busy) return;
    this.setData({
      team: null,
      name: '',
      members: [],
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
    this.setData({
      canRegister: (session.teamContexts || []).some(
        (c) => c.orgId === this._org && c.teamId === this._id,
      ),
    });
    const token = ui.begin(this);
    try {
      const team = await registration.createRepository(this._org).team(this._id);
      if (ui.live(this, token)) {
        this.setData({ nameDirty: false, membersDirty: false, uncertain: false, loading: false });
        this.apply(team);
      }
    } catch (error) {
      if (ui.live(this, token))
        this.setData({ team: null, loading: false, error: ui.message(error) });
    }
  },
  async refresh() {
    if (this.data.busy) return;
    if (
      (this.data.nameDirty || this.data.membersDirty || this.data.uncertain) &&
      !(await ui.confirm(
        '重新读取球队',
        '当前未保存修改将被放弃；未知结果请以重新读取的记录核对。',
      ))
    )
      return;
    this.setData({ nameDirty: false, membersDirty: false });
    this.load();
  },
  inputName(e) {
    if (!this.data.busy) this.setData({ name: e.detail.value, nameDirty: true });
  },
  memberName(e) {
    if (this.data.busy) return;
    const index = Number(e.currentTarget.dataset.index),
      members = this.data.members.map((m) => ({ ...m }));
    if (members[index]) {
      members[index].name = e.detail.value;
      this.setData({ members, membersDirty: true });
    }
  },
  addMember() {
    if (this.data.busy || !this.data.team?.capabilities.canManage || this.data.members.length >= 60)
      return;
    this.setData({
      members: this.data.members.concat({ key: 'draft-' + ++this._nextDraft, name: '' }),
      membersDirty: true,
    });
  },
  removeMember(e) {
    if (this.data.busy || !this.data.team?.capabilities.canManage) return;
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ members: this.data.members.filter((_, i) => i !== index), membersDirty: true });
  },
  async save(e) {
    const mode = e.currentTarget.dataset.mode;
    if (
      !['name', 'members'].includes(mode) ||
      this.data.busy ||
      this.data.uncertain ||
      !this._team?.capabilities.canManage
    )
      return;
    const expected = this._team.version;
    let draft;
    try {
      draft =
        mode === 'name'
          ? registration.text(this.data.name, '球队名称')
          : registration.normalizeMembers(this.data.members);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const token = ui.begin(this),
      org = this._org,
      teamId = this._id,
      viewer = this._viewer,
      path = this.path();
    this._saveToken = token;
    this.setData({ busy: true, error: '', message: '' });
    let sent = false;
    try {
      if (
        mode === 'members' &&
        !(await ui.confirm(
          '保存长期成员',
          '本次长期名单将按当前编辑保存，移出的成员不再出现在新报名选择中；历史及冻结名单保持原记录。',
        ))
      )
        return;
      if (!ui.live(this, token)) return;
      const session = await ui.session(this, path);
      if (!ui.live(this, token) || !this._alive || !session) return;
      if (session.user.id !== viewer) {
        this._team = null;
        this.setData({
          team: null,
          name: '',
          members: [],
          nameDirty: false,
          membersDirty: false,
          loginRequired: true,
          error: '登录身份已变化，请重新读取当前资料。',
        });
        return;
      }
      const repo = registration.createRepository(org),
        fresh = await repo.team(teamId);
      if (!ui.live(this, token)) return;
      registration.versionMatch(fresh, expected);
      if (!fresh.capabilities.canManage) throw new Error('当前球队管理权限已变化，请刷新');
      sent = true;
      const team =
        mode === 'name'
          ? await repo.updateTeam(teamId, expected, draft)
          : await repo.members(teamId, expected, draft);
      if (ui.live(this, token)) {
        this.setData({
          [mode === 'name' ? 'nameDirty' : 'membersDirty']: false,
          message:
            mode === 'name' ? '球队名称已保存。' : '长期成员已保存；本届报名名单需单独核对。',
        });
        this.apply(team);
      }
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          error: ui.message(error),
          uncertain: sent && (!error.status || error.status >= 500),
          message:
            sent && (!error.status || error.status >= 500)
              ? '保存结果待核对。请刷新当前球队后再进行新修改。'
              : '',
        });
    } finally {
      if (this._saveToken === token) {
        this._saveToken = null;
        if (this._alive && ui.live(this, token)) this.setData({ busy: false });
      }
    }
  },
  async events() {
    if (this.data.busy) return;
    if (
      (this.data.nameDirty || this.data.membersDirty) &&
      !(await ui.confirm(
        '前往本届报名',
        '还有未保存的长期资料。继续将保留当前页面草稿，报名仍使用服务器已保存的成员。',
      ))
    )
      return;
    ui.open('registration-events', { orgId: this._org, teamId: this._id });
  },
});
