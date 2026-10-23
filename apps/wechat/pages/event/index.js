const api = require('../../utils/api');
Page({
  data: {
    event: null,
    matches: [],
    standings: null,
    groups: null,
    bracket: null,
    error: '',
    stale: false,
  },
  onLoad(query) {
    try {
      this.id = api.publicId(query.event);
    } catch {
      this.setData({ error: '观赛链接不可用' });
      return;
    }
    this.load();
  },
  onShow() {
    if (this.id && !this.timer) this.timer = setInterval(() => this.load(), 10000);
  },
  onHide() {
    clearInterval(this.timer);
    this.timer = null;
  },
  onUnload() {
    this.closed = true;
    clearInterval(this.timer);
  },
  async load() {
    if (this.busy || !this.id) return;
    this.busy = true;
    try {
      const client = api.getClient();
      const event = (await client.request('/v1/public/events/' + this.id)).data;
      const matches = await api.allSchedule(client, this.id);
      let standings = null,
        groups = null,
        bracket = null;
      if (event.format === 'GROUP_KNOCKOUT') {
        groups = (await client.request('/v1/public/events/' + this.id + '/groups')).data;
        bracket = groups.bracket;
      } else if (event.format === 'SINGLE_ELIMINATION') {
        bracket = (await client.request('/v1/public/events/' + this.id + '/knockout')).data;
      } else {
        standings = (await client.request('/v1/public/events/' + this.id + '/standings')).data;
      }
      if (!this.closed)
        this.setData({ event, matches, standings, groups, bracket, error: '', stale: false });
    } catch (error) {
      if (!this.closed) {
        if (error.status === 404)
          this.setData({
            event: null,
            matches: [],
            standings: null,
            groups: null,
            bracket: null,
            error: '观赛链接已撤销或不可用',
            stale: false,
          });
        else this.setData({ error: error.message || '暂时无法读取赛事', stale: !!this.data.event });
      }
    } finally {
      this.busy = false;
    }
  },
  match(e) {
    wx.navigateTo({
      url:
        '/pages/match/index?event=' +
        this.id +
        '&match=' +
        api.publicId(e.currentTarget.dataset.id),
    });
  },
  onShareAppMessage() {
    return {
      title: this.data.event ? this.data.event.name : '小城市篮球',
      path: '/pages/event/index?event=' + this.id,
    };
  },
});
