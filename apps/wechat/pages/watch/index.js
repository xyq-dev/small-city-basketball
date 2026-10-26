const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');

const privateDefaults = {
  signedIn: false,
  organizations: [],
  sections: [],
  failures: [],
  truncated: [],
  total: 0,
  teamCount: 0,
  eventsError: '',
};
Page({
  data: { value: '', error: '', loading: false, ...privateDefaults },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    this.load();
  },
  onUnload() {
    this._alive = false;
    this._load = (this._load || 0) + 1;
    ui.close(this);
  },
  // Called through ui.begin's session subscription on 401, logout or account switch.
  // The public watch-link input is not private and is kept.
  onSessionReset() {
    this._load = (this._load || 0) + 1;
    this.setData({ loading: false, ...privateDefaults });
  },
  async load() {
    const client = api.getClient();
    const load = (this._load = (this._load || 0) + 1);
    const current = () => this._alive !== false && load === this._load;
    if (!client.hasSession()) {
      this.setData({ loading: false, ...privateDefaults });
      return;
    }
    this.setData({ loading: true, eventsError: '' });
    let session;
    try {
      session = await events.session(client);
    } catch (error) {
      // Never keep another account's private list on screen.
      if (current())
        this.setData({
          loading: false,
          ...privateDefaults,
          signedIn: error.status !== 401,
          eventsError: error.status === 401 ? '' : ui.message(error),
        });
      return;
    }
    if (!current()) return;
    const token = ui.begin(this);
    try {
      const result = await events.load(client, session);
      // Store only fields listed in privateDefaults, so a session reset clears all of them.
      if (ui.live(this, token) && current())
        this.setData({
          loading: false,
          ...privateDefaults,
          signedIn: true,
          organizations: result.organizations,
          sections: result.sections,
          failures: result.failures,
          truncated: result.truncated,
          total: result.total,
          teamCount: result.teamCount,
        });
    } catch (error) {
      // A session change has already cleared the page through onSessionReset.
      if (ui.live(this, token) && current())
        this.setData({
          loading: false,
          ...privateDefaults,
          signedIn: true,
          eventsError: ui.message(error),
        });
    }
  },
  login() {
    ui.login('/pages/watch/index');
  },
  openEvent(e) {
    const { org, id } = e.currentTarget.dataset;
    try {
      ui.open('org-event', { orgId: api.uuid(org), eventId: api.uuid(id) });
    } catch {
      this.setData({ eventsError: '赛事入口无效，请刷新后重试。' });
    }
  },
  teams() {
    ui.open('teams');
  },
  input(e) {
    this.setData({ value: e.detail.value });
  },
  open() {
    try {
      const event = api.eventFromInput(this.data.value);
      this.setData({ error: '' });
      ui.open('event', { event });
    } catch {
      this.setData({ error: '请输入主办方提供的有效观赛链接或43位公开编号。' });
    }
  },
});
