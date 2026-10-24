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
    loading: false,
    tab: 'schedule',
  },
  onLoad(query) {
    try {
      this.id = api.publicId(query.event);
      if (['schedule', 'ranking', 'media'].includes(query.tab)) this.setData({ tab: query.tab });
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
    this.setData({ loading: true });
    try {
      const client = api.getClient();
      const rawEvent = (await client.request('/v1/public/events/' + this.id)).data;
      const event = {
        ...rawEvent,
        statusLabel: api.eventStatus(rawEvent.status),
        formatLabel: api.eventFormat(rawEvent.format),
      };
      const matches = (await api.allSchedule(client, this.id)).map((m) => ({
        ...m,
        startLabel: api.publicTime(m.startsAt),
        statusLabel: api.matchStatus(m.status),
        resultLabel: api.resultStatus(m.resultStatus),
      }));
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
      if (!this.closed) this.setData({ loading: false });
    }
  },
  tab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (['schedule', 'ranking', 'media'].includes(tab)) this.setData({ tab });
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
    if (!this.id) return { title: '小城市篮球', path: '/pages/home/index' };
    return {
      title: this.data.event ? this.data.event.name : '小城市篮球',
      path: '/pages/event/index?event=' + this.id,
    };
  },
});
