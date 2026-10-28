const api = require('../../utils/api');
const ui = require('../../utils/ui');
const follows = require('../../utils/follows');

// C19 "我的关注": the signed-in account's own follows only. Any account change, sign-out or
// session loss clears the list at once; writes follow the confirmOp rules (zero writes after a
// late confirmation). INVALID rows show no withdrawn event details and cannot be opened.
const EMPTY = Object.freeze({
  items: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  moreError: '',
  busy: false,
  cancelling: '',
  error: '',
  notice: '',
  loginRequired: false,
});
Page({
  data: { ...EMPTY, reminderOff: follows.REMINDER_OFF },
  onLoad() {
    this._alive = true;
    this._listGen = 0;
  },
  onShow() {
    this.load();
  },
  onUnload() {
    this._alive = false;
    this._listGen++;
    ui.close(this);
  },
  onSessionReset() {
    if (!this._alive) return;
    this._listGen++;
    this.setData({
      ...EMPTY,
      notice: '登录身份已变化，已清空上一账号的关注。',
      loginRequired: !api.getClient().hasSession(),
    });
    // Deferred: load() re-subscribes, which must not happen inside the session notification.
    if (api.getClient().hasSession())
      Promise.resolve().then(() => {
        if (this._alive && api.getClient().hasSession()) this.load(true);
      });
  },
  login() {
    ui.login('/pages/follows/index');
  },
  async load(keepNotice) {
    if (!this._alive || this.data.busy) return;
    const gen = ++this._listGen;
    this.setData({
      ...EMPTY,
      notice: keepNotice === true ? this.data.notice : '',
      loading: true,
    });
    ui.begin(this);
    const client = api.getClient();
    // Signed out: nothing private is requested.
    if (!client.hasSession()) {
      this.setData({ loading: false, loginRequired: true });
      return;
    }
    const session = await ui.session(this, '/pages/follows/index');
    if (!this._alive || gen !== this._listGen) return;
    if (!session) {
      this.setData({ loading: false, loginRequired: true });
      return;
    }
    const token = ui.begin(this);
    this._viewer = session.user.id;
    try {
      const result = await follows.page(client, null);
      if (ui.live(this, token) && gen === this._listGen)
        this.setData({
          items: result.items.map(follows.view),
          nextCursor: result.nextCursor,
          loading: false,
        });
    } catch (error) {
      if (ui.live(this, token) && gen === this._listGen)
        this.setData({ items: [], nextCursor: null, loading: false, error: ui.message(error) });
    }
  },
  async more() {
    const cursor = this.data.nextCursor;
    if (!cursor || this.data.loading || this.data.loadingMore || this.data.busy) return;
    const gen = this._listGen;
    const token = ui.guard(this);
    this.setData({ loadingMore: true, moreError: '' });
    try {
      const result = await follows.page(api.getClient(), cursor);
      if (gen !== this._listGen || !ui.held(this, token)) return;
      this.setData({
        items: follows.merge(this.data.items, result.items.map(follows.view)),
        nextCursor: result.nextCursor,
        loadingMore: false,
      });
    } catch (error) {
      if (gen !== this._listGen || !ui.held(this, token)) return;
      // Keep the rows already read and the same cursor for a retry.
      this.setData({
        loadingMore: false,
        moreError:
          '更多关注暂时无法读取，已显示的 ' +
          this.data.items.length +
          ' 条保留，可重试。' +
          (error && error.message ? '（' + error.message + '）' : ''),
      });
    }
  },
  openEvent(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.items.find((v) => v.publicEventId === id);
    // Only a currently readable follow opens; an INVALID row never links to the old key.
    if (!item || item.status !== 'ACTIVE') return;
    wx.navigateTo({ url: '/pages/event/index?event=' + api.publicId(id) });
  },
  async cancel(e) {
    if (this.data.busy || this.data.loading) return;
    const followId = e.currentTarget.dataset.id;
    const item = this.data.items.find((v) => v.followId === followId);
    if (!item) return;
    const gen = this._listGen;
    const op = await ui.confirmOp(
      this,
      '取消关注',
      item.status === 'ACTIVE'
        ? '取消后「' + item.event.name + '」不再出现在我的关注。'
        : '取消这条已失效的关注？原赛事资料不会再显示。',
    );
    if (!op) return;
    const still = () =>
      op.valid() &&
      this._alive &&
      gen === this._listGen &&
      this.data.items.some((v) => v.followId === followId && v.status === item.status);
    if (!still()) return;
    this.setData({ busy: true, cancelling: followId, error: '', notice: '' });
    try {
      await follows.cancel(api.getClient(), followId);
      if (!still()) return this.abandon(gen);
      this.setData({
        busy: false,
        cancelling: '',
        items: this.data.items.filter((v) => v.followId !== followId),
        notice: '已取消关注。',
      });
    } catch (error) {
      if (!still()) return this.abandon(gen);
      this.setData({ busy: false, cancelling: '', error: follows.failure(error, 'cancel') });
    }
  },
  abandon(gen) {
    if (this._alive && gen === this._listGen) this.setData({ busy: false, cancelling: '' });
  },
  onShareAppMessage() {
    return { title: '小城市篮球', path: '/pages/home/index' };
  },
});
