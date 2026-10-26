const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const scoring = require('../../utils/scoring');

const RENEW_MS = 10000;
const TICK_MS = 1000;
const NO_PLAYER = { memberId: '', label: '不归属到个人' };
const privateDefaults = {
  match: null,
  board: null,
  history: [],
  roster: { home: [NO_PLAYER], away: [NO_PLAYER] },
  pick: { home: 0, away: 0 },
  held: false,
  canControl: false,
  leaseNote: '',
  unavailable: false,
  pending: null,
  voidTarget: null,
  voidReason: '',
  clockOpen: false,
  clockValue: '',
  clockReason: '',
  fixOpen: false,
  fix: { kind: 'SCORE', side: 'HOME', value: 2, period: 1, reason: '' },
};

function rosterOptions(list) {
  return [
    NO_PLAYER,
    ...(list || []).map((p) => ({ memberId: p.memberId, label: p.jerseyNo + '号 ' + p.name })),
  ];
}

Page({
  data: { loading: false, busy: false, error: '', notice: '', ...privateDefaults },
  onLoad(query) {
    this._alive = true;
    try {
      this.orgId = api.uuid(query.orgId);
      this.matchId = api.uuid(query.matchId);
    } catch {
      this.setData({ unavailable: true, error: '记分入口无效，请从比赛详情重新进入。' });
      return;
    }
    this.load();
  },
  onUnload() {
    this._alive = false;
    this._load = (this._load || 0) + 1;
    this.release();
    ui.close(this);
  },
  onSessionReset() {
    this._load = (this._load || 0) + 1;
    this.dropControl();
    this.setData({
      ...privateDefaults,
      loading: false,
      busy: false,
      error: '登录身份已变化，记分控制已停止，请重新登录后再进入。',
    });
  },
  base() {
    return '/v1/orgs/' + this.orgId + '/matches/' + this.matchId;
  },
  dropControl() {
    if (this._renew) clearInterval(this._renew);
    if (this._tick) clearInterval(this._tick);
    this._renew = null;
    this._tick = null;
    this._control = null;
  },
  release() {
    const control = this._control;
    this.dropControl();
    // Best effort: an expired or unreachable release simply lets the 30s lease lapse.
    if (control)
      api
        .getClient()
        .request(this.base() + '/scorekeeper-lease', 'DELETE', { control })
        .catch(() => {});
  },
  show(snapshot, receivedAt) {
    this._snapshot = snapshot;
    this._receivedAt = receivedAt;
    this._matchVersion = snapshot ? snapshot.version : this._matchVersion;
    const board = scoring.board(snapshot, receivedAt);
    if (snapshot)
      this.setData({
        'match.status': snapshot.status,
        'match.statusLabel': api.matchStatus(snapshot.status),
      });
    this.setData({ board });
    if (board && board.running && !this._tick)
      this._tick = setInterval(() => {
        if (this._snapshot)
          this.setData({
            'board.clockLabel': scoring.board(this._snapshot, this._receivedAt).clockLabel,
          });
      }, TICK_MS);
    if ((!board || !board.running) && this._tick) {
      clearInterval(this._tick);
      this._tick = null;
    }
  },
  async load() {
    if (!this.orgId || this.data.loading || this.data.busy) return;
    const client = api.getClient();
    const load = (this._load = (this._load || 0) + 1);
    const current = () => this._alive && load === this._load;
    if (!client.hasSession()) {
      this.setData({ ...privateDefaults, unavailable: true, error: '请先登录后进入记分台。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    let session;
    try {
      session = await events.session(client);
    } catch (error) {
      if (current()) this.setData({ ...privateDefaults, loading: false, error: ui.message(error) });
      return;
    }
    if (!current()) return;
    if (this._viewer && this._viewer !== session.user.id) {
      this.dropControl();
      this.setData({ ...privateDefaults });
    }
    this._viewer = session.user.id;
    const token = ui.begin(this);
    try {
      const wb = (await client.request(this.base() + '/scoring')).data;
      const receivedAt = Date.now();
      if (!ui.live(this, token) || !current()) return;
      if (!wb || !wb.match || !wb.capabilities) throw { message: '比赛资料格式无效' };
      this._eventVersion = wb.event.version;
      this._matchVersion = wb.snapshot ? wb.snapshot.version : wb.match.version;
      this._names = {};
      for (const p of [...wb.playerRoster.home, ...wb.playerRoster.away])
        this._names[p.memberId] = p.jerseyNo + '号 ' + p.name;
      this.setData({
        loading: false,
        unavailable: false,
        canControl: !!wb.capabilities.canAcquireControl,
        match: {
          eventName: wb.event.name,
          home: wb.match.home.teamName,
          away: wb.match.away.teamName,
          status: wb.match.status,
          statusLabel: api.matchStatus(wb.match.status),
          closed: ['COMPLETED', 'ARCHIVED'].includes(wb.event.status),
        },
        roster: {
          home: rosterOptions(wb.playerRoster.home),
          away: rosterOptions(wb.playerRoster.away),
        },
        leaseNote:
          wb.lease && wb.lease.held && !this._control
            ? '当前有其他记分端持有控制；取得控制会使对方失去写入权。'
            : '',
      });
      this.show(wb.snapshot, receivedAt);
      if (wb.snapshot) this.refreshHistory();
      if (!wb.capabilities.canAcquireControl && !this._control)
        this.setData({ error: '当前身份不是本场有效记分员，只能查看。' });
    } catch (error) {
      if (!ui.live(this, token) || !current()) return;
      const hidden = error.status === 401 || error.status === 403 || error.status === 404;
      this.setData({
        ...(hidden ? privateDefaults : {}),
        loading: false,
        unavailable: hidden,
        error: hidden ? '该比赛不存在或当前身份无权记分。' : scoring.failure(error),
      });
    }
  },
  // Own counter and a session-only token: history neither cancels nor is cancelled by the
  // board read or a command, and only the newest history request is shown.
  async refreshHistory() {
    const token = ui.guard(this);
    const n = (this._history = (this._history || 0) + 1);
    try {
      const list = await scoring.allPages(api.getClient(), this.base() + '/scoring-events');
      if (ui.held(this, token) && n === this._history)
        this.setData({ history: scoring.history(list, this._snapshot, this._names).slice(0, 20) });
    } catch {
      /* History is supplementary; the board stays authoritative. */
    }
  },
  async acquire() {
    if (this.data.busy || this._control) return;
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    const token = ui.hold(this);
    try {
      // Memory only: a reload is a new client instance and never resumes old credentials.
      this._instance = this._instance || (await ui.uuid());
      const lease = (
        await api
          .getClient()
          .request(this.base() + '/scorekeeper-lease', 'POST', { clientInstanceId: this._instance })
      ).data;
      if (!ui.held(this, token)) return;
      this._control = {
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken,
        clientInstanceId: lease.clientInstanceId,
      };
      this._renew = setInterval(() => this.renew(), RENEW_MS);
      this.setData({ busy: false, held: true, leaseNote: '', notice: '已取得记分控制。' });
    } catch (error) {
      if (ui.held(this, token)) this.setData({ busy: false, error: scoring.failure(error) });
    }
  },
  async renew() {
    const control = this._control;
    if (!control) return;
    try {
      await api.getClient().request(this.base() + '/scorekeeper-lease/renew', 'POST', { control });
    } catch (error) {
      if (this._control !== control) return;
      // Stop writing at once; never keep sending with credentials that may have a successor.
      this.dropControl();
      this.show(this._snapshot, this._receivedAt);
      this.setData({
        held: false,
        error:
          error && error.code === 'NETWORK_ERROR'
            ? '网络中断，记分控制可能已过期，已停止写入。恢复后请重新取得控制并核对比分。'
            : '记分控制已失效（可能被其他记分端取得），已停止写入。',
      });
    }
  },
  async command(type, payload, label) {
    if (this.data.busy || this.data.pending) return;
    if (!this._control) {
      this.setData({ error: '请先取得记分控制。' });
      return;
    }
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    const token = ui.hold(this);
    try {
      const body = await scoring.envelope(type, payload, this._matchVersion, this._control);
      const outcome = await scoring.send(api.getClient(), this.base(), body);
      if (!ui.held(this, token)) return;
      if (!outcome.done) {
        this.setData({
          busy: false,
          pending: { body: outcome.pending, label },
          error: '网络中断，“' + label + '”结果未知。请先核对，不要重复点击。',
        });
        return;
      }
      this.show(outcome.result.snapshot, Date.now());
      this.setData({ busy: false, notice: label + ' 已记录' });
      this.refreshHistory();
    } catch (error) {
      if (!ui.held(this, token)) return;
      this.setData({ busy: false, error: scoring.failure(error) });
      if (error && error.code === 'LEASE_CONFLICT') {
        this.dropControl();
        this.setData({ held: false });
      }
      if (error && ['VERSION_CONFLICT', 'INVALID_MATCH_STATE'].includes(error.code)) this.load();
    }
  },
  async checkPending() {
    const pending = this.data.pending;
    if (!pending || this.data.busy) return;
    this.setData({ busy: true, loading: false, error: '' });
    const token = ui.hold(this);
    try {
      const found = await scoring.receipt(api.getClient(), this.base(), pending.body.commandId);
      if (!ui.held(this, token)) return;
      if (found) {
        this.show(found.snapshot, Date.now());
        this.setData({ busy: false, pending: null, notice: pending.label + ' 已在服务端记录' });
        this.refreshHistory();
      } else
        this.setData({
          busy: false,
          error: '服务端暂无该记录。确认网络恢复后，可按原编号重发同一操作，不会重复加分。',
        });
    } catch (error) {
      if (ui.held(this, token)) this.setData({ busy: false, error: scoring.failure(error) });
    }
  },
  async resendPending() {
    const pending = this.data.pending;
    if (!pending || this.data.busy) return;
    this.setData({ busy: true, loading: false, error: '' });
    const token = ui.hold(this);
    try {
      const outcome = await scoring.send(api.getClient(), this.base(), pending.body);
      if (!ui.held(this, token)) return;
      if (!outcome.done) {
        this.setData({ busy: false, error: '仍未连接到服务，请恢复网络后再核对。' });
        return;
      }
      this.show(outcome.result.snapshot, Date.now());
      this.setData({ busy: false, pending: null, notice: pending.label + ' 已记录' });
      this.refreshHistory();
    } catch (error) {
      if (!ui.held(this, token)) return;
      // A changed version or lost control means the original cannot be replayed; re-read.
      this.setData({ busy: false, pending: null, error: scoring.failure(error) });
      this.load();
    }
  },
  pickPlayer(e) {
    const side = e.currentTarget.dataset.side;
    if (side === 'home' || side === 'away')
      this.setData({ ['pick.' + side]: Number(e.detail.value) || 0 });
  },
  stat(e) {
    const { side, kind } = e.currentTarget.dataset;
    const value = Number(e.currentTarget.dataset.value || 1);
    if (!['HOME', 'AWAY'].includes(side) || !scoring.kinds[kind]) return;
    const key = side === 'HOME' ? 'home' : 'away';
    const payload = { kind, side, value };
    const option = this.data.roster[key][this.data.pick[key]];
    if (this.data.board && this.data.board.playerMode && kind !== 'TIMEOUT' && option)
      payload.memberId = option.memberId || null;
    const team = this.data.match[key];
    this.command(
      'RECORD_STAT',
      payload,
      team + ' ' + scoring.kinds[kind] + (kind === 'SCORE' ? ' +' + value : ''),
    );
  },
  start() {
    this.command('START_MATCH', { expectedEventVersion: this._eventVersion }, '开始比赛');
  },
  clock() {
    const running = this.data.board && this.data.board.running;
    this.command(running ? 'CLOCK_PAUSE' : 'CLOCK_START', {}, running ? '暂停计时' : '启动计时');
  },
  async nextPeriod() {
    if (await ui.confirm('进入下一节', '本节时钟须已归零并暂停。'))
      this.command('NEXT_PERIOD', {}, '进入下一节');
  },
  async overtime() {
    if (await ui.confirm('进入加时', '仅常规时间结束后平分且规则允许时可加时。'))
      this.command('START_OVERTIME', {}, '进入加时');
  },
  async end() {
    const b = this.data.board;
    if (
      b &&
      (await ui.confirm(
        '结束比赛',
        b.home.name +
          ' ' +
          b.home.score +
          ' : ' +
          b.away.score +
          ' ' +
          b.away.name +
          '。结束后进入待确认，须由他人独立确认才成为正式赛果。',
      ))
    )
      this.command('END_MATCH', {}, '结束比赛');
  },
  askVoid(e) {
    const id = e.currentTarget.dataset.id;
    const row = this.data.history.find((h) => h.id === id && h.canVoid);
    if (row) this.setData({ voidTarget: { id, text: row.text }, voidReason: '' });
  },
  voidInput(e) {
    this.setData({ voidReason: String(e.detail.value || '').slice(0, 500) });
  },
  cancelVoid() {
    this.setData({ voidTarget: null, voidReason: '' });
  },
  submitVoid() {
    const target = this.data.voidTarget;
    const reason = this.data.voidReason.trim();
    if (!target) return;
    if (!reason) {
      this.setData({ error: '请填写撤销原因。' });
      return;
    }
    this.setData({ voidTarget: null, voidReason: '' });
    this.command(
      'VOID_STAT',
      { targetEventId: api.uuid(target.id), reason },
      '撤销：' + target.text,
    );
  },
  toggleClock() {
    this.setData({ clockOpen: !this.data.clockOpen, clockValue: '', clockReason: '' });
  },
  clockInput(e) {
    const field = e.currentTarget.dataset.field;
    if (field === 'clockValue' || field === 'clockReason')
      this.setData({
        [field]: String(e.detail.value || '').slice(0, field === 'clockValue' ? 5 : 500),
      });
  },
  submitClock() {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(this.data.clockValue.trim());
    const reason = this.data.clockReason.trim();
    if (!match || !reason) {
      this.setData({ error: '请按“分:秒”填写剩余时间，并填写校时原因。' });
      return;
    }
    const remainingMs = (Number(match[1]) * 60 + Number(match[2])) * 1000;
    this.setData({ clockOpen: false });
    this.command('CLOCK_SET', { remainingMs, reason }, '校正时钟为 ' + this.data.clockValue.trim());
  },
  toggleFix() {
    const period = (this._snapshot && this._snapshot.clock && this._snapshot.clock.period) || 1;
    this.setData({
      fixOpen: !this.data.fixOpen,
      fix: { kind: 'SCORE', side: 'HOME', value: 2, period, reason: '' },
    });
  },
  fixField(e) {
    const field = e.currentTarget.dataset.field;
    const raw =
      e.currentTarget.dataset.value !== undefined ? e.currentTarget.dataset.value : e.detail.value;
    if (field === 'kind' && scoring.kinds[raw])
      this.setData({ 'fix.kind': raw, 'fix.value': raw === 'SCORE' ? 2 : 1 });
    if (field === 'side' && scoring.sides[raw]) this.setData({ 'fix.side': raw });
    if (field === 'value') this.setData({ 'fix.value': Number(raw) || 1 });
    if (field === 'period')
      this.setData({ 'fix.period': Math.max(1, Math.min(99, Number(raw) || 1)) });
    if (field === 'reason') this.setData({ 'fix.reason': String(raw || '').slice(0, 500) });
  },
  submitFix() {
    const fix = this.data.fix;
    const reason = fix.reason.trim();
    if (!reason) {
      this.setData({ error: '请填写补录原因。' });
      return;
    }
    const payload = {
      kind: fix.kind,
      side: fix.side,
      value: fix.kind === 'SCORE' ? fix.value : 1,
      period: fix.period,
      reason,
    };
    if (this.data.board && this.data.board.playerMode && fix.kind !== 'TIMEOUT')
      payload.memberId = null;
    this.setData({ fixOpen: false });
    this.command(
      'ADD_CORRECTION',
      payload,
      '补录' + scoring.sides[fix.side] + scoring.kinds[fix.kind],
    );
  },
});
