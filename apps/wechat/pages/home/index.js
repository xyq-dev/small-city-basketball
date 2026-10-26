const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');

const privateEvents = {
  signedIn: false,
  featured: [],
  eventTotal: 0,
  hasOrganizations: false,
  eventsError: '',
};
Page({
  data: {
    value: '',
    error: '',
    signedIn: false,
    eventsLoading: false,
    eventsError: '',
    featured: [],
    eventTotal: 0,
    hasOrganizations: false,
    positions: [
      { code: 'PG', name: '控卫', icon: 'pos-pg' },
      { code: 'SG', name: '分卫', icon: 'pos-sg' },
      { code: 'SF', name: '小前', icon: 'pos-sf' },
      { code: 'PF', name: '大前', icon: 'pos-pf' },
      { code: 'C', name: '中锋', icon: 'pos-c' },
    ],
  },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    this.loadEvents();
  },
  onUnload() {
    this._alive = false;
    this._eventsLoad = (this._eventsLoad || 0) + 1;
    ui.close(this);
  },
  // Called through ui.begin's session subscription on 401, logout or account switch.
  onSessionReset() {
    this._eventsLoad = (this._eventsLoad || 0) + 1;
    this.setData({ eventsLoading: false, ...privateEvents });
  },
  async loadEvents() {
    const client = api.getClient();
    const load = (this._eventsLoad = (this._eventsLoad || 0) + 1);
    const current = () => this._alive !== false && load === this._eventsLoad;
    if (!client.hasSession()) {
      this.setData({ eventsLoading: false, ...privateEvents });
      return;
    }
    this.setData({ eventsLoading: true, eventsError: '' });
    let session;
    try {
      session = await events.session(client);
    } catch (error) {
      if (current())
        this.setData({
          eventsLoading: false,
          ...privateEvents,
          signedIn: error.status !== 401,
          eventsError: error.status === 401 ? '' : ui.message(error),
        });
      return;
    }
    if (!current()) return;
    const token = ui.begin(this);
    try {
      const result = await events.load(client, session);
      if (ui.live(this, token) && current())
        this.setData({
          eventsLoading: false,
          ...privateEvents,
          signedIn: true,
          featured: result.featured,
          eventTotal: result.total,
          hasOrganizations: result.organizations.length > 0,
        });
    } catch (error) {
      // A session change has already cleared the page through onSessionReset.
      if (ui.live(this, token) && current())
        this.setData({
          eventsLoading: false,
          ...privateEvents,
          signedIn: true,
          eventsError: ui.message(error),
        });
    }
  },
  openEvents() {
    ui.open('watch');
  },
  openEvent(e) {
    const { org, id } = e.currentTarget.dataset;
    try {
      ui.open('org-event', { orgId: api.uuid(org), eventId: api.uuid(id) });
    } catch {
      this.setData({ eventsError: '赛事入口无效，请刷新后重试。' });
    }
  },
  login() {
    ui.login('/pages/home/index');
  },
  openPlayers() {
    ui.open('players');
  },
  position(e) {
    const position = e.currentTarget.dataset.position;
    if (['PG', 'SG', 'SF', 'PF', 'C'].includes(position)) ui.open('players', { position });
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
  account() {
    ui.open('account');
  },
  go(e) {
    ui.open(e.currentTarget.dataset.page);
  },
});
