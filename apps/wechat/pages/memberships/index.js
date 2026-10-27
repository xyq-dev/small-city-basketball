const ui = require('../../utils/ui');
const tm = require('../../utils/team-membership');
const PATH = '/pages/memberships/index';
const view = (m) => ({
  ...m,
  stateText: m.status === 'ACTIVE' ? '有效成员' : tm.endedReason(m.endedReason) || '已结束',
  since: ui.localTime(m.createdAt, true),
});
// "My memberships": my own player bindings, a read-only team view (team name and current
// long-term member names only) and leaving a team. Never a management entry.
Page({
  data: {
    items: [],
    team: null,
    loading: false,
    busy: false,
    uncertain: false,
    error: '',
    message: '',
    loginRequired: false,
  },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    if (!this.data.busy) this.load();
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  login() {
    ui.login('');
  },
  async load() {
    if (this.data.busy) return;
    this.setData({ loading: true, error: '', items: [], team: null });
    ui.begin(this);
    const session = await ui.session(this, PATH);
    if (!this._alive) return;
    if (!session) {
      this.setData({ loading: false });
      return;
    }
    this._viewer = session.user.id;
    const token = ui.begin(this);
    try {
      const items = await tm.createRepository().memberships();
      if (ui.live(this, token)) this.setData({ loading: false, items: items.map(view) });
    } catch (error) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  async open(e) {
    const item = this.data.items.find((m) => m.bindingId === e.currentTarget.dataset.id);
    if (!item || item.status !== 'ACTIVE' || this.data.busy) return;
    const token = ui.begin(this);
    this.setData({ team: null, error: '' });
    try {
      const team = await tm.createRepository().membershipTeam(item.bindingId);
      if (ui.live(this, token)) this.setData({ team });
    } catch (error) {
      if (ui.live(this, token)) this.setData({ error: ui.message(error) });
    }
  },
  closeTeam() {
    this.setData({ team: null });
  },
  async leave(e) {
    const item = this.data.items.find((m) => m.bindingId === e.currentTarget.dataset.id);
    if (!item || item.status !== 'ACTIVE') return;
    await tm.confirmedWrite(this, ui, {
      title: '退出球队',
      content:
        '退出“' +
        item.teamName +
        '”后，你的成员“' +
        item.memberName +
        '”将移出长期名单；已冻结的报名名单不变。再次加入需要领队签发新的加入码。',
      path: PATH,
      send: () => tm.createRepository().leave(item.bindingId),
      done: async (updated) =>
        this.setData({
          items: this.data.items.map((m) =>
            m.bindingId === updated.bindingId ? view(updated) : m,
          ),
          team: null,
          uncertain: false,
          message: '已退出球队。',
        }),
    });
  },
  openJoin() {
    if (!this.data.busy) tm.go('team-join');
  },
  refresh() {
    if (!this.data.busy) this.load();
  },
});
