const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
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
    this._eventsRequest = (this._eventsRequest || 0) + 1;
  },
  async loadEvents() {
    const client = api.getClient();
    const request = (this._eventsRequest = (this._eventsRequest || 0) + 1);
    const session = client.sessionRevision();
    const live = () =>
      this._alive !== false &&
      request === this._eventsRequest &&
      session === client.sessionRevision();
    const empty = {
      signedIn: false,
      featured: [],
      eventTotal: 0,
      hasOrganizations: false,
      eventsError: '',
    };
    if (!client.hasSession()) {
      this.setData({ eventsLoading: false, ...empty });
      return;
    }
    this.setData({ eventsLoading: true, eventsError: '' });
    try {
      const result = await events.fetch(client);
      if (live())
        this.setData({
          eventsLoading: false,
          ...empty,
          signedIn: result.signedIn,
          featured: result.featured || [],
          eventTotal: result.total || 0,
          hasOrganizations: !!(result.organizations && result.organizations.length),
        });
    } catch (error) {
      if (live())
        this.setData({
          eventsLoading: false,
          ...empty,
          signedIn: error.status !== 401,
          eventsError: error.status === 401 ? '' : ui.message(error),
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
