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
    cursor: null,
    busy: false,
    searched: false,
    error: '',
    notice: '',
  },
  onLoad(q) {
    this._alive = true;
    this._gen = 0;
    this.setData({ query: typeof q.q === 'string' ? q.q.slice(0, 80) : '' });
  },
  onShow() {
    this._alive = true;
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
      cursor: null,
      searched: false,
    });
  },
  filter(e) {
    const kind = e.currentTarget.dataset.kind;
    if (!this.data.kinds.some((k) => k.key === kind)) return;
    this._gen = (this._gen || 0) + 1;
    this.setData({ kind, busy: false, items: [], cursor: null });
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
    this.setData({ busy: true, error: '', ...(more ? {} : { items: [], cursor: null }) });
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
});
