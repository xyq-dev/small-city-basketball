const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const plan = require('../../utils/schedule');

// Round-robin scheduling over the existing revision API: generate from the frozen roster,
// propose allocations, validate on the server and publish once. Other formats stay in Web.
const MAX_PAGES = 10;
const privateDefaults = {
  event: null,
  state: '',
  supportReason: '',
  publication: null,
  courts: [],
  form: null,
  revision: null,
  fixtures: [],
  conflicts: [],
  validated: false,
  unavailable: false,
  newCourt: '',
  canCreateCourt: false,
  redrawOpen: false,
  redrawReason: '',
};
function failure(error) {
  if (error && error.code === 'VERSION_CONFLICT') return '赛程已被其他操作更新，已重新读取。';
  if (error && error.code === 'SCHEDULE_CONFLICT') return '发布前复检发现冲突，请先处理后再发布。';
  if (error && error.code === 'SCHEDULE_REVISION_NOT_CURRENT')
    return '该草稿已被重新抽签替代，已重新读取。';
  return ui.message(error);
}

Page({
  data: { loading: false, busy: false, error: '', notice: '', ...privateDefaults },
  onLoad(query = {}) {
    this._alive = true;
    try {
      this.orgId = api.uuid(query.orgId);
      this.eventId = api.uuid(query.eventId);
    } catch {
      this.setData({ unavailable: true, error: '排赛入口无效，请从赛事设置重新进入。' });
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
    this.setData({
      ...privateDefaults,
      loading: false,
      busy: false,
      error: '登录身份已变化，已清除排赛资料。',
    });
  },
  org() {
    return '/v1/orgs/' + this.orgId;
  },
  async load() {
    if (!this.orgId || this.data.loading) return;
    const client = api.getClient();
    const load = (this._load = (this._load || 0) + 1);
    const current = () => this._alive && load === this._load;
    if (!client.hasSession()) {
      this.setData({ ...privateDefaults, unavailable: true, error: '请先登录后排赛。' });
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
      const data = (await client.request(this.org() + '/events/' + this.eventId + '/scheduling'))
        .data;
      let courts = [],
        cursor = null,
        canCreateCourt = false;
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await client.request(
          this.org() +
            '/courts?limit=100' +
            (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
        );
        courts = courts.concat(response.data);
        if (page === 0)
          canCreateCourt = !!(
            response.meta.capabilities && response.meta.capabilities.canCreateCourt
          );
        cursor = response.meta.nextCursor;
        if (!cursor) break;
      }
      const revision = data.currentRevision
        ? (await client.request(this.org() + '/schedule-revisions/' + data.currentRevision.id)).data
        : null;
      if (!live()) return;
      this._scheduling = data;
      this._revision = revision;
      const e = data.event;
      const roundRobin = e.format === 'ROUND_ROBIN';
      const state = !data.support.supported
        ? 'unsupported'
        : data.publication
          ? 'published'
          : !data.freeze
            ? 'no-freeze'
            : !roundRobin
              ? 'web-only'
              : revision && revision.status === 'DRAFT'
                ? 'draft'
                : data.capabilities.canGenerate
                  ? 'generate'
                  : 'readonly';
      const names = {};
      for (const p of (revision && revision.participants) || []) names[p.entryId] = p.teamName;
      const courtNames = {};
      for (const c of courts) courtNames[c.id] = c.name;
      this.setData({
        loading: false,
        unavailable: false,
        event: {
          name: e.name,
          statusLabel: api.eventStatus(e.status),
          dates: e.startDate + ' 至 ' + e.endDate,
          teams: data.freeze ? data.freeze.entryCount : 0,
        },
        state,
        supportReason: data.support.reason || '',
        publication: data.publication
          ? { count: data.publication.matchCount, time: ui.localTime(data.publication.publishedAt) }
          : null,
        courts: courts
          .filter((c) => c.status === 'ACTIVE')
          .map((c) => ({
            id: c.id,
            name: c.name,
            on: (this.data.courts.find((o) => o.id === c.id) || {}).on !== false,
          })),
        canCreateCourt,
        form: this.data.form || {
          dayStart: '09:00',
          dayEnd: '21:00',
          slot: '60',
          rest: '0',
          gap: '0',
        },
        revision: revision
          ? {
              id: revision.id,
              status: revision.status,
              rounds: revision.rounds.length,
              count: revision.fixtures.length,
              canEdit: revision.capabilities.canEditAllocations,
              canValidate: revision.capabilities.canValidate,
              canPublish: revision.capabilities.canPublish,
              canRedraw: data.capabilities.canRedraw,
            }
          : null,
        fixtures: revision
          ? revision.fixtures
              .slice()
              .sort((a, b) => a.roundNo - b.roundNo || a.positionNo - b.positionNo)
              .map((f) => ({
                key: f.fixtureKey,
                round: '第' + f.roundNo + '轮',
                home: names[f.homeEntryId] || '待定',
                away: names[f.awayEntryId] || '待定',
                time: f.startsAt ? ui.localTime(f.startsAt) : '未安排',
                court: f.courtId ? courtNames[f.courtId] || '场地' : '',
                assigned: !!f.startsAt,
              }))
          : [],
      });
    } catch (error) {
      if (!live()) return;
      const hidden = error.status === 401 || error.status === 403 || error.status === 404;
      this.setData({
        ...(hidden ? privateDefaults : {}),
        loading: false,
        unavailable: hidden,
        error: hidden ? '当前身份不能为该赛事排赛。' : failure(error),
      });
    }
  },
  formInput(e) {
    const field = e.currentTarget.dataset.field;
    if (['dayStart', 'dayEnd', 'slot', 'rest', 'gap'].includes(field))
      this.setData({ ['form.' + field]: String(e.detail.value).slice(0, 5) });
  },
  toggleCourt(e) {
    const i = Number(e.currentTarget.dataset.index);
    if (this.data.courts[i]) this.setData({ ['courts[' + i + '].on']: !this.data.courts[i].on });
  },
  courtInput(e) {
    this.setData({ newCourt: String(e.detail.value || '').slice(0, 80) });
  },
  async run(path, method, body, label) {
    if (this.data.busy) return null;
    const token = ui.begin(this);
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const result = (await api.getClient().request(path, method, body)).data;
      if (!ui.live(this, token)) return null;
      this.setData({ busy: false, notice: label ? label + '已完成。' : '' });
      return result || {};
    } catch (error) {
      if (!ui.live(this, token)) return null;
      const details =
        error && error.details && Array.isArray(error.details.conflicts)
          ? error.details.conflicts
          : null;
      this.setData({
        busy: false,
        error: failure(error),
        ...(details ? { conflicts: this.conflictRows(details), validated: true } : {}),
      });
      if (error && ['VERSION_CONFLICT', 'SCHEDULE_REVISION_NOT_CURRENT'].includes(error.code))
        await this.load();
      return null;
    }
  },
  async addCourt() {
    const name = this.data.newCourt.trim();
    if (!name) return;
    if (await this.run(this.org() + '/courts', 'POST', { name }, '场地“' + name + '”添加')) {
      this.setData({ newCourt: '' });
      await this.load();
    }
  },
  policy() {
    const f = this.data.form;
    const n = (value, label, min, max) => {
      const v = Number(value);
      if (!/^\d+$/.test(String(value)) || v < min || v > max)
        throw new Error(label + '请填写' + min + '至' + max);
      return v;
    };
    const courts = this.data.courts.filter((c) => c.on);
    if (!courts.length) throw new Error('请至少选择一个场地');
    const days = plan.eachDay(this._scheduling.event.startDate, this._scheduling.event.endDate);
    const windows = [];
    for (const day of days)
      for (const c of courts) {
        const startsAt = ui.chinaStamp(day, f.dayStart),
          endsAt = ui.chinaStamp(day, f.dayEnd);
        if (Date.parse(endsAt) <= Date.parse(startsAt))
          throw new Error('每日结束时间须晚于开始时间');
        windows.push({ courtId: c.id, startsAt, endsAt });
      }
    if (windows.length > 200) throw new Error('场地时段过多，请减少场地或缩短赛期');
    return {
      slotDurationMinutes: n(f.slot, '每场时长（分钟）', 1, 1440),
      minRestMinutes: n(f.rest, '最短休息（分钟）', 0, 43200),
      minLocalDayGap: n(f.gap, '比赛日间隔', 0, 365),
      courtWindows: windows,
    };
  },
  async generate() {
    let policy;
    try {
      policy = this.policy();
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const s = this._scheduling;
    if (
      !(await ui.confirm(
        '生成单循环对阵',
        s.freeze.entryCount + ' 支冻结球队，服务端随机生成对阵；之后可自动排入时间并校验。',
      ))
    )
      return;
    if (
      await this.run(
        this.org() + '/events/' + this.eventId + '/schedule-revisions',
        'POST',
        {
          expectedEventVersion: s.event.version,
          freezeId: s.freeze.id,
          algorithmVersion: 'RR_CIRCLE_V1',
          policy,
        },
        '对阵生成',
      )
    )
      await this.load();
  },
  async autoAssign() {
    const r = this._revision;
    if (!r || !r.capabilities.canEditAllocations) return;
    const proposal = plan.propose(r);
    const result = await this.run(
      this.org() + '/schedule-revisions/' + r.id + '/allocations',
      'PUT',
      {
        expectedEventVersion: r.eventVersion,
        expectedRevisionVersion: r.version,
        allocations: proposal.allocations,
      },
      '',
    );
    if (!result) return;
    this.setData({
      notice: proposal.unassigned
        ? '已排入可安排的比赛，' +
          proposal.unassigned +
          ' 场因时段不足未安排，请增加场地或时段后重新生成。'
        : '全部比赛已排入，请校验后发布。',
      conflicts: [],
      validated: false,
    });
    await this.load();
  },
  conflictRows(conflicts) {
    const names = {};
    for (const f of this.data.fixtures) names[f.key] = f.home + ' vs ' + f.away;
    return conflicts.slice(0, 50).map((c, i) => ({
      key: String(i),
      label: plan.conflictLabels[c.code] || c.code,
      fixtures: c.fixtureKeys.map((k) => names[k] || '一场比赛').join('；'),
      external: !!c.external,
    }));
  },
  async validate() {
    const r = this._revision;
    if (!r) return;
    const result = await this.run(
      this.org() + '/schedule-revisions/' + r.id + '/validate',
      'POST',
      { expectedEventVersion: r.eventVersion, expectedRevisionVersion: r.version },
      '',
    );
    if (result)
      this.setData({
        validated: true,
        conflicts: this.conflictRows(result.conflicts || []),
        notice: result.valid ? '校验通过，可以发布。' : '校验发现冲突，请调整后再发布。',
      });
  },
  async publish() {
    const r = this._revision;
    if (!r || !r.capabilities.canPublish) return;
    if (
      !(await ui.confirm(
        '发布正式赛程',
        '发布后对阵与时间成为正式赛程，不能再重抽；个别场次只能按改期流程调整。',
      ))
    )
      return;
    if (
      await this.run(
        this.org() + '/schedule-revisions/' + r.id + '/publish',
        'POST',
        { expectedEventVersion: r.eventVersion, expectedRevisionVersion: r.version },
        '赛程发布',
      )
    )
      await this.load();
  },
  toggleRedraw() {
    this.setData({ redrawOpen: !this.data.redrawOpen, redrawReason: '' });
  },
  redrawInput(e) {
    this.setData({ redrawReason: String(e.detail.value || '').slice(0, 500) });
  },
  async redraw() {
    const r = this._revision,
      s = this._scheduling;
    const reason = this.data.redrawReason.trim();
    if (!r || !reason) {
      this.setData({ error: '请填写重新抽签原因。' });
      return;
    }
    if (!(await ui.confirm('重新抽签', '旧草稿保留为历史，生成新的随机对阵。'))) return;
    if (
      await this.run(
        this.org() + '/events/' + this.eventId + '/schedule-revisions',
        'POST',
        {
          expectedEventVersion: s.event.version,
          freezeId: s.freeze.id,
          algorithmVersion: 'RR_CIRCLE_V1',
          policy: r.policy,
          redrawReason: reason,
        },
        '重新抽签',
      )
    ) {
      this.setData({ redrawOpen: false, redrawReason: '', conflicts: [], validated: false });
      await this.load();
    }
  },
  openEvent() {
    ui.open('org-event', { orgId: this.orgId, eventId: this.eventId });
  },
  openReview() {
    ui.open('entry-review', { orgId: this.orgId, eventId: this.eventId });
  },
});
