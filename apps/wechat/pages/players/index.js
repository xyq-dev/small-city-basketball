const ui = require('../../utils/ui');
const sdk = require('../../utils/booking');
const market = require('../../utils/player-market');
const returnPath = '/pages/players/index';

function filterSummary(filters, anchor) {
  const position = filters.position || (filters.samePrice && anchor ? anchor.position : '');
  const price = String(filters.price || '').trim();
  const date = filters.date ? filters.date.split('-') : null;
  return {
    position: market.positionOptions[market.positionCodes.indexOf(position)] || '全部位置',
    price: price
      ? '同价 ¥' + Number(price)
      : filters.samePrice && anchor
        ? '同价 ¥' + anchor.priceFen / 100
        : '不限价格',
    date: date ? Number(date[1]) + '月' + Number(date[2]) + '日' : '不限日期',
  };
}

Page({
  data: {
    cards: [],
    loading: false,
    loginRequired: false,
    error: '',
    statisticsError: '',
    selectionNotice: '',
    filtersOpen: false,
    informationOpen: false,
    filterSummary: { position: '全部位置', price: '不限价格', date: '不限日期' },
    filters: {
      search: '',
      city: '',
      position: '',
      price: '',
      date: '',
      sort: '',
      samePrice: false,
    },
    positionOptions: market.positionOptions,
    positionIndex: 0,
    sortOptions: ['默认顺序', '服务费从低到高', '服务费从高到低'],
    sortIndex: 0,
    selectedCount: 0,
    filteredCount: 0,
    showingCount: 0,
    hasMore: false,
    catalogLimited: false,
  },
  onLoad(query = {}) {
    const index = market.positionCodes.indexOf(query.position);
    if (index > 0)
      this.setData({
        positionIndex: index,
        filters: { ...this.data.filters, position: market.positionCodes[index] },
      });
  },
  informationToggle() {
    this.setData({ informationOpen: !this.data.informationOpen });
  },
  onShow() {
    this._visible = true;
    return this.load();
  },
  onHide() {
    this._visible = false;
    ui.begin(this);
    this._catalog = [];
    this.setData({ cards: [], selectedCount: 0 });
  },
  onUnload() {
    this._visible = false;
    this._catalog = [];
    ui.close(this);
  },
  async load() {
    const sequence = (this._loadSequence || 0) + 1;
    this._loadSequence = sequence;
    this._catalog = [];
    this._displayToken = null;
    this._catalogToken = null;
    this.setData({ cards: [], selectedCount: 0, loading: true, error: '', statisticsError: '' });
    try {
      const session = await ui.session(this, returnPath);
      if (!session || !this._visible || this._loadSequence !== sequence) return;
      const token = ui.begin(this);
      const workspace = await sdk.workspace();
      if (!ui.live(this, token) || !this._visible || this._loadSequence !== sequence) return;
      if (workspace.viewerUserId !== session.user.id) throw new Error('当前账号已变化，请重新读取');
      market.setViewer(session.user.id);
      this._catalog = workspace.players.filter((p) => p.status === 'APPROVED');
      this._feeBps = workspace.settings.feeBps;
      this._catalogToken = token;
      const oldCount = market.selectedIds().length;
      market.syncSelection(this._catalog);
      this.setData({
        loginRequired: false,
        catalogLimited: workspace.players.length >= 200,
        selectionNotice:
          market.selectedIds().length < oldCount ? '已移除当前不可预约或不在目录中的球员。' : '',
      });
      await this.renderCount(20);
    } catch (error) {
      if (this._visible && this._loadSequence === sequence) {
        this._catalog = [];
        this.setData({ cards: [], error: ui.message(error), loginRequired: error.status === 401 });
      }
    } finally {
      if (this._visible && this._loadSequence === sequence) this.setData({ loading: false });
    }
  },
  async renderCount(limit) {
    if (!this._visible || !this._catalog) return;
    const previous = this._displayToken || this._catalogToken;
    if (!previous || !ui.live(this, previous)) {
      this._catalog = [];
      this.setData({
        cards: [],
        selectedCount: 0,
        loading: false,
        error: '当前账号或资料已变化，请刷新球员目录。',
      });
      return;
    }
    const ids = market.selectedIds();
    const anchor = this._catalog.find((p) => p.id === ids[0]);
    const appliedFilters = { ...this.data.filters };
    const result = market.filterPlayers(this._catalog, appliedFilters, anchor);
    if (result.error) {
      this.setData({ cards: [], error: result.error, loading: false, hasMore: false });
      return;
    }
    // Invalid filters must not invalidate the last authenticated catalog read.
    const token = ui.begin(this);
    const visible = result.players.slice(0, limit);
    this.setData({ cards: [], loading: true, error: '', statisticsError: '' });
    const stats = {};
    const unavailable = new Set();
    let statisticsError = '';
    try {
      // Each HTTP batch is bounded to20; only visible profiles need public statistics.
      for (let i = 0; i < visible.length; i += 20) {
        const batch = await sdk.performances(visible.slice(i, i + 20).map((p) => p.id));
        if (!ui.live(this, token) || !this._visible) return;
        batch.players.forEach((p) => {
          stats[p.profileId] = p;
        });
        batch.unavailableProfileIds.forEach((id) => unavailable.add(id));
      }
    } catch (error) {
      // A partial batch sequence must not leave a mixture of fresh and old metrics.
      for (const id of Object.keys(stats)) delete stats[id];
      statisticsError = ui.message(error);
    }
    if (!ui.live(this, token) || !this._visible) return;
    if (unavailable.size) {
      this._catalog = this._catalog.filter((p) => !unavailable.has(p.id));
      market.syncSelection(this._catalog);
    }
    const rows = visible.filter((p) => !unavailable.has(p.id));
    this._displayToken = token;
    this.setData({
      cards: rows.map((p) => {
        const row = market.profileView(p, this._feeBps, stats[p.id], !!statisticsError);
        return {
          ...row,
          priceLabel: row.price.replace(/\.00$/, ''),
          totalLabel: row.total.replace(/\.00$/, ''),
        };
      }),
      loading: false,
      statisticsError,
      selectedCount: market.selectedIds().length,
      showingCount: rows.length,
      filteredCount: result.players.length - unavailable.size,
      hasMore: result.players.length > limit,
      filterSummary: filterSummary(appliedFilters, anchor),
      selectionNotice: unavailable.size
        ? '部分球员资料已不可查看，已移出当前目录和对比。'
        : this.data.selectionNotice,
    });
  },
  input(event) {
    const key = event.currentTarget.dataset.field;
    if (!['search', 'city', 'price'].includes(key)) return;
    this.setData({ filters: { ...this.data.filters, [key]: event.detail.value } });
  },
  positionChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      positionIndex: index,
      filters: { ...this.data.filters, position: market.positionCodes[index] || '' },
    });
  },
  sortChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      sortIndex: index,
      filters: { ...this.data.filters, sort: ['', 'PRICE_ASC', 'PRICE_DESC'][index] || '' },
    });
  },
  dateChange(event) {
    this.setData({ filters: { ...this.data.filters, date: event.detail.value } });
  },
  clearDate() {
    this.setData({ filters: { ...this.data.filters, date: '' } });
  },
  samePriceChange(event) {
    this.setData({
      filters: { ...this.data.filters, samePrice: event.detail.value.includes('same') },
    });
  },
  filtersToggle() {
    this.setData({ filtersOpen: !this.data.filtersOpen });
  },
  applyFilters() {
    return this.renderCount(20);
  },
  clearFilters() {
    this.setData({
      filters: {
        search: '',
        city: '',
        position: '',
        price: '',
        date: '',
        sort: '',
        samePrice: false,
      },
      positionIndex: 0,
      sortIndex: 0,
    });
    return this.renderCount(20);
  },
  more() {
    if (!this.data.loading) return this.renderCount(this.data.showingCount + 20);
  },
  toggle(event) {
    if (!this._displayToken || !this._visible || !ui.live(this, this._displayToken)) return;
    try {
      const id = event.currentTarget.dataset.id;
      if (!this._catalog.some((p) => p.id === id))
        throw new Error('该球员当前不可选择，请刷新目录。');
      market.toggle(id);
      const ids = market.selectedIds();
      this.setData({
        cards: this.data.cards.map((p) => ({ ...p, selected: ids.includes(p.id) })),
        selectedCount: ids.length,
        error: '',
      });
      if (this.data.filters.samePrice) this.renderCount(20);
    } catch (error) {
      this.setData({ error: ui.message(error) });
    }
  },
  detail(event) {
    if (!this._displayToken || !this._visible || !ui.live(this, this._displayToken)) return;
    const id = event.currentTarget.dataset.id;
    if (this._catalog.some((p) => p.id === id)) ui.open('player', { id });
  },
  compare() {
    if (
      this.data.selectedCount < 2 ||
      !this._displayToken ||
      !this._visible ||
      !ui.live(this, this._displayToken)
    )
      return;
    ui.open('compare', { ids: market.selectedIds().join(',') });
  },
  bookings() {
    ui.open('bookings');
  },
  login() {
    ui.login(returnPath);
  },
});
