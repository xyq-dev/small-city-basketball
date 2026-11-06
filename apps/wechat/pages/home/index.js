const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const directory = require('../../utils/directory');
const cities = require('../../utils/city-preference');
const localServices = require('../../utils/local-services');
const figmaPreview = require('../../utils/figma-preview');

const privateEvents = {
  signedIn: false,
  featured: [],
  eventTotal: 0,
  hasOrganizations: false,
  eventsError: '',
};
Page({
  data: {
    uiPreview: false,
    contentHeight: 608,
    sponsorVisible: false,
    value: '',
    error: '',
    signedIn: false,
    eventsLoading: false,
    eventsError: '',
    featured: [],
    eventTotal: 0,
    hasOrganizations: false,
    citySelection: {
      mode: 'NATIONWIDE',
      label: '全国',
      source: '全国浏览',
      guide: true,
      warning: '',
    },
    publicEvents: [],
    publicLoading: false,
    publicLoaded: false,
    publicError: '',
    statusBarHeight: 47,
    capsuleGap: 96,
    positions: [
      { code: 'PG', name: '控卫', icon: 'pos-pg' },
      { code: 'SG', name: '分卫', icon: 'pos-sg' },
      { code: 'SF', name: '小前', icon: 'pos-sf' },
      { code: 'PF', name: '大前', icon: 'pos-pf' },
      { code: 'C', name: '中锋', icon: 'pos-c' },
    ],
  },
  onLoad(query = {}) {
    this._alive = true;
    this.uiPreview = figmaPreview.enabled(query, wx);
    this.setData({ uiPreview: this.uiPreview });
  },
  onShow() {
    this._hidden = false;
    this.syncChrome();
    if (this.uiPreview) {
      this.setData({
        sponsorVisible: false,
        citySelection: {
          mode: 'CITY',
          label: '高州',
          source: 'Figma UI 预览',
          guide: false,
          warning: '',
        },
        publicEvents: [
          {
            publicEventId: 'figma-ui-preview',
            name: '城市篮球邀请赛',
            displayCity: '广东 · 高州',
            venueName: '高州',
            dateLabel: '11.08—11.22',
            statusLabel: '报名中',
          },
        ],
        publicLoading: false,
        publicLoaded: true,
        publicError: '',
        eventsLoading: false,
        ...privateEvents,
      });
      return;
    }
    this.setData({ citySelection: cities.snapshot(), sponsorVisible: true });
    this.loadPublicEvents();
    this.loadEvents();
  },
  onResize() {
    this._headerHeight = 0;
    this.syncChrome();
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
  syncChrome() {
    let statusBarHeight = this.data.statusBarHeight;
    let capsuleGap = this.data.capsuleGap;
    let contentHeight = this.data.contentHeight;
    try {
      const info =
        typeof wx.getWindowInfo === 'function'
          ? wx.getWindowInfo()
          : typeof wx.getSystemInfoSync === 'function'
            ? wx.getSystemInfoSync()
            : null;
      if (
        info &&
        Number.isFinite(info.statusBarHeight) &&
        info.statusBarHeight >= 0 &&
        info.statusBarHeight <= 80
      )
        statusBarHeight = info.statusBarHeight;
      let menu = null;
      if (
        info &&
        Number.isFinite(info.windowWidth) &&
        typeof wx.getMenuButtonBoundingClientRect === 'function'
      ) {
        menu = wx.getMenuButtonBoundingClientRect();
        if (menu && Number.isFinite(menu.left) && menu.left > 0 && menu.left < info.windowWidth)
          capsuleGap = Math.min(160, Math.max(72, info.windowWidth - menu.left + 8));
      }
      if (info && Number.isFinite(info.windowHeight) && Number.isFinite(info.windowWidth)) {
        const screenHeight = Number.isFinite(info.screenHeight)
          ? info.screenHeight
          : info.windowHeight;
        const safeBottom =
          info.safeArea && Number.isFinite(info.safeArea.bottom)
            ? Math.max(0, screenHeight - info.safeArea.bottom)
            : 0;
        const bottomSpace = Math.max(8, 12 - Math.max(0, statusBarHeight - 44));
        const capsuleRow =
          info.windowWidth <= 360
            ? menu && Number.isFinite(menu.bottom)
              ? Math.max(44, Math.ceil(menu.bottom - statusBarHeight + 5))
              : 44
            : 0;
        const headerHeight =
          Number.isFinite(this._headerHeight) && this._headerHeight > 0
            ? this._headerHeight
            : statusBarHeight + capsuleRow + 44 + 8 + 44 + bottomSpace;
        contentHeight = Math.max(320, info.windowHeight - headerHeight - 50 - safeBottom);
      }
    } catch {
      /* The platform draws the real status bar and capsule. */
    }
    this.setData({ statusBarHeight, capsuleGap, contentHeight });
  },
  headerLayout(e) {
    const height = Number(e && e.detail && e.detail.height);
    if (!Number.isFinite(height) || height <= 0 || height === this._headerHeight) return;
    this._headerHeight = height;
    this.syncChrome();
  },
  chooseCity() {
    if (this.uiPreview) return;
    ui.open('city-select');
  },
  nationwide() {
    if (this.uiPreview) return;
    this.setData({ citySelection: cities.choose('') });
    this.loadPublicEvents();
  },
  async loadPublicEvents() {
    if (this.uiPreview) return;
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
    if (this.uiPreview) {
      wx.showToast({ title: 'Figma UI 预览不发起业务请求', icon: 'none' });
      return;
    }
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
    if (this.uiPreview) return;
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
    if (this.uiPreview) return;
    localServices.open('local');
  },
  openCourt() {
    if (this.uiPreview) return;
    localServices.open('local', { kind: 'COURT' });
  },
  openReferee() {
    if (this.uiPreview) return;
    localServices.open('local', { kind: 'REFEREE' });
  },
  openTeamData() {
    if (this.uiPreview) return;
    ui.open('public-archive', { kind: 'TEAM' });
  },
  openSearch() {
    if (this.uiPreview) return;
    ui.open('search');
  },
  openMessages() {
    if (this.uiPreview) return;
    ui.open('messages');
  },
  openEvents() {
    if (this.uiPreview) return;
    ui.open('watch');
  },
  openEvent(e) {
    if (this.uiPreview) return;
    const { org, id } = e.currentTarget.dataset;
    try {
      ui.open('org-event', { orgId: api.uuid(org), eventId: api.uuid(id) });
    } catch {
      this.setData({ eventsError: '赛事入口无效，请刷新后重试。' });
    }
  },
  login() {
    if (this.uiPreview) return;
    ui.login('/pages/home/index');
  },
  openPlayers() {
    if (this.uiPreview) return;
    ui.open('players');
  },
  position(e) {
    if (this.uiPreview) return;
    const position = e.currentTarget.dataset.position;
    if (['PG', 'SG', 'SF', 'PF', 'C'].includes(position)) ui.open('players', { position });
  },
  input(e) {
    this.setData({ value: e.detail.value });
  },
  open() {
    if (this.uiPreview) return;
    try {
      const event = api.eventFromInput(this.data.value);
      this.setData({ error: '' });
      ui.open('event', { event });
    } catch {
      this.setData({ error: '请输入主办方提供的有效观赛链接或43位公开编号。' });
    }
  },
  account() {
    if (this.uiPreview) return;
    ui.open('account');
  },
  go(e) {
    if (this.uiPreview) return;
    ui.open(e.currentTarget.dataset.page);
  },
});
