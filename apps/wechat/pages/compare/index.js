const ui = require('../../utils/ui');
const sdk = require('../../utils/booking');
const market = require('../../utils/player-market');
const PRIMARY_METRICS = ['price', 'total', 'sample', 'points', 'fouls', 'services', 'status'];

function primaryComparison(table) {
  const labelById = new Map(table.labels.map((label) => [label.id, label]));
  return {
    labels: PRIMARY_METRICS.map((id) => ({
      ...labelById.get(id),
      label:
        id === 'sample' ? '统计样本' : id === 'status' ? '来源完整度' : labelById.get(id).label,
    })),
    columns: table.columns.map((column) => {
      const cellById = new Map(column.cells.map((cell) => [cell.id, cell]));
      return { ...column, cells: PRIMARY_METRICS.map((id) => cellById.get(id)) };
    }),
  };
}

Page({
  data: {
    profiles: [],
    labels: [],
    columns: [],
    selectedCount: 0,
    firstId: '',
    firstName: '',
    columnsWidth: '0px',
    tableHeight: '456px',
    loading: false,
    loginRequired: false,
    error: '',
    notice: '',
    statisticsError: '',
  },
  onLoad(query) {
    try {
      this._requestedIds = query.ids === undefined ? null : market.parseIds(query.ids);
    } catch (error) {
      this.invalid = true;
      this.setData({ error: ui.message(error) });
    }
  },
  onShow() {
    this._visible = true;
    if (!this.invalid) return this.load();
  },
  onHide() {
    this._visible = false;
    ui.begin(this);
    this.setData({ profiles: [], columns: [], labels: [], firstId: '', firstName: '' });
  },
  onUnload() {
    this._visible = false;
    ui.close(this);
  },
  returnPath() {
    const ids = this._requestedIds || market.selectedIds();
    return '/pages/compare/index' + (ids.length ? '?ids=' + ids.join(',') : '');
  },
  async load() {
    const sequence = (this._loadSequence || 0) + 1;
    this._loadSequence = sequence;
    this.setData({
      profiles: [],
      labels: [],
      columns: [],
      firstId: '',
      firstName: '',
      selectedCount: 0,
      loading: true,
      error: '',
      notice: '',
      statisticsError: '',
    });
    try {
      const session = await ui.session(this, this.returnPath());
      if (!session || !this._visible || this._loadSequence !== sequence) return;
      const token = ui.begin(this);
      const workspace = await sdk.workspace();
      if (!ui.live(this, token) || !this._visible) return;
      if (workspace.viewerUserId !== session.user.id) throw new Error('当前账号已变化，请重新读取');
      market.setViewer(session.user.id);
      let ids = this._requestedIds || market.selectedIds();
      const approved = workspace.players.filter((p) => p.status === 'APPROVED');
      const byId = new Map(approved.map((p) => [p.id, p]));
      const originalCount = ids.length;
      ids = ids.filter((id) => byId.has(id));
      market.setSelected(ids);
      this._requestedIds = ids;
      if (ids.length < 2) {
        this.setData({
          loginRequired: false,
          selectedCount: ids.length,
          error:
            originalCount > ids.length
              ? '已移除停用、不可查看或不在当前目录的球员；至少选择2位才能比较。'
              : '至少选择2位、最多3位不同球员进行比较。',
        });
        return;
      }
      let batch = null;
      let statisticsError = '';
      try {
        batch = await sdk.performances(ids);
      } catch (error) {
        statisticsError = ui.message(error);
      }
      if (!ui.live(this, token) || !this._visible) return;
      const unavailable = new Set(batch ? batch.unavailableProfileIds : []);
      ids = ids.filter((id) => !unavailable.has(id));
      market.setSelected(ids);
      this._requestedIds = ids;
      if (ids.length < 2) {
        this.setData({
          selectedCount: ids.length,
          loginRequired: false,
          error: '部分球员当前已不可查看，已移出对比。请再选择球员。',
        });
        return;
      }
      const stats = new Map(batch ? batch.players.map((p) => [p.profileId, p]) : []);
      const profiles = ids.map((id) =>
        market.profileView(
          byId.get(id),
          workspace.settings.feeBps,
          stats.get(id),
          !!statisticsError,
        ),
      );
      const table = primaryComparison(market.comparisonRows(profiles));
      this._displayToken = token;
      this.setData({
        profiles,
        labels: table.labels,
        columns: table.columns,
        columnsWidth: String(profiles.length * 125) + 'px',
        tableHeight: String(64 + table.labels.length * 56) + 'px',
        selectedCount: profiles.length,
        firstId: profiles[0].id,
        firstName: profiles[0].name,
        loginRequired: false,
        notice: originalCount > ids.length ? '已移除当前不可查看的球员，其余选择保留。' : '',
        statisticsError,
      });
    } catch (error) {
      if (this._visible && this._loadSequence === sequence)
        this.setData({ error: ui.message(error), loginRequired: error.status === 401 });
    } finally {
      if (this._visible && this._loadSequence === sequence) this.setData({ loading: false });
    }
  },
  detail(event) {
    if (!this._displayToken || !this._visible || !ui.live(this, this._displayToken)) return;
    ui.open('player', { id: event.currentTarget.dataset.id });
  },
  book(event) {
    if (!this._displayToken || !this._visible || !ui.live(this, this._displayToken)) return;
    const id = event.currentTarget.dataset.id || this.data.firstId;
    if (this.data.profiles.some((p) => p.id === id)) ui.open('booking-create', { playerId: id });
  },
  remove(event) {
    if (!this._displayToken || !this._visible || !ui.live(this, this._displayToken)) return;
    const id = event.currentTarget.dataset.id;
    this._requestedIds = market.selectedIds().filter((old) => old !== id);
    market.setSelected(this._requestedIds);
    return this.load();
  },
  market() {
    ui.open('players');
  },
  login() {
    ui.login(this.returnPath());
  },
});
