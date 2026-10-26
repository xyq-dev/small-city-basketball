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
    this._request = (this._request || 0) + 1;
  },
  async load() {
    const client = api.getClient();
    const request = (this._request = (this._request || 0) + 1);
    const session = client.sessionRevision();
    const live = () =>
      this._alive !== false && request === this._request && session === client.sessionRevision();
    if (!client.hasSession()) {
      this.setData({ loading: false, ...privateDefaults });
      return;
    }
    this.setData({ loading: true, eventsError: '' });
    try {
      const result = await events.fetch(client);
      if (live()) this.setData({ loading: false, ...privateDefaults, ...result });
    } catch (error) {
      // Never keep another account's private list on screen.
      if (live())
        this.setData({
          loading: false,
          ...privateDefaults,
          signedIn: error.status !== 401,
          eventsError: error.status === 401 ? '' : ui.message(error),
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
