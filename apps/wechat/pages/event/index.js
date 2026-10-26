const api = require('../../utils/api');
const recent = require('../../utils/recent');

function shortDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.slice(5).replace('-', '/')
    : value || '日期待确认';
}
function bracketView(bracket) {
  if (!bracket) return null;
  return {
    ...bracket,
    rounds: (bracket.rounds || []).map((round) => ({
      ...round,
      slots: (round.slots || []).map((slot) => ({
        ...slot,
        statusLabel:
          slot.status === 'WAITING'
            ? '尚未发布'
            : slot.status === 'BYE'
              ? '轮空'
              : api.matchStatus(slot.status),
      })),
    })),
  };
}
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
    overview: true,
    unavailable: false,
    qualificationLabel: '',
  },
  onLoad(query) {
    try {
      this.id = api.publicId(query.event);
      if (['schedule', 'ranking', 'media'].includes(query.tab))
        this.setData({ tab: query.tab, overview: false });
    } catch {
      this.setData({ error: '观赛链接不可用', unavailable: true });
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
        dateLabel: shortDate(rawEvent.startDate) + '–' + shortDate(rawEvent.endDate),
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
      if (!this.closed) recent.remember({ ...event, publicEventId: this.id });
      if (!this.closed)
        this.setData({
          event,
          matches,
          standings,
          groups,
          bracket: bracketView(bracket),
          qualificationLabel:
            {
              WAITING: '组内赛果尚未全部确认',
              TIE_BREAK_REQUIRED: '组内同分资格待抽签',
              READY: '资格已具备，等待主办方明确发布',
              PUBLISHED: '当前资格已正式发布',
            }[groups && groups.qualificationStatus] || '',
          error: '',
          stale: false,
          unavailable: false,
        });
    } catch (error) {
      if (!this.closed) {
        if (error.status === 404) recent.forget(this.id);
        if (error.status === 404)
          this.setData({
            event: null,
            matches: [],
            standings: null,
            groups: null,
            bracket: null,
            error: '观赛链接已撤销或不可用',
            stale: false,
            unavailable: true,
            qualificationLabel: '',
          });
        else this.setData({ error: error.message || '暂时无法读取赛事', stale: !!this.data.event });
      }
    } finally {
      this.busy = false;
      if (!this.closed) this.setData({ loading: false });
    }
  },
  tab(e) {
    if (this.data.loading) return;
    const tab = e.currentTarget.dataset.tab;
    if (['schedule', 'ranking', 'media'].includes(tab)) this.setData({ tab, overview: false });
  },
  backToOverview() {
    if (!this.data.loading) this.setData({ overview: true, tab: 'schedule' });
  },
  watch() {
    wx.navigateTo({ url: '/pages/watch/index' });
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
