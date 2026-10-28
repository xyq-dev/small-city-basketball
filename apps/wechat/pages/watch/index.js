const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const recent = require('../../utils/recent');
const directory = require('../../utils/directory');

const privateDefaults = {
  signedIn: false,
  organizations: [],
  sections: [],
  failures: [],
  truncated: [],
  total: 0,
  teamCount: 0,
  eventsError: '',
  creatable: [],
};
Page({
  data: {
    value: '',
    error: '',
    loading: false,
    recentEvents: [],
    ...privateDefaults,
    // Public directory: anonymous and independent of the signed-in account's private list.
    dir: directory.initialState(),
    dirGroups: directory.GROUPS,
  },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    this.setData({ recentEvents: recent.list() });
    this.load();
    // Re-entering always starts the directory from its first page.
    this.loadDirectory();
  },
  // ---- public directory (anonymous) ----
  // Every reset (filter change, refresh, re-entry) starts a new generation; replies from an
  // older generation are dropped, so a slow earlier filter can never overwrite a newer one.
  async loadDirectory() {
    const gen = (this._dirGen = (this._dirGen || 0) + 1);
    this._dirCursor = null;
    const { group, city } = this.data.dir;
    // A reset clears the rows first: a failed refresh never shows old rows as current. It also
    // ends the previous generation's pending "load more": that reply is dropped by generation,
    // so leaving loadingMore set would block every later page of the new generation.
    this.setData({
      'dir.items': [],
      'dir.loading': true,
      'dir.loadingMore': false,
      'dir.error': '',
      'dir.moreError': '',
      'dir.done': false,
      'dir.loaded': false,
    });
    try {
      const page = await directory.fetchPage(api.getClient(), { group, city });
      if (gen !== this._dirGen || this._alive === false) return;
      this._dirCursor = page.nextCursor;
      this.setData({
        'dir.items': directory.merge([], page.items),
        'dir.loading': false,
        'dir.loaded': true,
        'dir.done': !page.nextCursor,
      });
    } catch (error) {
      if (gen !== this._dirGen || this._alive === false) return;
      this.setData({ 'dir.loading': false, 'dir.error': directory.failure(error) });
    }
  },
  async loadMoreDirectory() {
    const cursor = this._dirCursor;
    const d = this.data.dir;
    if (!cursor || d.loading || d.loadingMore) return;
    const gen = this._dirGen;
    this.setData({ 'dir.loadingMore': true, 'dir.moreError': '' });
    try {
      const page = await directory.fetchPage(api.getClient(), {
        group: d.group,
        city: d.city,
        cursor,
      });
      if (gen !== this._dirGen || this._alive === false) return;
      this._dirCursor = page.nextCursor;
      this.setData({
        'dir.items': directory.merge(this.data.dir.items, page.items),
        'dir.loadingMore': false,
        'dir.done': !page.nextCursor,
      });
    } catch (error) {
      if (gen !== this._dirGen || this._alive === false) return;
      // Rows already read stay; only the next page is reported as missing.
      this.setData({
        'dir.loadingMore': false,
        'dir.moreError':
          '后续赛事读取失败，已显示的 ' +
          this.data.dir.items.length +
          ' 届保留：' +
          directory.failure(error),
      });
    }
  },
  pickDirGroup(e) {
    const group = e.currentTarget.dataset.group;
    if (!directory.GROUPS.some((g) => g.value === group) || group === this.data.dir.group) return;
    this.setData({ 'dir.group': group });
    this.loadDirectory();
  },
  dirCityInput(e) {
    this.setData({ 'dir.cityInput': String(e.detail.value || '').slice(0, 40) });
  },
  applyDirCity() {
    const city = directory.normalizeCity(this.data.dir.cityInput);
    if (city === undefined) {
      this.setData({ 'dir.cityError': '城市仅支持中文、字母、数字、空格和“·”，最多20个字。' });
      return;
    }
    this.setData({ 'dir.city': city || '', 'dir.cityInput': city || '', 'dir.cityError': '' });
    this.loadDirectory();
  },
  clearDirCity() {
    this.setData({ 'dir.city': '', 'dir.cityInput': '', 'dir.cityError': '' });
    this.loadDirectory();
  },
  openDirectory(e) {
    try {
      ui.open('event', { event: api.publicId(e.currentTarget.dataset.id) });
    } catch {
      this.loadDirectory();
    }
  },
  openRecent(e) {
    try {
      ui.open('event', { event: api.publicId(e.currentTarget.dataset.id) });
    } catch {
      this.setData({ recentEvents: recent.list() });
    }
  },
  clearRecent() {
    recent.clear();
    this.setData({ recentEvents: [] });
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
      const result = await events.load(client, session, 10);
      // Store only fields listed in privateDefaults, so a session reset clears all of them.
      if (ui.live(this, token) && current())
        this.setData({
          loading: false,
          ...privateDefaults,
          signedIn: true,
          organizations: result.organizations,
          creatable: result.organizations
            .filter((o) => o.role === 'ORG_OWNER' || o.role === 'ORG_ADMIN')
            .slice(0, 3)
            .map((o) => ({ id: o.id, name: o.name })),
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
  createEvent(e) {
    try {
      ui.open('event-setup', { orgId: api.uuid(e.currentTarget.dataset.org) });
    } catch {
      this.setData({ eventsError: '机构入口无效，请刷新后重试。' });
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
