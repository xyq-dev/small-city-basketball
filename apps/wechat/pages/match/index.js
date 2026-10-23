const api = require('../../utils/api');
Page({
  data: { snapshot: null, clock: '未准备', media: [], error: '', stale: false },
  onLoad(query) {
    try {
      this.event = api.publicId(query.event);
      this.matchId = api.publicId(query.match);
    } catch {
      this.setData({ error: '观赛链接不可用' });
      return;
    }
    this.load();
  },
  onShow() {
    if (!this.event) return;
    this.poll = setInterval(() => this.load(), 5000);
    this.tick = setInterval(() => {
      if (this.data.snapshot)
        this.setData({ clock: api.clockText(this.data.snapshot, this.receivedAt) });
    }, 250);
  },
  onHide() {
    clearInterval(this.poll);
    clearInterval(this.tick);
  },
  onUnload() {
    this.closed = true;
    clearInterval(this.poll);
    clearInterval(this.tick);
  },
  async load() {
    if (this.busy || !this.event) return;
    this.busy = true;
    try {
      const client = api.getClient();
      const base = '/v1/public/events/' + this.event + '/matches/' + this.matchId;
      const snapshot = (await client.request(base)).data;
      // Capture the scoring receipt immediately; a slow media request must not move the clock anchor.
      this.receivedAt = Date.now();
      if (!this.closed)
        this.setData({
          snapshot,
          clock: api.clockText(snapshot, this.receivedAt),
          error: '',
          stale: false,
        });
      try {
        const result = (await client.request(base + '/media')).data;
        const media = (result.media || []).map((item) => ({
          ...item,
          src: item.contentPath ? api.mediaUrl(item.contentPath) : null,
        }));
        if (!this.closed) this.setData({ media });
      } catch (error) {
        if (error.status === 404) throw error;
        if (!this.closed)
          this.setData({ media: [], error: '比赛数据已更新，媒体暂时无法读取，请稍后刷新。' });
      }
    } catch (error) {
      if (!this.closed) {
        if (error.status === 404)
          this.setData({
            snapshot: null,
            media: [],
            clock: '未准备',
            error: '观赛授权已撤销或比赛不可用',
            stale: false,
          });
        else
          this.setData({
            media: [],
            error: error.message || '无法读取比赛',
            stale: !!this.data.snapshot,
          });
      }
    } finally {
      this.busy = false;
    }
  },
  copyExternal(e) {
    const item = this.data.media.find((m) => m.publicMediaId === e.currentTarget.dataset.id);
    if (item && /^https:\/\//.test(item.externalUrl || ''))
      wx.setClipboardData({ data: item.externalUrl });
  },
  seekMarker(e) {
    const item = this.data.media.find((m) => m.publicMediaId === e.currentTarget.dataset.id);
    const marker =
      item && item.markers.find((m) => m.publicMarkerId === e.currentTarget.dataset.marker);
    if (item && item.kind === 'VIDEO' && marker && Number.isFinite(marker.startMs))
      wx.createVideoContext('media-' + item.publicMediaId, this).seek(
        Math.max(0, marker.startMs / 1000),
      );
  },
  onShareAppMessage() {
    return {
      title: this.data.snapshot ? this.data.snapshot.eventName + ' · 比赛' : '小城市篮球',
      path: '/pages/match/index?event=' + this.event + '&match=' + this.matchId,
    };
  },
});
