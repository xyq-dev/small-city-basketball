const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const scoring = require('../../utils/scoring');
const offline = require('../../utils/scoring-offline');

const RENEW_MS = 10000;
const TICK_MS = 1000;
const NO_PLAYER = { memberId: '', label: '不归属到个人' };
const privateDefaults = {
  match: null,
  board: null,
  history: [],
  roster: { home: [NO_PLAYER], away: [NO_PLAYER] },
  pick: { home: 0, away: 0 },
  proGroups: [],
  lineupCorrection: null,
  lineupDraft: { home: [], away: [] },
  subOut: { home: 0, away: 0 },
  subIn: { home: 0, away: 0 },
  held: false,
  canControl: false,
  leaseNote: '',
  unavailable: false,
  pending: null,
  offlineDraft: false,
  offlineItems: [],
  offlineError: '',
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
  data: {
    loading: false,
    busy: false,
    error: '',
    notice: '',
    technicalKinds: [
      { kind: 'REBOUND', label: '篮板' },
      { kind: 'ASSIST', label: '助攻' },
      { kind: 'STEAL', label: '抢断' },
      { kind: 'BLOCK', label: '盖帽' },
      { kind: 'TURNOVER', label: '失误' },
    ],
    ...privateDefaults,
  },
  onLoad(query) {
    this._alive = true;
    try {
      this._reportOnly = query.readOnly === '1';
      this.setData({ reportOnly: this._reportOnly });
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
    this._acquireOp = (this._acquireOp || 0) + 1;
    this._instance = null;
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
        'match.statusLabel': snapshot.adjudication
          ? snapshot.adjudication.kind === 'FORFEIT'
            ? '行政弃权已生效'
            : '本场已取消'
          : api.matchStatus(snapshot.status),
      });
    const pro = snapshot && snapshot.professionalStatistics;
    const proGroups = pro
      ? ['home', 'away'].map((key) => ({
          key,
          side: key === 'home' ? 'HOME' : 'AWAY',
          name: snapshot[key].teamName,
          players: pro[key].players.map((p) => ({
            ...p,
            label: p.jerseyNo + '号 ' + p.name,
            time:
              Math.floor(p.playingMs / 60000) +
              ':' +
              String(Math.floor(p.playingMs / 1000) % 60).padStart(2, '0'),
            shooting: p.fieldGoalsMade + '/' + p.fieldGoalsAttempted,
            percent: p.fieldGoalPercentage === null ? '无出手' : p.fieldGoalPercentage + '%',
            checked: pro[key].lineup.includes(p.memberId),
          })),
        }))
      : [];
    this.setData({
      board,
      proGroups,
      ...(pro ? { lineupDraft: { home: pro.home.lineup, away: pro.away.lineup } } : {}),
    });
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
    this.refreshOffline();
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
        canControl: !this._reportOnly && !!wb.capabilities.canAcquireControl,
        reportOnly: !!this._reportOnly,
        match: {
          eventName: wb.event.name,
          home: wb.match.home.teamName,
          away: wb.match.away.teamName,
          status: wb.match.status,
          statusLabel: wb.match.adjudication
            ? wb.match.adjudication.kind === 'FORFEIT'
              ? '行政弃权已生效'
              : '本场已取消'
            : api.matchStatus(wb.match.status),
          adjudication: wb.match.adjudication || null,
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
      this.refreshOffline();
      if (wb.snapshot) this.refreshHistory();
      if (wb.match.adjudication) {
        this.dropControl();
        this.setData({
          held: false,
          error: '',
          notice: '本场行政裁定已生效，不能记分，不计个人样本或出场。',
        });
      } else if (this._reportOnly) {
        this.setData({ error: '', notice: '专业统计与上场时间报表，只读查看。' });
      } else if (!wb.capabilities.canAcquireControl && !this._control)
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
    if (this._reportOnly || this.data.busy || this._control) return;
    // Bound to this page, session and attempt before the instance-id wait; a late id is
    // neither sent nor kept once the account changed, the user signed out or the page closed.
    const token = ui.hold(this);
    const attempt = (this._acquireOp = (this._acquireOp || 0) + 1);
    const live = () => ui.held(this, token) && attempt === this._acquireOp && !this._control;
    if (!live()) return;
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      // Memory only: a reload is a new client instance and never resumes old credentials.
      const instance = this._instance || (await ui.uuid());
      if (!live()) {
        if (ui.held(this, token)) this.setData({ busy: false });
        return;
      }
      this._instance = instance;
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
  // `op`: the confirmation a command follows (ui.confirmOp), if any. Both it and the control
  // that signed the envelope are re-checked after the secure-random wait, right before sending.
  // `expected`: for confirmed commands, the match version the scorer saw when the dialog
  // opened; the command is sent with it, and not at all if the page has moved on since.
  async command(type, payload, label, op, expected) {
    if (this._reportOnly) {
      this.setData({ error: '当前为只读报表。' });
      return;
    }
    if (this.data.busy || this.data.pending) return;
    if (op && !op.valid()) return;
    if (this.data.offlineDraft) {
      if (!offline.TYPES.includes(type)) {
        this.setData({ error: '此操作须在线完成，离线草稿只记录统计与更正。' });
        return;
      }
      return this.saveOffline(type, payload, label);
    }
    if (this.data.offlineItems.length) {
      this.setData({ error: '存在未同步草稿，请先按原顺序同步并核对。' });
      return;
    }
    if (!this._control) {
      this.setData({ error: '请先取得记分控制。' });
      return;
    }
    const control = this._control;
    const token = ui.hold(this);
    const version = expected === undefined ? this._matchVersion : expected;
    const live = () =>
      ui.held(this, token) &&
      (!op || op.valid()) &&
      this._control === control &&
      (expected === undefined || this._matchVersion === expected);
    if (!live()) return;
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      const body = await scoring.envelope(type, payload, version, control);
      if (!live()) {
        if (ui.held(this, token)) this.setData({ busy: false });
        return;
      }
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
  offlineScope() {
    return { actorId: this._viewer, orgId: this.orgId, matchId: this.matchId };
  },
  refreshOffline() {
    if (!this._viewer) return;
    try {
      const queue = offline.read(wx, this.offlineScope());
      this.setData({
        offlineItems: queue
          ? queue.items.map((i) => ({
              id: i.intentId,
              ordinal: i.ordinal,
              label: scoring.commandNames[i.command.type] || i.command.type,
              detail:
                (i.command.payload.side === 'HOME'
                  ? '主队'
                  : i.command.payload.side === 'AWAY'
                    ? '客队'
                    : '更正') +
                ' · ' +
                (scoring.kinds[i.command.payload.kind] ||
                  (i.command.payload.shotValue
                    ? i.command.payload.shotValue +
                      '分投篮' +
                      (i.command.payload.made ? '命中' : '未中')
                    : '撤销记录')) +
                ' ' +
                (i.command.payload.value || '') +
                ' ' +
                (i.command.payload.reason || ''),
            }))
          : [],
        offlineError: '',
      });
    } catch (error) {
      this.setData({ offlineError: ui.message(error) });
    }
  },
  toggleOffline() {
    if (
      this.data.busy ||
      this.data.pending ||
      !this._viewer ||
      !this._snapshot ||
      !this.data.canControl
    )
      return;
    this.setData({ offlineDraft: !this.data.offlineDraft, error: '', notice: '' });
    if (this.data.offlineDraft)
      this.setData({
        notice: '离线草稿模式：未同步记录不计入正式比分；时钟、换人、节次和确认须在线完成。',
      });
  },
  async saveOffline(type, payload, label) {
    if (this.data.offlineError || !this._viewer || !this._snapshot || !this.data.canControl) return;
    const actor = this._viewer,
      token = ui.hold(this),
      scope = this.offlineScope();
    this.setData({ busy: true, error: '' });
    try {
      await offline.append(wx, scope, type, payload, this._matchVersion);
      if (!ui.held(this, token) || actor !== this._viewer) return;
      this.refreshOffline();
      this.setData({ busy: false, notice: label + ' 已保存为本账号离线草稿，尚未同步。' });
    } catch (error) {
      if (ui.held(this, token)) this.setData({ busy: false, error: ui.message(error) });
    }
  },
  async syncOffline() {
    if (
      this.data.busy ||
      this.data.pending ||
      !this._control ||
      !this.data.offlineItems.length ||
      this.data.offlineError
    )
      return;
    const op = await ui.confirmOp(
      this,
      '同步离线草稿',
      '按原顺序同步' +
        this.data.offlineItems.length +
        '条草稿？版本冲突会停止，已接受记录可按原编号核对，不会自动改版重发。',
    );
    if (!op || !op.valid()) return;
    const token = ui.hold(this),
      actor = this._viewer,
      control = this._control,
      scope = this.offlineScope();
    const current = () =>
      ui.held(this, token) && this._viewer === actor && this._control === control;
    this.setData({ busy: true, error: '' });
    try {
      const result = await offline.sync(
        wx,
        scope,
        api.getClient(),
        this.base(),
        control,
        current,
        (accepted) => {
          if (current()) this.show(accepted.snapshot, Date.now());
        },
      );
      if (!current()) return;
      if (result.latest) this.show(result.latest.snapshot, Date.now());
      this.refreshOffline();
      this.setData({
        busy: false,
        offlineDraft: false,
        notice: this.data.offlineItems.length
          ? '本次确认的 ' +
            result.accepted +
            ' 条已同步；另有 ' +
            this.data.offlineItems.length +
            ' 条新草稿待下次明确同步。'
          : '草稿已按原顺序同步，请核对正式记录。',
      });
      this.refreshHistory();
    } catch (error) {
      if (!ui.held(this, token)) return;
      this.refreshOffline();
      this.setData({
        busy: false,
        error:
          (error && error.code === 'OFFLINE_QUEUE_CHANGED'
            ? '本地队列已变化，已停止同步；已接受记录可按原编号核对。'
            : '同步已停止，剩余原草稿已保留。') + scoring.failure(error),
      });
      if (error && ['LEASE_CONFLICT', 'SESSION_CHANGED'].includes(error.code)) {
        this.dropControl();
        this.setData({ held: false });
      }
    }
  },
  async exportOffline() {
    if (this.data.busy || !this._viewer || this.data.offlineError) return;
    const actor = this._viewer,
      scope = this.offlineScope();
    const op = await ui.confirmOp(
      this,
      '导出原草稿',
      '复制尚未同步的原操作编号、原版本和记录内容，用于逐条人工核对。',
    );
    if (!op || !op.valid() || actor !== this._viewer) return;
    try {
      const queue = offline.read(wx, scope);
      if (!queue) return;
      wx.setClipboardData({
        data: JSON.stringify(queue, null, 2),
        success: () => {
          if (op.valid() && actor === this._viewer)
            this.setData({ notice: '原草稿已复制，可逐条核对；原队列保持。' });
        },
        fail: (error) => {
          if (op.valid() && actor === this._viewer) this.setData({ error: ui.message(error) });
        },
      });
    } catch (error) {
      if (op.valid() && actor === this._viewer) this.setData({ error: ui.message(error) });
    }
  },
  async discardOffline() {
    if (this.data.busy || !this._viewer) return;
    const scope = this.offlineScope(),
      actor = this._viewer;
    const op = await ui.confirmOp(
      this,
      '删除离线草稿',
      '删除本账号本场尚未同步的草稿？已在服务端接受的原回执不会删除。建议先逐条核对。',
    );
    if (!op || !op.valid() || actor !== this._viewer) return;
    try {
      offline.discard(wx, scope);
      this.refreshOffline();
      this.setData({ offlineDraft: false, notice: '本地草稿已删除。' });
    } catch (error) {
      if (op.valid() && actor === this._viewer) this.setData({ error: ui.message(error) });
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
    if (
      this.data.board &&
      this.data.board.proMode &&
      kind === 'SCORE' &&
      !this.professionalPlayer(side)
    )
      return;
    const payload = { kind, side, value };
    const option = this.data.roster[key][this.data.pick[key]];
    if (this.data.board && this.data.board.playerMode && kind !== 'TIMEOUT' && option)
      payload.memberId = option.memberId || null;
    const team = this.data.match[key];
    this.command(
      this.data.board.proMode && kind === 'SCORE' ? 'RECORD_SHOT' : 'RECORD_STAT',
      this.data.board.proMode && kind === 'SCORE'
        ? { side, memberId: payload.memberId, shotValue: value, made: true }
        : payload,
      team + ' ' + scoring.kinds[kind] + (kind === 'SCORE' ? ' +' + value : ''),
    );
  },
  professionalPlayer(side) {
    const key = side === 'HOME' ? 'home' : 'away';
    const p = this.data.roster[key][this.data.pick[key]];
    if (!p || !p.memberId) {
      this.setData({ error: '专业统计请先选择当前在场球员。' });
      return null;
    }
    return p.memberId;
  },
  missShot(e) {
    const side = e.currentTarget.dataset.side,
      memberId = this.professionalPlayer(side);
    if (memberId)
      this.command(
        'RECORD_SHOT',
        { side, memberId, shotValue: Number(e.currentTarget.dataset.value), made: false },
        '记录未命中投篮',
      );
  },
  technical(e) {
    const side = e.currentTarget.dataset.side,
      memberId = this.professionalPlayer(side);
    if (memberId)
      this.command(
        'RECORD_TECHNICAL',
        { side, memberId, kind: e.currentTarget.dataset.kind },
        '记录' + scoring.kinds[e.currentTarget.dataset.kind],
      );
  },
  pickLineup(e) {
    const key = e.currentTarget.dataset.side;
    if (['home', 'away'].includes(key)) this.setData({ ['lineupDraft.' + key]: e.detail.value });
  },
  setLineup(e) {
    const key = e.currentTarget.dataset.side;
    if (['home', 'away'].includes(key))
      this.command(
        'SET_LINEUP',
        { side: key === 'home' ? 'HOME' : 'AWAY', memberIds: this.data.lineupDraft[key] },
        '设置首发',
      );
  },
  subPick(e) {
    const key = e.currentTarget.dataset.side,
      role = e.currentTarget.dataset.role;
    if (['home', 'away'].includes(key) && ['out', 'in'].includes(role))
      this.setData({
        [(role === 'out' ? 'subOut.' : 'subIn.') + key]: Number(e.detail.value) || 0,
      });
  },
  substitute(e) {
    const key = e.currentTarget.dataset.side,
      group = this.data.proGroups.find((g) => g.key === key);
    if (!group) return;
    const out = group.players[this.data.subOut[key]],
      into = group.players[this.data.subIn[key]];
    if (out && into)
      this.command(
        'SUBSTITUTE_PLAYER',
        {
          side: key === 'home' ? 'HOME' : 'AWAY',
          outMemberId: out.memberId,
          inMemberId: into.memberId,
        },
        '换人',
      );
  },
  correctLineup(e) {
    const row = this.data.history.find(
      (r) => r.id === e.currentTarget.dataset.id && r.canCorrectLineup,
    );
    if (!row || !this.data.board || this.data.board.running) return;
    const group = this.data.proGroups.find((g) => g.side === row.side);
    if (group)
      this.setData({
        lineupCorrection: {
          targetEventId: row.id,
          side: row.side,
          memberIds: row.memberIds,
          reason: '',
          players: group.players.map((p) => ({
            ...p,
            checked: row.memberIds.includes(p.memberId),
          })),
        },
      });
  },
  correctionLineupPick(e) {
    if (this.data.lineupCorrection) this.setData({ 'lineupCorrection.memberIds': e.detail.value });
  },
  correctionLineupReason(e) {
    if (this.data.lineupCorrection)
      this.setData({ 'lineupCorrection.reason': String(e.detail.value || '').slice(0, 500) });
  },
  submitLineupCorrection() {
    const draft = this.data.lineupCorrection;
    if (!draft) return;
    const reason = draft.reason.trim();
    if (!reason) {
      this.setData({ error: '请填写阵容更正原因。' });
      return;
    }
    this.setData({ lineupCorrection: null });
    this.command(
      'CORRECT_LINEUP',
      { targetEventId: draft.targetEventId, memberIds: draft.memberIds, reason },
      '更正历史阵容',
    );
  },
  cancelLineupCorrection() {
    this.setData({ lineupCorrection: null });
  },
  start() {
    this.command('START_MATCH', { expectedEventVersion: this._eventVersion }, '开始比赛');
  },
  clock() {
    const running = this.data.board && this.data.board.running;
    this.command(running ? 'CLOCK_PAUSE' : 'CLOCK_START', {}, running ? '暂停计时' : '启动计时');
  },
  // Confirmed commands: the dialog is bound to this page, session and control; a late answer
  // (account change, sign-out, unload, lost control, a newer dialog) sends nothing.
  // The version, status and control the scorer saw are fixed when the dialog opens; if any of
  // them changed by the time the answer arrives, nothing is sent and the scorer re-checks.
  async confirmedCommand(type, label, title, content) {
    const control = this._control;
    const version = this._matchVersion;
    const status = this.data.match && this.data.match.status;
    const op = await ui.confirmOp(this, title, content);
    if (!op || !control) return;
    if (
      this._control !== control ||
      this._matchVersion !== version ||
      (this.data.match && this.data.match.status) !== status
    ) {
      this.setData({ error: '比分或比赛状态已更新，请重新核对后再确认“' + label + '”。' });
      return;
    }
    return this.command(type, {}, label, op, version);
  },
  nextPeriod() {
    return this.confirmedCommand(
      'NEXT_PERIOD',
      '进入下一节',
      '进入下一节',
      '本节时钟须已归零并暂停。',
    );
  },
  overtime() {
    return this.confirmedCommand(
      'START_OVERTIME',
      '进入加时',
      '进入加时',
      '仅常规时间结束后平分且规则允许时可加时。',
    );
  },
  end() {
    const b = this.data.board;
    if (!b) return;
    return this.confirmedCommand(
      'END_MATCH',
      '结束比赛',
      '结束比赛',
      b.home.name +
        ' ' +
        b.home.score +
        ' : ' +
        b.away.score +
        ' ' +
        b.away.name +
        '。结束后进入待确认，须由他人独立确认才成为正式赛果。',
    );
  },
  askVoid(e) {
    const id = e.currentTarget.dataset.id;
    const row = this.data.history.find((h) => h.id === id && h.canVoid);
    if (row)
      this.setData({ voidTarget: { id, text: row.text, voidType: row.voidType }, voidReason: '' });
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
      target.voidType || 'VOID_STAT',
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
    if (field === 'made') this.setData({ 'fix.made': raw !== 'false' && raw !== false });
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
    let type = 'ADD_CORRECTION';
    if (this.data.board && this.data.board.proMode && !['FOUL', 'TIMEOUT'].includes(fix.kind)) {
      const memberId = this.professionalPlayer(fix.side);
      if (!memberId) return;
      type = 'ADD_PRO_CORRECTION';
      Object.assign(payload, { memberId, kind: fix.kind === 'SCORE' ? 'SHOT' : fix.kind });
      delete payload.value;
      if (fix.kind === 'SCORE')
        Object.assign(payload, { shotValue: fix.value, made: fix.made !== false });
    } else if (this.data.board && this.data.board.playerMode && fix.kind !== 'TIMEOUT')
      payload.memberId = null;
    this.setData({ fixOpen: false });
    this.command(type, payload, '补录' + scoring.sides[fix.side] + scoring.kinds[fix.kind]);
  },
});
