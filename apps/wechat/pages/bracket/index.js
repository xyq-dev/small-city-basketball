const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const bracket = require('../../utils/bracket');
const plan = require('../../utils/schedule');

// Native group draw records, qualification and round-by-round knockout publication over the
// existing C04/C05 commands. Advancement, eligibility, locking and versions come from the
// server; every command pins the event version and the source hash that was read.
const MAX_PAGES = 10;
const privateDefaults = {
  event: null,
  kind: '',
  progress: '',
  qualification: '',
  groups: [],
  rounds: [],
  placements: [],
  next: null,
  fixtures: [],
  courts: [],
  reason: '',
  tieReasons: {},
  blocker: '',
  canDraw: false,
  conflicts: [],
  uncertain: false,
  unavailable: false,
};

Page({
  data: { loading: false, busy: false, error: '', notice: '', ...privateDefaults },
  onLoad(query = {}) {
    this._alive = true;
    try {
      this.orgId = api.uuid(query.orgId);
      this.eventId = api.uuid(query.eventId);
    } catch {
      this.setData({ unavailable: true, error: '晋级入口无效，请从赛事详情重新进入。' });
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
    this._sourceHash = '';
    this.setData({
      ...privateDefaults,
      loading: false,
      busy: false,
      error: '登录身份已变化，已清除上一身份的晋级资料。',
    });
  },
  base() {
    return '/v1/orgs/' + this.orgId + '/events/' + this.eventId;
  },
  async load() {
    if (!this.orgId || this.data.loading || this.data.busy) return;
    const client = api.getClient();
    const load = (this._load = (this._load || 0) + 1);
    const current = () => this._alive && load === this._load;
    if (!client.hasSession()) {
      this.setData({ ...privateDefaults, unavailable: true, error: '请先登录后管理晋级。' });
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
      const event = (await client.request(this.base())).data;
      const kind = event.format;
      if (kind !== 'SINGLE_ELIMINATION' && kind !== 'GROUP_KNOCKOUT') {
        if (!live()) return;
        this.setData({
          ...privateDefaults,
          loading: false,
          unavailable: true,
          error: '该赛事为单循环，没有分组或淘汰晋级。',
        });
        return;
      }
      const data = (
        await client.request(this.base() + (kind === 'GROUP_KNOCKOUT' ? '/groups' : '/knockout'))
      ).data;
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
      this.show(kind, data, courts);
    } catch (error) {
      if (!live()) return;
      const hidden = error.status === 401 || error.status === 403 || error.status === 404;
      this.setData({
        ...(hidden ? privateDefaults : {}),
        loading: false,
        unavailable: hidden,
        error: hidden ? '该赛事不存在或当前身份无权查看晋级。' : bracket.failure(error),
      });
    }
  },
  show(kind, data, courts) {
    this._data = data;
    const group = kind === 'GROUP_KNOCKOUT';
    const c = group ? data.competition : null;
    const names = {};
    for (const p of group ? (c ? c.groups.flatMap((g) => g.participants) : []) : data.participants)
      names[p.entryId] = p.teamName;
    const b = group ? c && c.bracket : data.bracket;
    const qualifying = !!(group && c && c.qualification.status === 'READY');
    const next = group ? c && c.nextRound : b && b.nextRound;
    const canPublish = qualifying
      ? data.capabilities.canPublishQualification
      : data.capabilities.canPublishNextRound;
    // The hash this page would publish against; a change means the source results moved.
    const hash = next ? (qualifying ? c.qualification.sourceHash : next.sourceHash) : '';
    const edited = this.data.reason.trim() || this.data.fixtures.some((f) => f.date || f.time);
    const moved = !!(this._sourceHash && hash && hash !== this._sourceHash && edited);
    this._sourceHash = hash;
    const active = courts.filter((x) => x.status === 'ACTIVE');
    const previous = {};
    for (const f of this.data.fixtures) previous[f.key] = f;
    const progressOf = (x) =>
      x
        ? x.confirmedMatchCount +
          ' / ' +
          x.totalMatchCount +
          ' 场有效独立确认 · 已发布 ' +
          x.publishedMatchCount +
          ' 场'
        : '';
    this.setData({
      loading: false,
      unavailable: false,
      uncertain: false,
      kind,
      event: {
        name: data.event.name,
        statusLabel: api.eventStatus(data.event.status),
        formatLabel: api.eventFormat(kind),
      },
      progress: progressOf(group ? c : b),
      qualification: c ? bracket.qualificationLabels[c.qualification.status] : '',
      groups: c ? bracket.groups(c, names) : [],
      rounds: bracket.rounds(b, names),
      placements: (group ? c && c.isComplete : b && b.isComplete)
        ? bracket.placements(group ? c.placements : b.placements, names)
        : [],
      next:
        next && canPublish
          ? {
              title: qualifying ? '固定交叉淘汰首轮' : '第' + next.roundNo + '轮',
              note: qualifying
                ? '每组前二按固定交叉进入淘汰赛，同组球队只可能在决赛重逢。'
                : '上一轮来源均已有效独立确认。',
              qualifying,
            }
          : null,
      fixtures:
        next && canPublish
          ? next.fixtures.map((f) => {
              const old = previous[f.fixtureKey] || {};
              const index = active.findIndex((x) => x.id === old.courtId);
              return {
                key: f.fixtureKey,
                label:
                  (names[f.homeEntryId] || '冻结参赛队') +
                  ' VS ' +
                  (names[f.awayEntryId] || '冻结参赛队'),
                courtIndex: index >= 0 ? index : 0,
                courtId: index >= 0 ? old.courtId : active[0] ? active[0].id : '',
                date: old.date || '',
                time: old.time || '',
              };
            })
          : [],
      courts: active.map((x) => ({ id: x.id, name: x.name })),
      blocker: bracket.blocker(kind, data),
      canDraw: !!(group && data.capabilities.canDrawTies),
      tieReasons: this.data.tieReasons,
      ...(moved
        ? {
            notice: '',
            error: '来源赛果已变化，晋级对阵已按最新确认重新计算；本地安排已保留，请重新核对。',
          }
        : {}),
    });
  },
  reasonInput(e) {
    this.setData({ reason: String(e.detail.value || '').slice(0, 500) });
  },
  tieInput(e) {
    const key = e.currentTarget.dataset.key;
    if (/^[A-Z]$/.test(key || ''))
      this.setData({ ['tieReasons.' + key]: String(e.detail.value || '').slice(0, 500) });
  },
  pickCourt(e) {
    const i = Number(e.currentTarget.dataset.index),
      v = Number(e.detail.value);
    const court = this.data.courts[v];
    if (this.data.fixtures[i] && court)
      this.setData({
        ['fixtures[' + i + '].courtIndex']: v,
        ['fixtures[' + i + '].courtId']: court.id,
      });
  },
  pickDate(e) {
    const i = Number(e.currentTarget.dataset.index);
    if (this.data.fixtures[i])
      this.setData({ ['fixtures[' + i + '].date']: String(e.detail.value).slice(0, 10) });
  },
  pickTime(e) {
    const i = Number(e.currentTarget.dataset.index);
    if (this.data.fixtures[i])
      this.setData({ ['fixtures[' + i + '].time']: String(e.detail.value).slice(0, 5) });
  },
  checkedReason(value) {
    const v = String(value || '').trim();
    if (Array.from(v).length < 4 || Array.from(v).length > 500)
      throw new Error('请填写4–500字的操作原因');
    return v;
  },
  // `op`: the confirmation this command follows; re-checked right before sending.
  async send(path, body, label, op) {
    if (this.data.busy || !op || !op.valid()) return false;
    const token = ui.hold(this);
    if (!op.valid() || !ui.held(this, token)) return false;
    this.setData({ busy: true, loading: false, error: '', notice: '', conflicts: [] });
    try {
      await api.getClient().request(path, 'POST', body);
      if (!ui.held(this, token)) return false;
      this.setData({ busy: false, notice: label });
      return true;
    } catch (error) {
      if (!ui.held(this, token)) return false;
      const details =
        error && error.details && Array.isArray(error.details.conflicts)
          ? error.details.conflicts
          : [];
      this.setData({
        busy: false,
        error: bracket.failure(error),
        uncertain: bracket.unknown(error),
        conflicts: details.slice(0, 20).map((c, i) => ({
          key: String(i),
          label: plan.conflictLabels[c.code] || c.code,
          external: !!c.external,
        })),
      });
      // A known rejection re-reads at once (sources may have moved); an unknown outcome
      // waits for the organizer to re-read before anything else can be sent.
      if (!bracket.unknown(error) && error && error.status === 409) {
        const message = this.data.error;
        await this.load();
        if (ui.held(this, token) && !this.data.unavailable) this.setData({ error: message });
      }
      return false;
    }
  },
  async publish() {
    const data = this._data;
    if (!data || !this.data.next || this.data.busy || this.data.uncertain) return;
    let body;
    try {
      const reason = this.checkedReason(this.data.reason);
      const allocations = this.data.fixtures.map((f) => {
        if (!f.courtId || !f.date || !f.time)
          throw new Error(f.label + ' 需同时选择场地、日期和开始时间');
        return { fixtureKey: f.key, courtId: f.courtId, startsAt: ui.chinaStamp(f.date, f.time) };
      });
      const group = this.data.kind === 'GROUP_KNOCKOUT';
      const next = group ? data.competition.nextRound : data.bracket.nextRound;
      body = this.data.next.qualifying
        ? {
            type: 'PUBLISH_QUALIFICATION',
            expectedEventVersion: data.event.version,
            expectedSourceHash: data.competition.qualification.sourceHash,
            reason,
            allocations,
          }
        : {
            type: 'PUBLISH_ROUND',
            expectedEventVersion: data.event.version,
            expectedSourceHash: next.sourceHash,
            roundNo: next.roundNo,
            reason,
            allocations,
          };
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const op = await ui.confirmOp(
      this,
      '正式发布' + this.data.next.title,
      '将发布 ' +
        body.allocations.length +
        ' 场比赛并锁定来源赛果；现有实时观赛链接随之撤销，需重新开启公开观赛。',
    );
    // The same event version and source hash as confirmed.
    if (
      !op ||
      !this._data ||
      this._data.event.version !== body.expectedEventVersion ||
      this._sourceHash !== body.expectedSourceHash
    )
      return;
    const path =
      this.base() +
      (body.type === 'PUBLISH_QUALIFICATION'
        ? '/group-qualification-commands'
        : '/knockout-round-commands');
    if (
      await this.send(path, body, this.data.next.title + '已正式发布；请重新开启公开观赛。', op)
    ) {
      this.setData({ reason: '', fixtures: [] });
      await this.load();
    }
  },
  async drawTie(e) {
    const data = this._data;
    const key = e.currentTarget.dataset.key;
    const c = data && data.competition;
    const g = c && c.groups.find((x) => x.groupKey === key);
    if (!g || !g.unresolvedTieEntryIds.length || g.draw || this.data.busy || this.data.uncertain)
      return;
    let reason;
    try {
      reason = this.checkedReason(this.data.tieReasons[key]);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const op = await ui.confirmOp(
      this,
      '保存' + g.label + '同分抽签',
      '抽签只保存一次并可审计；之后发布失败也不会重新抽取。',
    );
    const nowGroup =
      this._data &&
      this._data.competition &&
      this._data.competition.groups.find((x) => x.groupKey === key);
    // Same event version and group source; the tie must still be unresolved.
    if (
      !op ||
      !nowGroup ||
      this._data.event.version !== data.event.version ||
      nowGroup.standings.sourceHash !== g.standings.sourceHash ||
      nowGroup.draw ||
      !nowGroup.unresolvedTieEntryIds.length
    )
      return;
    if (
      await this.send(
        this.base() + '/group-tie-commands',
        {
          type: 'DRAW_GROUP_TIE',
          expectedEventVersion: data.event.version,
          expectedSourceHash: g.standings.sourceHash,
          groupKey: key,
          reason,
        },
        g.label + '同分抽签已保存。',
        op,
      )
    ) {
      this.setData({ ['tieReasons.' + key]: '' });
      await this.load();
    }
  },
  openMatch(e) {
    const id = e.currentTarget.dataset.id;
    if (id) ui.open('org-match', { orgId: this.orgId, matchId: id });
  },
  openSchedule() {
    ui.open('schedule', { orgId: this.orgId, eventId: this.eventId });
  },
  openSetup() {
    ui.open('event-setup', { orgId: this.orgId, eventId: this.eventId });
  },
});
