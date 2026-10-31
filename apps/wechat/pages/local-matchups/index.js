const api = require('../../utils/api');
const ui = require('../../utils/ui');
const ls = require('../../utils/local-services');
const parseCard = (value) => {
  const s = String(value || '').trim();
  const m = /^\/pages\/team\/index\?orgId=([0-9a-f-]{36})&teamId=([0-9a-f-]{36})$/i.exec(s);
  if (!m) throw new Error('请粘贴对方分享的球队名片链接。');
  return { orgId: ls.id(m[1]), teamId: ls.id(m[2]) };
};
Page({
  data: {
    teams: [],
    teamIndex: 0,
    courtBookings: [],
    bookingIndex: 0,
    opponentCard: '',
    opponent: null,
    terms: '',
    reason: '',
    items: [],
    selected: null,
    loading: false,
    busy: false,
    error: '',
    message: '',
    pending: null,
    pendingError: '',
    loginRequired: false,
  },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    if (!this.data.busy) this.load();
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  onSessionReset() {
    this._viewer = '';
    this.setData({
      teams: [],
      courtBookings: [],
      opponentCard: '',
      opponent: null,
      terms: '',
      reason: '',
      items: [],
      selected: null,
      loading: false,
      busy: false,
      pending: null,
      pendingError: '',
      loginRequired: true,
      error: '登录身份已变化，请重新读取。',
    });
  },
  login() {
    ui.login('/pages/local-matchups/index');
  },
  async load() {
    if (this.data.busy) return;
    ui.begin(this);
    this.setData({
      loading: true,
      error: '',
      items: [],
      selected: null,
      teams: [],
      courtBookings: [],
    });
    const session = await ui.session(this, '/pages/local-matchups/index');
    if (!this._alive || !session) return;
    this._viewer = session.user.id;
    ls.loadPending(this);
    const token = ui.begin(this);
    try {
      const repo = ls.repository(),
        [items, bookings] = await Promise.all([repo.matchups(), repo.bookings()]);
      if (ui.live(this, token)) {
        const teams = session.teamContexts.map((t) => ({
          orgId: ls.id(t.orgId),
          teamId: ls.id(t.teamId),
          name: t.teamName + ' · ' + t.organizationName,
        }));
        this.setData({
          items,
          teams,
          teamIndex: 0,
          courtBookings: bookings
            .filter((b) => b.kind === 'COURT' && b.canActAs === 'BUYER' && b.status === 'CONFIRMED')
            .map((b) => ({ ...b, label: b.title + ' · ' + b.timeText })),
          bookingIndex: 0,
          loading: false,
        });
      }
    } catch (e) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(e) });
    }
  },
  input(e) {
    if (this.data.busy) return;
    const f = e.currentTarget.dataset.field;
    if (['opponentCard', 'terms', 'reason'].includes(f))
      this.setData({ [f]: e.detail.value, ...(f === 'opponentCard' ? { opponent: null } : {}) });
  },
  pick(e) {
    const f = e.currentTarget.dataset.field;
    if (['teamIndex', 'bookingIndex'].includes(f) && !this.data.busy)
      this.setData({ [f]: Number(e.detail.value) });
  },
  card() {
    const t = this.data.teams[this.data.teamIndex];
    if (t && typeof wx.setClipboardData === 'function')
      wx.setClipboardData({ data: '/pages/team/index?orgId=' + t.orgId + '&teamId=' + t.teamId });
  },
  opponent() {
    try {
      const opponent = parseCard(this.data.opponentCard),
        t = this.data.teams[this.data.teamIndex];
      if (t && t.teamId === opponent.teamId) throw new Error('不能与同一球队约赛。');
      this.setData({
        opponent,
        error: '',
        message: '名片格式已核对。提交后服务器会核验球队与双方授权；不会授予对方的球队管理权限。',
      });
    } catch (e) {
      this.setData({ opponent: null, error: ui.message(e) });
    }
  },
  async create() {
    try {
      const t = this.data.teams[this.data.teamIndex],
        b = this.data.courtBookings[this.data.bookingIndex];
      if (!t) throw new Error('当前没有有效球队管理身份。');
      if (!b) throw new Error('请先以本人账号完成真实球场预约并确认。');
      const away = this.data.opponent;
      if (!away) throw new Error('请先核对对方的球队名片。');
      const body = {
        homeOrgId: t.orgId,
        homeTeamId: t.teamId,
        awayOrgId: away.orgId,
        awayTeamId: away.teamId,
        courtBookingId: b.id,
        terms: ls.text(this.data.terms, '约赛约定', 4, 1000),
      };
      const result = await ls.write(this, {
        path: '/v1/local-matchups',
        body,
        label: '发起球队约赛',
        content:
          t.name +
          '，' +
          b.label +
          '，' +
          b.address +
          '。邀请30分钟内需由对方独立管理人员确认；双方球队、场地与时间会统一检查冲突。',
      });
      if (result) await this.load();
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  select(e) {
    if (this.data.busy) return;
    const selected = this.data.items.find((v) => v.id === e.currentTarget.dataset.id);
    if (selected) this.setData({ selected, reason: '' });
  },
  async command(e) {
    const r = this.data.selected;
    if (!r) return;
    try {
      const type = e.currentTarget.dataset.type,
        body = {
          expectedVersion: r.version,
          type,
          reason: ls.text(this.data.reason, '约赛操作说明', 4, 500),
        };
      const result = await ls.write(this, {
        path: '/v1/local-matchups/' + r.id + '/commands',
        body,
        label: {
          CONFIRM: '确认球队约赛',
          DECLINE: '拒绝约赛',
          CANCEL: '取消约赛',
          COMPLETE: '登记约赛完成',
        }[type],
        content:
          r.homeTeamName +
          ' 与 ' +
          r.awayTeamName +
          '，' +
          r.timeText +
          '，' +
          r.address +
          '。确认需由对方独立管理人员完成；改时间先取消本约赛并完成球场双方改期后重新发起。',
      });
      if (result) await this.load();
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  find() {
    ls.open('local');
  },
  bookings() {
    ls.open('local-bookings');
  },
  recover() {
    return ls.recover(this);
  },
  retry() {
    return ls.retry(this);
  },
});
