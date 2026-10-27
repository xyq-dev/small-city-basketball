const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const plan = require('../../utils/schedule');

// Scheduling over the existing revision API for all three formats: generate from the frozen
// roster (round robin, seeded knockout bracket, or balanced groups), propose allocations,
// validate on the server and publish once. Later knockout rounds are published from the
// bracket page; formal changes to a published match go through rescheduling.
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
  courtAdmin: [],
  renameId: '',
  renameValue: '',
  redrawOpen: false,
  redrawReason: '',
  format: '',
  groupCounts: [],
  groupIndex: 0,
  seeds: [],
  draftGroups: [],
  byes: '',
};
const ALGORITHMS = {
  ROUND_ROBIN: 'RR_CIRCLE_V1',
  SINGLE_ELIMINATION: 'SE_SEEDED_V1',
  GROUP_KNOCKOUT: 'GK_BALANCED_V1',
};
const GENERATE_TITLES = {
  ROUND_ROBIN: '生成单循环对阵',
  SINGLE_ELIMINATION: '生成淘汰赛签位与首轮',
  GROUP_KNOCKOUT: '生成分组与组内循环',
};
function failure(error) {
  if (error && error.code === 'VERSION_CONFLICT') return '赛程已被其他操作更新，已重新读取。';
  if (error && error.code === 'SCHEDULE_CONFLICT') return '发布前复检发现冲突，请先处理后再发布。';
  if (error && error.code === 'STANDINGS_RULES_REQUIRED')
    return '分组赛发布前须先保存并锁定组内积分规则（规则与公开观赛中设置）。';
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
    if (!this.orgId || this.data.loading || this.data.busy) return;
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
      const group = data.event.format === 'GROUP_KNOCKOUT';
      // Group seeding chooses among frozen entries; the server replays the draw for review.
      const frozen =
        group && data.freeze && !data.publication
          ? (await client.request(this.org() + '/events/' + this.eventId + '/registration')).data
              .freeze
          : null;
      const groupDraw =
        group && revision && !data.publication
          ? (await client.request(this.org() + '/events/' + this.eventId + '/groups')).data
          : null;
      if (!live()) return;
      this._scheduling = data;
      this._revision = revision;
      const e = data.event;
      const state = !data.support.supported
        ? 'unsupported'
        : data.publication
          ? 'published'
          : !data.freeze
            ? 'no-freeze'
            : revision && revision.status === 'DRAFT'
              ? 'draft'
              : data.capabilities.canGenerate
                ? 'generate'
                : 'readonly';
      const names = {};
      for (const p of (revision && revision.participants) || []) names[p.entryId] = p.teamName;
      const entries = frozen ? frozen.entries : [];
      const counts = [2, 4, 8].filter((n) => entries.length >= n * 2);
      const keepSeeds = new Set(this.data.seeds.filter((x) => x.on).map((x) => x.id));
      const byeIds = revision
        ? revision.rounds.flatMap((r) => r.byeEntryIds || (r.byeEntryId ? [r.byeEntryId] : []))
        : [];
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
        format: e.format,
        groupCounts: counts.map((n) => ({ value: n, label: n + ' 组' })),
        groupIndex: Math.min(this.data.groupIndex, Math.max(counts.length - 1, 0)),
        seeds: entries.map((x) => ({
          id: x.entryId,
          name: x.teamName,
          on: keepSeeds.has(x.entryId),
        })),
        draftGroups:
          groupDraw && groupDraw.draftGroups
            ? groupDraw.draftGroups.map((g) => ({
                key: g.groupKey,
                label: g.label,
                teams: g.participants.map((p) => p.teamName).join('、'),
              }))
            : [],
        byes:
          e.format === 'SINGLE_ELIMINATION' && byeIds.length
            ? byeIds.map((id) => names[id] || '冻结参赛队').join('、')
            : '',
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
        // Court maintenance (rename, disable, re-enable): every court the server lets this
        // identity manage, including disabled ones. Conflicts on published matches stay
        // server-side (COURT_DISABLED in validation and rescheduling).
        courtAdmin: courts
          .filter((c) => c.capabilities && c.capabilities.canManage)
          .map((c) => ({
            id: c.id,
            name: c.name,
            version: c.version,
            active: c.status === 'ACTIVE',
          })),
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
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      const result = (await api.getClient().request(path, method, body)).data;
      if (!ui.held(this, token)) return null;
      this.setData({ busy: false, notice: label ? label + '已完成。' : '' });
      return result || {};
    } catch (error) {
      if (!ui.held(this, token)) return null;
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
  askRename(e) {
    const court = this.data.courtAdmin.find((c) => c.id === e.currentTarget.dataset.id);
    if (court)
      this.setData({
        renameId: this.data.renameId === court.id ? '' : court.id,
        renameValue: court.name,
      });
  },
  renameInput(e) {
    this.setData({ renameValue: String(e.detail.value || '').slice(0, 80) });
  },
  async updateCourt(court, name, active, label) {
    if (
      await this.run(
        this.org() + '/courts/' + court.id,
        'PATCH',
        { expectedVersion: court.version, name, status: active ? 'ACTIVE' : 'DISABLED' },
        label,
      )
    ) {
      this.setData({ renameId: '', renameValue: '' });
      await this.load();
    }
  },
  async saveRename() {
    const court = this.data.courtAdmin.find((c) => c.id === this.data.renameId);
    const name = this.data.renameValue.trim();
    if (!court || !name || name === court.name) return;
    await this.updateCourt(court, name, court.active, '场地改名');
  },
  async toggleCourtStatus(e) {
    const court = this.data.courtAdmin.find((c) => c.id === e.currentTarget.dataset.id);
    if (!court) return;
    if (
      !(await ui.confirm(
        court.active ? '停用场地“' + court.name + '”' : '重新启用“' + court.name + '”',
        court.active
          ? '停用后不能再安排新比赛；已安排在该场地的比赛会在校验、发布或改期时报“场地已停用”，需改到其他场地。'
          : '启用后可重新用于排赛与改期。',
      ))
    )
      return;
    await this.updateCourt(
      court,
      court.name,
      !court.active,
      court.active ? '场地停用' : '场地启用',
    );
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
  pickGroups(e) {
    this.setData({ groupIndex: Number(e.detail.value) || 0 });
  },
  toggleSeed(e) {
    const i = Number(e.currentTarget.dataset.index);
    const seed = this.data.seeds[i];
    if (!seed) return;
    const limit = (this.data.groupCounts[this.data.groupIndex] || {}).value || 0;
    if (!seed.on && this.data.seeds.filter((x) => x.on).length >= limit) {
      this.setData({ error: '种子队最多 ' + limit + ' 支（每组至多一支）。' });
      return;
    }
    this.setData({ ['seeds[' + i + '].on']: !seed.on, error: '' });
  },
  groupConfig() {
    const option = this.data.groupCounts[this.data.groupIndex];
    if (!option) throw new Error('冻结球队不足，分组赛每组至少2队');
    const seeded = this.data.seeds.filter((x) => x.on).map((x) => x.id);
    if (seeded.length > option.value) throw new Error('种子队数量不能超过分组数');
    return { groupCount: option.value, seededEntryIds: seeded };
  },
  async generate() {
    let policy, groupConfig;
    const s = this._scheduling;
    try {
      policy = this.policy();
      if (s.event.format === 'GROUP_KNOCKOUT') groupConfig = this.groupConfig();
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const note =
      s.event.format === 'GROUP_KNOCKOUT'
        ? '分成 ' +
          groupConfig.groupCount +
          ' 组，服务端随机均衡分组并生成组内循环；每组前二晋级淘汰赛。'
        : s.event.format === 'SINGLE_ELIMINATION'
          ? '服务端随机生成固定签位；首轮轮空不生成比赛，之后逐轮确认并发布。'
          : '服务端随机生成对阵；之后可自动排入时间并校验。';
    if (
      !(await ui.confirm(
        GENERATE_TITLES[s.event.format],
        s.freeze.entryCount + ' 支冻结球队。' + note,
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
          algorithmVersion: ALGORITHMS[s.event.format],
          policy,
          ...(groupConfig ? { groupConfig } : {}),
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
          algorithmVersion: ALGORITHMS[s.event.format],
          policy: r.policy,
          ...(r.groupConfig ? { groupConfig: r.groupConfig } : {}),
          redrawReason: reason,
        },
        '重新抽签',
      )
    ) {
      this.setData({ redrawOpen: false, redrawReason: '', conflicts: [], validated: false });
      await this.load();
    }
  },
  openSetup() {
    ui.open('event-setup', { orgId: this.orgId, eventId: this.eventId });
  },
  openEvent() {
    ui.open('org-event', { orgId: this.orgId, eventId: this.eventId });
  },
  openBracket() {
    ui.open('bracket', { orgId: this.orgId, eventId: this.eventId });
  },
  openReview() {
    ui.open('entry-review', { orgId: this.orgId, eventId: this.eventId });
  },
});
