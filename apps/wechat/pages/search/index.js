const api = require('../../utils/api');
const ui = require('../../utils/ui');
Page({
  data: {
    query: '',
    city: '',
    kind: 'ALL',
    kinds: [
      { key: 'ALL', label: '全部' },
      { key: 'EVENT', label: '赛事' },
      { key: 'TEAM', label: '球队' },
      { key: 'PLAYER', label: '球员' },
    ],
    items: [],
    eventItems: [],
    teamItems: [],
    playerItems: [],
    cursor: null,
    busy: false,
    searched: false,
    error: '',
    notice: '',
    statusBarHeight: 47,
    capsuleGap: 96,
  },
  onLoad(q) {
    this._alive = true;
    this._gen = 0;
    this.setData({ query: typeof q.q === 'string' ? q.q.slice(0, 80) : '' });
    this.syncChrome();
  },
  onShow() {
    this._alive = true;
    this.syncChrome();
  },
  onHide() {
    this._alive = false;
    this._gen = (this._gen || 0) + 1;
    this.setData({ busy: false });
  },
  onUnload() {
    this.onHide();
  },
  input(e) {
    const field = e.currentTarget.dataset.field;
    if (!['query', 'city'].includes(field)) return;
    this._gen = (this._gen || 0) + 1;
    this.setData({
      [field]: e.detail.value,
      busy: false,
      items: [],
      eventItems: [],
      teamItems: [],
      playerItems: [],
      cursor: null,
      searched: false,
    });
  },
  filter(e) {
    const kind = e.currentTarget.dataset.kind;
    if (!this.data.kinds.some((k) => k.key === kind)) return;
    this._gen = (this._gen || 0) + 1;
    this.setData({
      kind,
      busy: false,
      items: [],
      eventItems: [],
      teamItems: [],
      playerItems: [],
      cursor: null,
    });
    if (this.data.query.trim()) this.search();
  },
  async search() {
    return this.load(false);
  },
  async more() {
    if (this.data.cursor) return this.load(true);
  },
  async load(more) {
    if (this.data.busy || !this.data.query.trim()) return;
    const gen = ++this._gen;
    const captured = {
      q: this.data.query.trim(),
      kind: this.data.kind,
      city: this.data.city.trim(),
      cursor: more ? this.data.cursor : null,
    };
    this.setData({
      busy: true,
      error: '',
      ...(more ? {} : { items: [], eventItems: [], teamItems: [], playerItems: [], cursor: null }),
    });
    try {
      const query = ['q=' + encodeURIComponent(captured.q), 'kind=' + captured.kind, 'limit=20'];
      if (captured.city) query.push('city=' + encodeURIComponent(captured.city));
      if (captured.cursor) query.push('cursor=' + encodeURIComponent(captured.cursor));
      const result = (
        await api
          .getClient()
          .request('/v1/public/search?' + query.join('&'), 'GET', undefined, true)
      ).data;
      if (!this._alive || gen !== this._gen) return;
      const items = (result.items || []).map((x) => ({
        ...x,
        key: x.kind + ':' + x.publicKey,
        kindLabel: x.kind === 'EVENT' ? '赛事' : x.kind === 'TEAM' ? '球队' : '球员',
      }));
      const seen = new Set();
      const merged = (more ? this.data.items : []).concat(items).filter((x) => {
        if (seen.has(x.key)) return false;
        seen.add(x.key);
        return true;
      });
      this.setData({
        items: merged,
        eventItems: merged.filter((item) => item.kind === 'EVENT'),
        teamItems: merged.filter((item) => item.kind === 'TEAM'),
        playerItems: merged.filter((item) => item.kind === 'PLAYER'),
        cursor: result.nextCursor,
        searched: true,
        notice: result.notice || '',
      });
    } catch (e) {
      if (this._alive && gen === this._gen) this.setData({ error: ui.message(e) });
    } finally {
      if (this._alive && gen === this._gen) this.setData({ busy: false });
    }
  },
  open(e) {
    const row = this.data.items.find((x) => x.key === e.currentTarget.dataset.key);
    if (!row) return;
    if (row.kind === 'EVENT')
      wx.navigateTo({ url: '/pages/event/index?event=' + encodeURIComponent(row.publicKey) });
    else
      wx.navigateTo({
        url: '/pages/public-archive/index?key=' + encodeURIComponent(row.publicKey),
      });
  },
  syncChrome() {
    let statusBarHeight = this.data.statusBarHeight;
    let capsuleGap = this.data.capsuleGap;
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
      if (
        info &&
        Number.isFinite(info.windowWidth) &&
        typeof wx.getMenuButtonBoundingClientRect === 'function'
      ) {
        const menu = wx.getMenuButtonBoundingClientRect();
        if (menu && Number.isFinite(menu.left) && menu.left > 0 && menu.left < info.windowWidth)
          capsuleGap = Math.min(160, Math.max(72, Math.round(info.windowWidth - menu.left + 8)));
      }
    } catch {
      /* The platform draws the real status bar and capsule. */
    }
    this.setData({ statusBarHeight, capsuleGap });
  },
  goBack() {
    if (typeof wx.navigateBack === 'function')
      wx.navigateBack({ delta: 1, fail: () => ui.open('home') });
    else ui.open('home');
  },
});
