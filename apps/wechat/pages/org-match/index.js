const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const scoring = require('../../utils/scoring');

const POLL_MS = 5000;
const privateDefaults = {
  match: null,
  board: null,
  history: [],
  historyError: '',
  confirmations: [],
  staff: [],
  caps: null,
  unavailable: false,
  pending: null,
  reopenOpen: false,
  reopenReason: '',
  collectionMode: 'TEAM_ONLY',
  members: [],
  memberIndex: 0,
  roleIndex: 0,
  staffNote: '',
};
const ROLES = [
  { value: 'SCORER', label: '记分员' },
  { value: 'RESULT_REVIEWER', label: '赛果复核人' },
];

function staffView(list) {
  return (list || [])
    .filter((s) => s && s.status === 'ACTIVE')
    .map((s) => ({
      key: s.userId + ':' + s.role,
      userId: s.userId,
      roleValue: s.role,
      name: s.displayName,
      role: s.role === 'SCORER' ? '记分员' : '赛果复核人',
    }));
}

Page({
  data: { loading: false, busy: false, error: '', notice: '', roles: ROLES, ...privateDefaults },
  onLoad(query) {
    this._alive = true;
    try {
      this.orgId = api.uuid(query.orgId);
      this.matchId = api.uuid(query.matchId);
    } catch {
      this.setData({ unavailable: true, error: '比赛入口无效，请从赛事赛程重新进入。' });
      return;
    }
    this.load();
  },
  onShow() {
    if (this._shown) this.load(false);
    this._shown = true;
  },
  onHide() {
    this.stopPolling();
  },
  onUnload() {
    this._alive = false;
    this._load = (this._load || 0) + 1;
    this.stopPolling();
    ui.close(this);
  },
  onSessionReset() {
    this._load = (this._load || 0) + 1;
    this.stopPolling();
    this.setData({
      ...privateDefaults,
      loading: false,
      busy: false,
      error: '登录身份已变化，已清除上一身份的比赛资料，请重新读取。',
    });
  },
  base() {
    return '/v1/orgs/' + this.orgId + '/matches/' + this.matchId;
  },
  stopPolling() {
    if (this._poll) clearInterval(this._poll);
    this._poll = null;
  },
  startPolling() {
    this.stopPolling();
    this._poll = setInterval(() => {
      if (!this.data.busy && !this.data.loading) this.load(true);
    }, POLL_MS);
  },
  // Bound to the buttons; the tap event must never be read as `quiet`.
  refresh() {
    this.load(false);
  },
  // Reads never start while a write is in flight: the write re-reads when it ends, and hold()
  // has already discarded any read that was started before it.
  async load(quiet) {
    quiet = quiet === true;
    if (!this.orgId || this.data.loading || this.data.busy) return;
    const client = api.getClient();
    const load = (this._load = (this._load || 0) + 1);
    const current = () => this._alive && load === this._load;
    if (!client.hasSession()) {
      this.setData({ ...privateDefaults, unavailable: true, error: '请先登录后查看比赛。' });
      return;
    }
    if (!quiet) this.setData({ loading: true, error: '' });
    let session;
    try {
      session = await events.session(client);
    } catch (error) {
      if (current())
        this.setData({
          ...privateDefaults,
          loading: false,
          unavailable: error.status === 401,
          error: error.status === 401 ? '请先登录后查看比赛。' : ui.message(error),
        });
      return;
    }
    if (!current()) return;
    if (this._viewer && this._viewer !== session.user.id) this.setData({ ...privateDefaults });
    this._viewer = session.user.id;
    const token = ui.begin(this);
    const live = () => ui.live(this, token) && current();
    let wb, receivedAt;
    try {
      wb = (await client.request(this.base() + '/scoring')).data;
      receivedAt = Date.now();
      if (!wb || !wb.match || !wb.capabilities) throw { message: '比赛资料格式无效' };
    } catch (error) {
      if (!live()) return;
      const hidden = error.status === 401 || error.status === 403 || error.status === 404;
      this.stopPolling();
      this.setData({
        ...(hidden ? privateDefaults : {}),
        loading: false,
        unavailable: hidden,
        error: hidden ? '该比赛不存在或当前身份无权查看。' : scoring.failure(error),
      });
      return;
    }
    let history = [],
      confirmations = [],
      historyError = '';
    if (wb.snapshot) {
      try {
        const names = {};
        for (const p of [...wb.playerRoster.home, ...wb.playerRoster.away])
          names[p.memberId] = p.jerseyNo + '号 ' + p.name;
        const [list, confirmed] = await Promise.all([
          scoring.allPages(client, this.base() + '/scoring-events'),
          scoring.allPages(client, this.base() + '/result-confirmations'),
        ]);
        history = scoring.history(list, wb.snapshot, names).slice(0, 60);
        const staffNames = {};
        for (const s of wb.staff) staffNames[s.userId] = s.displayName;
        confirmations = confirmed
          .slice()
          .reverse()
          .map((c) => ({
            key: c.id,
            score: c.home.score + ' : ' + c.away.score,
            by: staffNames[c.confirmingUserId] || '赛事负责人',
            time: ui.localTime(c.confirmedAt),
          }));
      } catch (error) {
        historyError = scoring.failure(error);
      }
    }
    if (!live()) return;
    const m = wb.match;
    this._eventVersion = wb.event.version;
    this._matchVersion = wb.snapshot ? wb.snapshot.version : m.version;
    this.setData({
      loading: false,
      unavailable: false,
      match: {
        eventName: wb.event.name,
        eventId: wb.event.id,
        eventClosed: ['COMPLETED', 'ARCHIVED'].includes(wb.event.status),
        round: '第' + m.roundNo + '轮',
        time: ui.localTime(m.startsAt),
        court: m.courtName || '场地待定',
        home: m.home.teamName,
        away: m.away.teamName,
        status: m.status,
        statusLabel: api.matchStatus(m.status),
        rulesLabel: wb.rules
          ? wb.rules.regulationPeriods +
            '节 × ' +
            scoring.duration(wb.rules.periodDurationSeconds) +
            (wb.rules.tiePolicy === 'OVERTIME' ? ' · 平分加时' : ' · 允许平局')
          : '赛事尚未设置记分规则',
        leaseHeld: !!(wb.lease && wb.lease.held),
      },
      board: scoring.board(wb.snapshot, receivedAt),
      history,
      historyError,
      confirmations,
      staff: staffView(wb.staff),
      caps: {
        staff: !!wb.capabilities.canManageStaff,
        prepare: !!wb.capabilities.canPrepare && !!wb.rules,
        score: !!wb.capabilities.canAcquireControl,
        confirm: !!wb.capabilities.canConfirm,
        reopen: !!wb.capabilities.canReopen,
      },
    });
    if (wb.capabilities.canManageStaff && !quiet) this.loadMembers();
    if (m.status === 'LIVE' && !this._poll) this.startPolling();
    if (m.status !== 'LIVE') this.stopPolling();
  },
  // Only the organization owner can list members; others assign through the Web console.
  async loadMembers() {
    const token = ui.guard(this);
    const n = (this._members = (this._members || 0) + 1);
    const live = () => ui.held(this, token) && n === this._members;
    try {
      const list = (await api.getClient().request('/v1/orgs/' + this.orgId + '/members')).data;
      if (!live()) return;
      this.setData({
        members: list
          .filter((v) => v.status === 'ACTIVE')
          .map((v) => ({ userId: v.userId, label: v.displayName + ' · ' + v.email })),
        memberIndex: 0,
        staffNote: '',
      });
    } catch (error) {
      if (live())
        this.setData({
          members: [],
          staffNote:
            error && error.status === 403
              ? '只有机构负责人可以在小程序内选择成员分配；其他管理员请在Web赛事工作台分配。'
              : scoring.failure(error),
        });
    }
  },
  pickMember(e) {
    this.setData({ memberIndex: Number(e.detail.value) || 0 });
  },
  pickRole(e) {
    this.setData({ roleIndex: Number(e.detail.value) === 1 ? 1 : 0 });
  },
  async staff(userId, role, status, label) {
    if (this.data.busy || this.data.pending) return;
    const version = this._matchVersion;
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      await api.getClient().request(this.base() + '/staff/' + api.uuid(userId), 'PUT', {
        expectedMatchVersion: version,
        role,
        status,
      });
      if (!ui.held(this, token)) return;
      this.setData({ busy: false, notice: label });
      await this.load(true);
    } catch (error) {
      if (!ui.held(this, token)) return;
      this.setData({ busy: false, error: scoring.failure(error) });
      if (error && error.code === 'VERSION_CONFLICT') await this.load(true);
    }
  },
  assign() {
    const member = this.data.members[this.data.memberIndex];
    const role = ROLES[this.data.roleIndex];
    if (member) this.staff(member.userId, role.value, 'ACTIVE', '已分配' + role.label + '。');
  },
  async disable(e) {
    const row = this.data.staff.find((s) => s.key === e.currentTarget.dataset.key);
    if (!row) return;
    if (
      !(await ui.confirm(
        '停用' + row.role,
        row.name + '将不能再处理本场；正在持有的记分控制随之失效。',
      ))
    )
      return;
    this.staff(row.userId, row.roleValue, 'DISABLED', '已停用' + row.role + '。');
  },
  setMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (['TEAM_ONLY', 'PLAYER_BASIC'].includes(mode)) this.setData({ collectionMode: mode });
  },
  async run(type, payload, title, content) {
    if (this.data.busy || this.data.pending) return;
    // CAS against the version the organizer saw when confirming; a poll that lands while the
    // dialog is open makes the command conflict and re-read instead of acting on newer data.
    const version = this._matchVersion;
    if (!(await ui.confirm(title, content))) return;
    if (this.data.busy || this.data.pending) return;
    const client = api.getClient();
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      const body = await scoring.envelope(type, payload, version);
      const outcome = await scoring.send(client, this.base(), body);
      if (!ui.held(this, token)) return;
      if (!outcome.done) {
        this.setData({
          busy: false,
          pending: { body: outcome.pending, label: scoring.commandNames[type] },
          error:
            '网络中断，' + scoring.commandNames[type] + '结果未知。请先核对结果，不要换新操作。',
        });
        return;
      }
      this.setData({
        busy: false,
        notice: scoring.commandNames[type] + '已完成。',
        reopenOpen: false,
      });
      await this.load(true);
    } catch (error) {
      if (!ui.held(this, token)) return;
      this.setData({ busy: false, error: scoring.failure(error) });
      if (['VERSION_CONFLICT', 'INVALID_MATCH_STATE'].includes(error && error.code))
        await this.load(true);
    }
  },
  prepare() {
    const mode = this.data.collectionMode;
    this.run(
      'PREPARE_MATCH',
      { expectedEventVersion: this._eventVersion, collectionMode: mode },
      '准备比赛',
      (mode === 'PLAYER_BASIC' ? '逐人记录得分与犯规' : '只记录球队比分、犯规与暂停') +
        '；准备后记分规则锁定，采集方式不可更改。',
    );
  },
  confirmResult() {
    const b = this.data.board;
    if (!b) return;
    this.run(
      'CONFIRM_RESULT',
      {},
      '独立确认赛果',
      b.home.name +
        ' ' +
        b.home.score +
        ' : ' +
        b.away.score +
        ' ' +
        b.away.name +
        '。确认后计入正式积分；你不能是本场记分或时钟操作者。',
    );
  },
  toggleReopen() {
    this.setData({ reopenOpen: !this.data.reopenOpen, reopenReason: '' });
  },
  reopenInput(e) {
    this.setData({ reopenReason: String(e.detail.value || '').slice(0, 500) });
  },
  reopen() {
    const reason = this.data.reopenReason.trim();
    if (!reason) {
      this.setData({ error: '请填写重开原因。' });
      return;
    }
    this.run(
      'REOPEN_RESULT',
      { reason },
      '重开赛果',
      '原确认记录保留；本场退出正式积分，更正后须重新独立确认。',
    );
  },
  async checkPending() {
    const pending = this.data.pending;
    if (!pending || this.data.busy) return;
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '' });
    try {
      const found = await scoring.receipt(api.getClient(), this.base(), pending.body.commandId);
      if (!ui.held(this, token)) return;
      if (found) {
        this.setData({ busy: false, pending: null, notice: pending.label + '已在服务端完成。' });
        await this.load(true);
      } else
        this.setData({
          busy: false,
          error: '服务端暂无该操作记录。可按原编号重发同一操作；不会重复执行。',
        });
    } catch (error) {
      if (ui.held(this, token)) this.setData({ busy: false, error: scoring.failure(error) });
    }
  },
  async resendPending() {
    const pending = this.data.pending;
    if (!pending || this.data.busy) return;
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '' });
    try {
      const outcome = await scoring.send(api.getClient(), this.base(), pending.body);
      if (!ui.held(this, token)) return;
      if (!outcome.done) {
        this.setData({ busy: false, error: '仍未连接到服务，请恢复网络后再核对。' });
        return;
      }
      this.setData({ busy: false, pending: null, notice: pending.label + '已完成。' });
      await this.load(true);
    } catch (error) {
      if (!ui.held(this, token)) return;
      this.setData({ busy: false, pending: null, error: scoring.failure(error) });
      await this.load(true);
    }
  },
  openScorer() {
    ui.open('scorer', { orgId: this.orgId, matchId: this.matchId });
  },
  openEvent() {
    const m = this.data.match;
    if (m) ui.open('org-event', { orgId: this.orgId, eventId: m.eventId });
  },
});
