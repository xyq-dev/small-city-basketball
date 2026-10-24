const ui = require('../../utils/ui');
const sdk = require('../../utils/booking');
const market = require('../../utils/player-market');

Page({
  data: {
    profile: null,
    windows: [],
    recordsOpen: false,
    loading: false,
    loginRequired: false,
    error: '',
    statisticsError: '',
    asOfText: '',
    selectedCount: 0,
    selected: false,
  },
  onLoad(query) {
    if (!market.validId(query.id)) {
      this.setData({ error: '球员链接无效，请从球员广场重新选择。' });
      return;
    }
    this.profileId = query.id;
  },
  onShow() {
    this._visible = true;
    if (this.profileId) return this.load();
  },
  onHide() {
    this._visible = false;
    ui.begin(this);
    this.setData({ profile: null, windows: [] });
  },
  onUnload() {
    this._visible = false;
    ui.close(this);
  },
  returnPath() {
    return '/pages/player/index?id=' + this.profileId;
  },
  async load() {
    if (!this.profileId) return;
    const sequence = (this._loadSequence || 0) + 1;
    this._loadSequence = sequence;
    this.setData({
      profile: null,
      windows: [],
      selected: false,
      selectedCount: 0,
      loading: true,
      error: '',
      statisticsError: '',
      asOfText: '',
    });
    try {
      const session = await ui.session(this, this.returnPath());
      if (!session || !this._visible || this._loadSequence !== sequence) return;
      const token = ui.begin(this);
      const workspace = await sdk.workspace();
      if (!ui.live(this, token) || !this._visible) return;
      if (workspace.viewerUserId !== session.user.id) throw new Error('当前账号已变化，请重新读取');
      market.setViewer(session.user.id);
      market.syncSelection(workspace.players);
      const profile = workspace.players.find(
        (p) => p.id === this.profileId && p.status === 'APPROVED',
      );
      if (!profile) {
        this.setData({ error: '球员已停用、不可预约或不在当前200位目录内，请返回广场核对。' });
        return;
      }
      let performance = null;
      let statisticsError = '';
      try {
        performance = await sdk.performance(this.profileId);
      } catch (error) {
        if (!ui.live(this, token) || !this._visible) return;
        if (error.status === 404) {
          market.setSelected(market.selectedIds().filter((id) => id !== this.profileId));
          if (ui.live(this, token) && this._visible)
            this.setData({ error: '球员资料当前已不可查看，请重新选择。' });
          return;
        }
        statisticsError = ui.message(error);
      }
      if (!ui.live(this, token) || !this._visible) return;
      this._displayToken = token;
      this.setData({
        profile: market.profileView(
          profile,
          workspace.settings.feeBps,
          performance,
          !!statisticsError,
        ),
        windows: profile.availability.map((window, index) => ({
          id: String(index),
          start: ui.localTime(window.startAt, true),
          end: ui.localTime(window.endAt, true),
        })),
        selected: market.selectedIds().includes(this.profileId),
        selectedCount: market.selectedIds().length,
        loginRequired: false,
        statisticsError,
        asOfText: performance ? ui.localTime(performance.asOf, true) : '',
      });
    } catch (error) {
      if (this._visible && this._loadSequence === sequence)
        this.setData({
          profile: null,
          windows: [],
          error: ui.message(error),
          loginRequired: error.status === 401,
        });
    } finally {
      if (this._visible && this._loadSequence === sequence) this.setData({ loading: false });
    }
  },
  recordsToggle() {
    this.setData({ recordsOpen: !this.data.recordsOpen });
  },
  toggle() {
    if (!this._displayToken || !this._visible || !ui.live(this, this._displayToken)) return;
    try {
      market.toggle(this.profileId);
      this.setData({
        selected: market.selectedIds().includes(this.profileId),
        selectedCount: market.selectedIds().length,
        error: '',
      });
    } catch (error) {
      this.setData({ error: ui.message(error) });
    }
  },
  compare() {
    if (!this._displayToken || !this._visible || !ui.live(this, this._displayToken)) return;
    if (this.data.selectedCount >= 2) ui.open('compare', { ids: market.selectedIds().join(',') });
    else ui.open('players');
  },
  book() {
    if (!this._displayToken || !this._visible || !ui.live(this, this._displayToken)) return;
    if (this.data.profile) ui.open('booking-create', { playerId: this.profileId });
  },
  market() {
    ui.open('players');
  },
  login() {
    ui.login(this.returnPath());
  },
});
