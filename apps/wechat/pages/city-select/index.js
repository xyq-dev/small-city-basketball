const cities = require('../../utils/city-preference');
const regions = require('../../utils/regions');
const api = require('../../utils/api');
const ui = require('../../utils/ui');

Page({
  data: {
    city: '',
    label: '全国',
    source: '',
    recent: [],
    recentChoices: [],
    warning: '',
    input: '',
    error: '',
    organizer: false,
    catalogLoading: false,
    catalogError: '',
    catalogVersion: '',
    dataDate: '',
    search: '',
    rows: [],
    hasMore: false,
    parentId: '',
    parentLabel: '',
    versionNote: '',
    partial: false,
  },
  onLoad(query = {}) {
    this._alive = true;
    this._hidden = false;
    this._sessionRevision = api.getClient().sessionRevision();
    this._organizer = query.context === 'directory';
    const selection = cities.snapshot();
    this.setData({ ...selection, input: selection.city, organizer: this._organizer });
    this.loadCatalog();
  },
  onShow() {
    this._hidden = false;
    if (this._needsCatalog) this.loadCatalog();
  },
  onHide() {
    this._hidden = true;
    this._catalogGeneration = (this._catalogGeneration || 0) + 1;
    this._needsCatalog = true;
    this.setData({ catalogLoading: false });
  },
  onUnload() {
    this._alive = false;
    this._catalogGeneration = (this._catalogGeneration || 0) + 1;
  },
  active() {
    return (
      this._alive &&
      !this._hidden &&
      (!this._organizer || this._sessionRevision === api.getClient().sessionRevision())
    );
  },
  async loadCatalog() {
    if (!this.active()) return;
    const gen = (this._catalogGeneration = (this._catalogGeneration || 0) + 1);
    this._needsCatalog = false;
    this.setData({ catalogLoading: true, catalogError: '', rows: [], hasMore: false });
    try {
      const catalog = await regions.fetchCatalog();
      if (!this.active() || gen !== this._catalogGeneration) return;
      this._catalog = catalog;
      const selected = cities.snapshot();
      this.setData({
        catalogLoading: false,
        catalogVersion: catalog.version,
        dataDate: catalog.dataDate,
        parentId: '',
        parentLabel: '',
        partial: false,
        versionNote:
          !this._organizer &&
          selected.mode === 'REGION' &&
          selected.catalogVersion !== catalog.version
            ? '地区目录已更新，请重新核对完整路径并确认；原选择尚未改变。'
            : !this._organizer && selected.mode === 'LEGACY_CITY'
              ? '上次按城市文字选择：' +
                selected.city +
                '。选择下面的标准地区后才会改为地区及下辖范围。'
              : '',
      });
      this.showRows(true);
    } catch (error) {
      if (this.active() && gen === this._catalogGeneration)
        this.setData({ catalogLoading: false, catalogError: regions.failure(error) });
    }
  },
  showRows(reset) {
    if (!this._catalog) return;
    if (reset) this._visibleCount = 40;
    const input = this.data.search.trim().normalize('NFC');
    const matches = this._catalog.nodes.filter((r) =>
      input
        ? r.name.includes(input) || r.path.includes(input)
        : r.parentId === (this.data.parentId || null),
    );
    this.setData({
      rows: matches.slice(0, this._visibleCount),
      hasMore: matches.length > this._visibleCount,
    });
  },
  searchRegion(e) {
    this.setData({ search: String(e.detail.value || '').slice(0, 80) });
    this.showRows(true);
  },
  moreRegions() {
    this._visibleCount += 40;
    this.showRows(false);
  },
  browseRegion(e) {
    const node = this._catalog && this._catalog.index[e.currentTarget.dataset.id];
    if (!node || !this.active()) return;
    this.setData({ parentId: node.id, parentLabel: node.path, search: '', partial: node.partial });
    this.showRows(true);
  },
  rootRegions() {
    this.setData({ parentId: '', parentLabel: '', search: '', partial: false });
    this.showRows(true);
  },
  chooseParent() {
    this.selectRegion({ currentTarget: { dataset: { id: this.data.parentId } } });
  },
  selectRegion(e) {
    if (!this.active() || !this._catalog || this.data.catalogLoading || this.data.catalogError)
      return;
    try {
      const selection = regions.selection(this._catalog, e.currentTarget.dataset.id);
      if (this._organizer) {
        const channel =
          typeof this.getOpenerEventChannel === 'function' && this.getOpenerEventChannel();
        if (!channel || typeof channel.emit !== 'function')
          throw new Error('选地入口已失效，请返回赛事设置重新打开。');
        channel.emit('regionSelected', selection);
      } else this.setData({ ...cities.chooseSelection(selection), error: '' });
      this.back();
    } catch (error) {
      this.setData({ error: ui.message(error) });
    }
  },
  inputCity(e) {
    this.setData({ input: String(e.detail.value || '').slice(0, 40), error: '' });
  },
  apply() {
    if (!this.data.input.trim()) {
      this.setData({ error: '请填写城市名称，或选择“浏览全国”。' });
      return;
    }
    this.select(this.data.input);
  },
  pickRecent(e) {
    const choice = cities
      .snapshot()
      .recentChoices.find((r) => r.key === e.currentTarget.dataset.key);
    if (!choice) {
      const city = e.currentTarget.dataset.city;
      if (this.data.recent.includes(city)) this.select(city);
      return;
    }
    if (choice.mode === 'LEGACY_CITY') this.select(choice.city);
    else if (this._catalog && this._catalog.index[choice.regionId]) {
      if (choice.catalogVersion !== this._catalog.version) {
        this.setData({
          versionNote: '地区目录已更新，请在当前目录重新选择确认。',
          search: this._catalog.index[choice.regionId].name,
        });
        this.showRows(true);
      } else this.selectRegion({ currentTarget: { dataset: { id: choice.regionId } } });
    } else this.setData({ error: '该历史地区暂不可用，请读取目录后重新选择，或浏览全国。' });
  },
  nationwide() {
    this.select('');
  },
  select(city) {
    if (!this.active() || this._organizer) return;
    try {
      this.setData({ ...cities.choose(city), error: '' });
      this.back();
    } catch (error) {
      this.setData({ error: ui.message(error) });
    }
  },
  back() {
    if (typeof getCurrentPages === 'function' && getCurrentPages().length > 1)
      wx.navigateBack({ delta: 1 });
    else ui.open('watch');
  },
  clearHistory() {
    if (!this._organizer && this.active()) this.setData(cities.clearRecent());
  },
});
