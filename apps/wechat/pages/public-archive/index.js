const api = require('../../utils/api');
const ui = require('../../utils/ui');
Page({
  data: { loading: false, error: '', archive: null, entries: [], kind: 'PLAYER', notice: '' },
  onLoad(q) {
    this._alive = true;
    try {
      this.key = q && q.key ? api.publicId(q.key) : null;
      this.setData({ kind: q && q.kind === 'TEAM' ? 'TEAM' : 'PLAYER' });
      this.load();
    } catch (e) {
      this.setData({ error: '公开档案地址无效。' });
    }
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  async load() {
    const token = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      const path = this.key
        ? '/v1/public/archives/' + this.key
        : '/v1/public/archives/rankings?kind=' + this.data.kind;
      const data = (await api.getClient().requestPublic(path)).data;
      if (!ui.live(this, token)) return;
      this.setData({
        loading: false,
        archive: this.key
          ? {
              ...data,
              playingTimeLabel: data.technical
                ? Math.floor(data.technical.playingMs / 60000) +
                  '分' +
                  (Math.floor(data.technical.playingMs / 1000) % 60) +
                  '秒'
                : '',
            }
          : null,
        entries: this.key ? [] : data.entries.map((e) => ({ ...e, key: e.archive.publicKey })),
        notice: this.key ? data.coverageNotice : data.notice,
      });
    } catch (e) {
      if (ui.live(this, token))
        this.setData({
          loading: false,
          archive: null,
          entries: [],
          error: e.status === 404 ? '公开档案已撤销、停用或不存在。' : ui.message(e),
        });
    }
  },
  kind(e) {
    this.key = null;
    this.setData({ kind: e.currentTarget.dataset.kind, archive: null, entries: [] });
    this.load();
  },
  open(e) {
    wx.navigateTo({
      url: '/pages/public-archive/index?key=' + api.publicId(e.currentTarget.dataset.key),
    });
  },
  rankings() {
    this.key = null;
    this.load();
  },
  onShareAppMessage() {
    return {
      title: this.data.archive
        ? this.data.archive.displayName + '的篮球公开档案'
        : '篮球公开跨届榜单',
      path:
        '/pages/public-archive/index?' + (this.key ? 'key=' + this.key : 'kind=' + this.data.kind),
    };
  },
});
