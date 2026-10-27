const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const plan = require('../../utils/schedule');

// Formal rescheduling of one published match (P04-B). This is not the draft scheduler: the
// original publication snapshot stays as published, and each change is its own history record.
// The server computes the end time from the original policy and re-checks every conflict.
const MAX_PAGES = 10;
const privateDefaults = {
  match: null,
  history: [],
  truncated: false,
  canReschedule: false,
  blocker: '',
  courts: [],
  courtIndex: 0,
  date: '',
  time: '',
  reason: '',
  conflicts: [],
  uncertain: false,
  unavailable: false,
};
const errorText = {
  VERSION_CONFLICT: '比赛或赛事已被其他操作更新，已重新读取；填写内容已保留，请核对后再提交。',
  RESCHEDULE_UNCHANGED: '场地和开赛时间没有变化。',
  SCHEDULE_CONFLICT: '改期安排存在冲突，请调整场地或时间。',
  INVALID_EVENT_STATE: '当前赛事状态不允许改期。',
  MATCH_CANNOT_RESCHEDULE: '比赛已开始或已有记分记录，不能改期。',
  RESCHEDULE_SOURCE_INVALID: '赛程来源暂时无法核验，请稍后重新读取。',
  KNOCKOUT_DEPENDENCY_ORDER: '淘汰赛比赛不能早于来源比赛结束。',
  FORBIDDEN: '当前身份没有改期权限，由服务端核验。',
};
const unknown = (error) =>
  !!error && (error.code === 'NETWORK_ERROR' || error.code === 'SESSION_CHANGED' || !error.status);
function failure(error) {
  if (unknown(error)) return '网络中断，改期结果未知。请先重新读取核对，不会自动重发。';
  return (error && errorText[error.code]) || ui.message(error);
}
function plain(p) {
  return p.courtName + ' · ' + ui.localTime(p.startsAt, true) + '–' + ui.timePart(p.endsAt);
}

Page({
  data: { loading: false, busy: false, error: '', notice: '', ...privateDefaults },
  onLoad(query = {}) {
    this._alive = true;
    try {
      this.orgId = api.uuid(query.orgId);
      this.matchId = api.uuid(query.matchId);
    } catch {
      this.setData({ unavailable: true, error: '改期入口无效，请从比赛详情重新进入。' });
      return;
    }
    this.load();
  },
  onUnload() {
    this._alive = false;
    this._load = (this._load || 0) + 1;
    ui.close(this);
  },
  onSessionReset() {
    this._load = (this._load || 0) + 1;
    this._data = null;
    this.setData({
      ...privateDefaults,
      loading: false,
      busy: false,
      error: '登录身份已变化，已清除上一身份的改期资料。',
    });
  },
  base() {
    return '/v1/orgs/' + this.orgId + '/matches/' + this.matchId;
  },
  async load() {
    if (!this.orgId || this.data.loading || this.data.busy) return;
    const client = api.getClient();
    const load = (this._load = (this._load || 0) + 1);
    const current = () => this._alive && load === this._load;
    if (!client.hasSession()) {
      this.setData({ ...privateDefaults, unavailable: true, error: '请先登录后改期。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      await events.session(client);
    } catch (error) {
      if (current()) this.setData({ ...privateDefaults, loading: false, error: ui.message(error) });
      return;
    }
    if (!current()) return;
    const token = ui.begin(this);
    const live = () => ui.live(this, token) && current();
    try {
      const data = (await client.request(this.base() + '/rescheduling')).data;
      let courts = [],
        cursor = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await client.request(
          '/v1/orgs/' +
            this.orgId +
            '/courts?limit=100' +
            (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
        );
        courts = courts.concat(response.data);
        cursor = response.meta.nextCursor;
        if (!cursor) break;
      }
      if (!live()) return;
      this.show(data, courts);
    } catch (error) {
      if (!live()) return;
      const hidden = error.status === 401 || error.status === 403 || error.status === 404;
      this.setData({
        ...(hidden ? privateDefaults : {}),
        loading: false,
        unavailable: hidden,
        error: hidden ? '该比赛不存在或当前身份无权查看改期。' : failure(error),
      });
    }
  },
  show(data, courts) {
    this._data = data;
    const m = data.match;
    const active = courts.filter((c) => c.status === 'ACTIVE');
    // Keep what the organizer typed across a re-read; otherwise start from the current plan.
    const keep = !!this._edited;
    const courtId = keep ? this._courtId : m.courtId;
    const index = Math.max(
      0,
      active.findIndex((c) => c.id === courtId),
    );
    const open = ['SCHEDULED', 'READY'].includes(m.status);
    this.setData({
      loading: false,
      unavailable: false,
      uncertain: false,
      match: {
        eventName: data.event.name,
        round: '第' + m.roundNo + '轮',
        home: m.home.teamName,
        away: m.away.teamName,
        status: m.status,
        statusLabel: api.matchStatus(m.status),
        plan: plain(m),
        duration: data.policy.slotDurationMinutes,
      },
      history: data.history.map((h) => ({
        key: h.id,
        from: plain(h.from),
        to: plain(h.to),
        reason: h.reason,
        time: ui.localTime(h.createdAt, true),
      })),
      truncated: data.historyTruncated,
      canReschedule: !!data.capabilities.canReschedule,
      blocker: data.capabilities.canReschedule
        ? ''
        : !open
          ? '比赛已开始、结束或已取消，不能改期。'
          : ['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(data.event.status)
            ? '赛事已完赛、归档或取消，不能改期。'
            : '当前身份可查看但不能改期（须为机构负责人、管理员或本届赛事管理员）。',
      courts: active.map((c) => ({ id: c.id, name: c.name })),
      courtIndex: index,
      date: keep ? this.data.date : ui.datePart(m.startsAt),
      time: keep ? this.data.time : ui.timePart(m.startsAt),
      reason: keep ? this.data.reason : '',
    });
    this._courtId = active[index] ? active[index].id : '';
  },
  pickCourt(e) {
    const i = Number(e.detail.value);
    if (!this.data.courts[i]) return;
    this._edited = true;
    this._courtId = this.data.courts[i].id;
    this.setData({ courtIndex: i, conflicts: [] });
  },
  pickDate(e) {
    this._edited = true;
    this.setData({ date: String(e.detail.value).slice(0, 10), conflicts: [] });
  },
  pickTime(e) {
    this._edited = true;
    this.setData({ time: String(e.detail.value).slice(0, 5), conflicts: [] });
  },
  reasonInput(e) {
    this._edited = true;
    this.setData({ reason: String(e.detail.value || '').slice(0, 500) });
  },
  async submit() {
    const data = this._data;
    if (!data || !this.data.canReschedule || this.data.busy || this.data.uncertain) return;
    let body;
    try {
      const reason = this.data.reason.trim();
      if (Array.from(reason).length < 1 || Array.from(reason).length > 500)
        throw new Error('请填写改期原因（1–500字）');
      if (!this._courtId) throw new Error('请选择可用场地');
      body = {
        type: 'RESCHEDULE',
        expectedEventVersion: data.event.version,
        expectedMatchVersion: data.match.version,
        courtId: this._courtId,
        startsAt: ui.chinaStamp(this.data.date, this.data.time),
        reason,
      };
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const court = this.data.courts[this.data.courtIndex];
    if (
      !(await ui.confirm(
        '正式改期',
        '改为 ' +
          (court ? court.name : '') +
          ' · ' +
          this.data.date +
          ' ' +
          this.data.time +
          '。原发布记录保留，本次改动单独记入改期历史。',
      ))
    )
      return;
    if (this.data.busy || this.data.uncertain) return;
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '', conflicts: [] });
    try {
      await api.getClient().request(this.base() + '/reschedule-commands', 'POST', body);
      if (!ui.held(this, token)) return;
      this._edited = false;
      this.setData({ busy: false, notice: '改期已保存，改期记录已追加。' });
      await this.load();
    } catch (error) {
      if (!ui.held(this, token)) return;
      const message = failure(error);
      const details =
        error && error.details && Array.isArray(error.details.conflicts)
          ? error.details.conflicts
          : [];
      const conflicts = details.slice(0, 20).map((c, i) => ({
        key: String(i),
        label: plan.conflictLabels[c.code] || c.code,
        scope: c.fixtureKeys.includes(data.match.fixtureKey)
          ? c.fixtureKeys.length > 1
            ? '与同届其他比赛'
            : '本场'
          : '其他比赛',
        external: !!c.external,
      }));
      this.setData({ busy: false, error: message, uncertain: unknown(error), conflicts });
      if (error && error.code === 'VERSION_CONFLICT') {
        await this.load();
        if (ui.held(this, token) && !this.data.unavailable) this.setData({ error: message });
      }
    }
  },
  openMatch() {
    ui.open('org-match', { orgId: this.orgId, matchId: this.matchId });
  },
});
