const api = require('../../utils/api');
const recent = require('../../utils/recent');
const ui = require('../../utils/ui');
const follows = require('../../utils/follows');

// Follow state is private to the signed-in account and kept apart from the public event data:
// a session change resets only this block, and the public reads stay exactly as before.
// A signed-in device holds a session cookie; a client without that capability counts as signed out.
const signedIn = (client) => typeof client.hasSession === 'function' && client.hasSession();
const FOLLOW_START = Object.freeze({
  state: 'signedOut',
  followId: '',
  busy: false,
  error: '',
  notice: '',
});

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
    follow: { ...FOLLOW_START },
    reminderOff: follows.REMINDER_OFF,
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
    // Subscribe to session changes before anything private can be shown.
    ui.guard(this);
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
    this._followGen = (this._followGen || 0) + 1;
    ui.close(this);
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
      const firstView = !this.data.event;
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
      if (!this.closed && firstView) this.checkFollow();
    } catch (error) {
      if (!this.closed) {
        if (error.status === 404) recent.forget(this.id);
        if (error.status === 404) this._followGen = (this._followGen || 0) + 1;
        if (error.status === 404)
          this.setData({
            follow: { ...FOLLOW_START, state: this.followFallback() },
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
  // Called by utils/ui on any account change, sign-out or session loss: clear this account's
  // follow state at once (and abandon any pending follow work), then re-check for the new one.
  onSessionReset() {
    this._followGen = (this._followGen || 0) + 1;
    this.setData({ follow: { ...FOLLOW_START, state: 'checking' } });
    if (this.data.event && !this.data.unavailable) this.checkFollow();
    else this.setData({ follow: { ...FOLLOW_START, state: this.followFallback() } });
  },
  // Without a readable event only the "my follows" entry remains, and only when signed in.
  followFallback() {
    return signedIn(api.getClient()) ? 'unavailable' : 'signedOut';
  },
  async checkFollow() {
    if (this.closed || !this.id) return;
    const client = api.getClient();
    const gen = (this._followGen = (this._followGen || 0) + 1);
    // Signed out: nothing private is requested; the public page keeps working cookie-less.
    if (!signedIn(client)) {
      this.setData({ follow: { ...FOLLOW_START } });
      return;
    }
    const token = ui.guard(this);
    this.setData({ follow: { ...FOLLOW_START, state: 'checking' } });
    try {
      const item = await follows.lookup(client, this.id);
      if (gen !== this._followGen || !ui.held(this, token)) return;
      this.setData({
        follow: {
          ...FOLLOW_START,
          state: !item ? 'none' : item.status === 'ACTIVE' ? 'active' : 'invalid',
          followId: item ? item.followId : '',
        },
      });
    } catch (error) {
      if (gen !== this._followGen || !ui.held(this, token)) return;
      this.setData({
        follow: {
          ...FOLLOW_START,
          state: error && error.status === 401 ? 'signedOut' : 'unknown',
          error: error && error.status === 401 ? '' : ui.message(error),
        },
      });
    }
  },
  followLogin() {
    ui.login('/pages/event/index?event=' + this.id);
  },
  openFollows() {
    wx.navigateTo({ url: '/pages/follows/index' });
  },
  // Abandoned follow work leaves the block idle unless a session reset already replaced it.
  _followAbandon(gen) {
    if (!this.closed && gen === this._followGen) this.setData({ 'follow.busy': false });
  },
  async followEvent() {
    const f = this.data.follow;
    if (f.busy || !this.data.event || this.data.unavailable || !this.id) return;
    if (f.state === 'signedOut') {
      this.followLogin();
      return;
    }
    if (f.state !== 'none') return;
    const publicId = this.id;
    const before = this._followGen;
    const name = this.data.event.name;
    const status = this.data.event.status;
    const available = () =>
      this.id === publicId &&
      !this.data.unavailable &&
      this.data.event &&
      this.data.event.name === name &&
      this.data.event.status === status;
    const op = await ui.confirmOp(
      this,
      '关注此公开赛事',
      '关注后可在「我的关注」查看。微信提醒未启用，不会发送订阅消息。',
    );
    if (!op || before !== this._followGen || !available()) return;
    const gen = (this._followGen = (this._followGen || 0) + 1);
    const still = () => op.valid() && gen === this._followGen && !this.closed && available();
    if (!still()) return;
    this.setData({ 'follow.busy': true, 'follow.error': '', 'follow.notice': '' });
    const client = api.getClient();
    try {
      // Asynchronous preparation: re-read the current state; an existing follow needs no write.
      const existing = await follows.lookup(client, publicId);
      if (!still()) return this._followAbandon(gen);
      if (existing && existing.status !== 'ACTIVE') {
        this.setData({
          follow: { ...FOLLOW_START, state: 'invalid', followId: existing.followId },
        });
        return;
      }
      const item = existing || (await follows.create(client, publicId));
      if (!still()) return this._followAbandon(gen);
      this.setData({
        follow: {
          ...FOLLOW_START,
          state: item.status === 'ACTIVE' ? 'active' : 'invalid',
          followId: item.followId,
          notice: item.status === 'ACTIVE' ? '关注成功，可在「我的关注」查看。' : '',
        },
      });
    } catch (error) {
      if (!still()) return this._followAbandon(gen);
      this.setData({
        follow: {
          ...FOLLOW_START,
          state: error && error.status === 404 ? 'none' : 'unknown',
          error: follows.failure(error, 'follow'),
        },
      });
    }
  },
  async cancelFollow() {
    const f = this.data.follow;
    if (f.busy || !f.followId || !['active', 'invalid'].includes(f.state)) return;
    const followId = f.followId;
    const before = this._followGen;
    const op = await ui.confirmOp(this, '取消关注', '取消后此赛事不再出现在「我的关注」。');
    if (!op || before !== this._followGen || this.data.follow.state !== f.state) return;
    const gen = (this._followGen = (this._followGen || 0) + 1);
    const still = () => op.valid() && gen === this._followGen && !this.closed;
    if (!still() || this.data.follow.followId !== followId) return;
    this.setData({ 'follow.busy': true, 'follow.error': '', 'follow.notice': '' });
    try {
      await follows.cancel(api.getClient(), followId);
      if (!still()) return this._followAbandon(gen);
      this.setData({ follow: { ...FOLLOW_START, state: 'none', notice: '已取消关注。' } });
    } catch (error) {
      if (!still()) return this._followAbandon(gen);
      this.setData({
        follow: {
          ...this.data.follow,
          busy: false,
          state: error && error.status === 404 ? 'unknown' : this.data.follow.state,
          error: follows.failure(error, 'cancel'),
        },
      });
    }
  },
  report() {
    if (this.id && this.data.event)
      ui.open('governance', { sourceKind: 'PUBLIC_EVENT', sourceId: this.id });
  },
  onShareAppMessage() {
    if (!this.id) return { title: '小城市篮球', path: '/pages/home/index' };
    return {
      title: this.data.event ? this.data.event.name : '小城市篮球',
      path: '/pages/event/index?event=' + this.id,
    };
  },
});
