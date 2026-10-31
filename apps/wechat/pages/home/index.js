const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const directory = require('../../utils/directory');
const cities = require('../../utils/city-preference');
const localServices = require('../../utils/local-services');

const privateEvents = {
  signedIn: false,
  featured: [],
  eventTotal: 0,
  hasOrganizations: false,
  eventsError: '',
};
Page({
  data: {
    sponsorVisible: false,
    value: '',
    error: '',
    signedIn: false,
    eventsLoading: false,
    eventsError: '',
    featured: [],
    eventTotal: 0,
    hasOrganizations: false,
    citySelection: { label: '全国', source: '全国浏览', guide: true, warning: '' },
    publicEvents: [],
    publicLoading: false,
    publicLoaded: false,
    publicError: '',
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
    this._hidden = false;
    this.setData({ citySelection: cities.snapshot(), sponsorVisible: true });
    this.loadPublicEvents();
    this.loadEvents();
  },
  onHide() {
    this._hidden = true;
    this.setData({ sponsorVisible: false });
    this._publicLoad = (this._publicLoad || 0) + 1;
  },
  onUnload() {
    this._alive = false;
    this._eventsLoad = (this._eventsLoad || 0) + 1;
    this._publicLoad = (this._publicLoad || 0) + 1;
    ui.close(this);
  },
  chooseCity() {
    ui.open('city-select');
  },
  nationwide() {
    this.setData({ citySelection: cities.choose('') });
    this.loadPublicEvents();
  },
  async loadPublicEvents() {
    if (this._alive === false || this._hidden) return;
    const load = (this._publicLoad = (this._publicLoad || 0) + 1);
    const current = () => this._alive !== false && !this._hidden && load === this._publicLoad;
    const selection = cities.snapshot();
    this.setData({
      citySelection: selection,
      publicEvents: [],
      publicLoading: true,
      publicLoaded: false,
      publicError: '',
    });
    try {
      const result = await directory.fetchPage(api.getClient(), {
        group: 'LIVE',
        ...cities.query(selection),
      });
      if (current())
        this.setData({
          publicEvents: result.items.slice(0, 3),
          publicLoading: false,
          publicLoaded: true,
        });
    } catch (error) {
      if (current()) this.setData({ publicLoading: false, publicError: directory.failure(error) });
    }
  },
  openPublicEvent(e) {
    try {
      ui.open('event', { event: api.publicId(e.currentTarget.dataset.id) });
    } catch {
      this.loadPublicEvents();
    }
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
  openLocal() {
    localServices.open('local');
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
