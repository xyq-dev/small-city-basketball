const api = require('../../utils/api');
const ui = require('../../utils/ui');
const training = require('../../utils/training');
Page({
  data: {
    organizations: [],
    orgIndex: 0,
    orgId: '',
    workspace: null,
    teaching: [],
    coachProfiles: [],
    roster: null,
    enrollment: null,
    error: '',
    message: '',
    busy: false,
    loading: false,
    pending: null,
    loginRequired: false,
    reason: '',
    providerName: '',
    providerEvidence: '',
    qualifiedUntil: '',
    coachUserId: '',
    coachName: '',
    coachEvidence: '',
    courseTitle: '',
    courseDescription: '',
    courseIndex: 0,
    courtIndex: 0,
    coachIndex: 0,
    cohortTitle: '',
    address: '',
    capacity: '8',
    price: '0.00',
    termsText: '',
    lessonDate: '',
    startTime: '',
    endTime: '',
    sessions: [],
    cutoffIndex: 0,
    cutoffs: ['首课前1小时截止', '首课前24小时截止'],
    isOperator: false,
  },
  onLoad(q) {
    this._alive = true;
    this._generation = 0;
    try {
      if (q && q.orgId) this.setData({ orgId: training.id(q.orgId) });
      this._session = q && q.session ? training.id(q.session) : '';
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  onShow() {
    this._hidden = false;
    this.load();
  },
  onHide() {
    this._hidden = true;
    this._generation++;
  },
  onUnload() {
    this._alive = false;
    this._generation++;
    ui.close(this);
  },
  onSessionReset() {
    this._generation++;
    this._actor = '';
    this._writeToken = null;
    this.setData({
      workspace: null,
      teaching: [],
      coachProfiles: [],
      roster: null,
      enrollment: null,
      pending: null,
      busy: false,
      loginRequired: true,
      error: '身份已变化，请重新读取。',
    });
  },
  live(g) {
    return this._alive && !this._hidden && g === this._generation;
  },
  async load() {
    if (this.data.busy) return;
    const g = ++this._generation;
    this.setData({ loading: true, error: '' });
    try {
      const token = ui.begin(this),
        s = await ui.session(this, '/pages/training-manage/index');
      if (!s || !ui.live(this, token) || !this.live(g)) return;
      this._actor = s.user.id;
      const org = this.data.orgId || s.organizations[0]?.id || '';
      const mine = await training.read('/v1/training/mine');
      if (!this.live(g)) return;
      this.setData({
        organizations: s.organizations,
        orgId: org,
        isOperator: !!s.platformOperator,
        pending: training.pending(s.user.id),
        teaching: mine.teaching.map((x) => ({
          ...x,
          time: training.time(x.starts_at),
          stateLabel: training.label(x.state),
        })),
        coachProfiles: mine.coachProfiles,
      });
      if (org) {
        const workspace = await training.read('/v1/orgs/' + training.id(org) + '/training');
        if (this.live(g))
          this.setData({
            workspace: {
              ...workspace,
              approvedCoaches: workspace.coaches.filter((c) => c.status === 'APPROVED'),
              cohorts: workspace.cohorts.map(training.cohort),
            },
          });
      }
      if (this._session && this.live(g)) await this.showRoster(this._session);
    } catch (e) {
      if (this.live(g)) this.setData({ error: ui.message(e) });
    } finally {
      if (this.live(g)) this.setData({ loading: false });
    }
  },
  input(e) {
    const field = e.currentTarget.dataset.field;
    const allowed = [
      'orgId',
      'reason',
      'providerName',
      'providerEvidence',
      'qualifiedUntil',
      'coachUserId',
      'coachName',
      'coachEvidence',
      'courseTitle',
      'courseDescription',
      'cohortTitle',
      'address',
      'capacity',
      'price',
      'termsText',
    ];
    if (allowed.includes(field)) this.setData({ [field]: e.detail.value });
  },
  pick(e) {
    const field = e.currentTarget.dataset.field;
    if (['courseIndex', 'courtIndex', 'coachIndex', 'cutoffIndex'].includes(field))
      this.setData({ [field]: Number(e.detail.value) });
    if (['lessonDate', 'startTime', 'endTime', 'qualifiedUntil'].includes(field))
      this.setData({ [field]: e.detail.value });
  },
  pickOrg(e) {
    const index = Number(e.detail.value),
      org = this.data.organizations[index];
    if (org) {
      this.setData({
        orgIndex: index,
        orgId: org.id,
        workspace: null,
        roster: null,
        enrollment: null,
        sessions: [],
      });
      this.load();
    }
  },
  addSession() {
    try {
      const d = this.data,
        coach = d.workspace?.coaches.filter((c) => c.status === 'APPROVED')[d.coachIndex];
      if (!coach || !d.lessonDate || !d.startTime || !d.endTime)
        throw Error('请选择日期、起止时间和已审核教练');
      if (d.sessions.length >= 8) throw Error('短班最多8节课');
      const startsAt = new Date(d.lessonDate + 'T' + d.startTime + ':00+08:00').toISOString(),
        endsAt = new Date(d.lessonDate + 'T' + d.endTime + ':00+08:00').toISOString();
      if (startsAt >= endsAt) throw Error('结束时间须晚于开始时间');
      this.setData({
        sessions: [
          ...d.sessions,
          {
            startsAt,
            endsAt,
            coachIds: [coach.id],
            priceWeight: 1,
            bufferMinutes: 15,
            label: d.lessonDate + ' ' + d.startTime + '–' + d.endTime + ' · ' + coach.display_name,
          },
        ],
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  clearSessions() {
    this.setData({ sessions: [] });
  },
  async send(path, body) {
    if (this.data.busy || !this._actor) return;
    const actor = this._actor,
      token = ui.hold(this);
    this._writeToken = token;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const result = await training.write(actor, path, body);
      if (this._alive && !this._hidden && ui.held(this, token) && this._actor === actor) {
        this.setData({ pending: null, message: '操作已记录。', busy: false });
        await this.load();
        if (!this._alive || this._hidden || !ui.held(this, token) || this._actor !== actor) return;
        if (result.enrollmentId) await this.showEnrollment(result.enrollmentId);
        if (result.sessionId) await this.showRoster(result.sessionId);
        else if (this.data.roster) await this.showRoster(this.data.roster.session.id);
      }
    } catch (e) {
      if (this._alive && !this._hidden && ui.held(this, token) && this._actor === actor)
        this.setData({ error: ui.message(e), pending: training.pending(actor) });
    } finally {
      if (this._writeToken === token) {
        this._writeToken = null;
        if (this._alive) this.setData({ busy: false });
        else this.data.busy = false;
      }
    }
  },
  createProvider() {
    const d = this.data;
    try {
      return this.send('/v1/orgs/' + training.id(d.orgId) + '/training/provider', {
        name: d.providerName,
        evidenceReference: d.providerEvidence,
        qualifiedUntil: new Date(d.qualifiedUntil + 'T23:59:59+08:00').toISOString(),
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  providerAction(e) {
    const p = this.data.workspace?.provider;
    if (p)
      return this.send('/v1/orgs/' + training.id(this.data.orgId) + '/training/provider/commands', {
        action: e.currentTarget.dataset.action,
        expectedVersion: p.version,
        reason: this.data.reason,
      });
  },
  addCoach() {
    const d = this.data;
    try {
      return this.send('/v1/orgs/' + training.id(d.orgId) + '/training/coaches', {
        userId: training.id(d.coachUserId),
        displayName: d.coachName,
        evidenceReference: d.coachEvidence,
        qualifiedUntil: new Date(d.qualifiedUntil + 'T23:59:59+08:00').toISOString(),
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  coachAction(e) {
    const all = [...(this.data.workspace?.coaches || []), ...this.data.coachProfiles],
      x = all.find((c) => c.id === e.currentTarget.dataset.id);
    if (!x) return;
    const action = e.currentTarget.dataset.action,
      body = { action, expectedVersion: x.version };
    if (action !== 'CONSENT') body.reason = this.data.reason;
    return this.send('/v1/training/coaches/' + x.id + '/commands', body);
  },
  createCourse() {
    const d = this.data;
    return this.send('/v1/orgs/' + training.id(d.orgId) + '/training/courses', {
      title: d.courseTitle,
      description: d.courseDescription,
    });
  },
  createCohort() {
    const d = this.data;
    try {
      const course = d.workspace?.courses[d.courseIndex],
        court = d.workspace?.courts[d.courtIndex];
      if (!course || !court || !d.sessions.length) throw Error('请选择课程、场地并添加课次');
      if (!/^\d+(?:\.\d{1,2})?$/.test(d.price)) throw Error('金额最多两位小数');
      const parts = d.price.split('.'),
        totalFen = Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
      const sessions = d.sessions
        .map(({ label, ...s }) => s)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return this.send('/v1/orgs/' + training.id(d.orgId) + '/training/cohorts', {
        courseId: course.id,
        courtId: court.id,
        title: d.cohortTitle,
        address: d.address,
        capacity: Number(d.capacity),
        totalFen,
        termsText: d.termsText,
        enrollmentDeadline: new Date(
          Date.parse(sessions[0].startsAt) - (d.cutoffIndex === 1 ? 24 : 1) * 3600000,
        ).toISOString(),
        sessions,
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  cohortAction(e) {
    const x = this.data.workspace?.cohorts.find((c) => c.id === e.currentTarget.dataset.id);
    if (!x || ['COMPLETED', 'CANCELLED'].includes(x.state)) return;
    const action = e.currentTarget.dataset.action,
      body = { action, expectedVersion: x.version };
    if (action === 'COMPLETE') {
      if (x.capabilities?.canComplete !== true)
        return this.setData({
          error: x.capabilities?.completionBlocker || '当前班期不能结课，请刷新后核对。',
        });
      if (!this.data.reason.trim()) return this.setData({ error: '请填写正常结课的事实依据。' });
    }
    if (action !== 'PUBLISH') body.reason = this.data.reason;
    return this.send('/v1/training/cohorts/' + x.id + '/commands', body);
  },
  roster(e) {
    this.showRoster(e.currentTarget.dataset.id);
  },
  async showRoster(id) {
    try {
      const actor = this._actor,
        r = await training.read('/v1/training/sessions/' + training.id(id) + '/roster');
      if (actor === this._actor && !this._hidden)
        this.setData({
          roster: {
            ...r,
            session: {
              ...r.session,
              time: training.time(r.session.starts_at),
              stateLabel: training.label(r.session.state),
            },
            learners: r.learners.map((x) => ({ ...x, stateLabel: training.label(x.state) })),
            consumptions: r.consumptions.map((x) => ({
              ...x,
              stateLabel: training.label(x.status),
            })),
          },
        });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  sessionAction() {
    const s = this.data.roster?.session;
    if (s)
      return this.send('/v1/training/sessions/' + s.id + '/commands', {
        action: 'DELIVER',
        expectedVersion: s.version,
        reason: this.data.reason,
      });
  },
  lessonAction(e) {
    const x = this.data.roster?.learners.find((v) => v.id === e.currentTarget.dataset.id);
    if (!x) return;
    const action = e.currentTarget.dataset.action,
      body = { action, expectedVersion: x.version };
    if (action === 'PROPOSE_CONSUMPTION') body.reason = this.data.reason;
    return this.send('/v1/training/entitlements/' + x.id + '/commands', body);
  },
  consumptionAction(e) {
    const x = [
      ...(this.data.roster?.consumptions || []),
      ...(this.data.enrollment?.consumptions || []),
    ].find((v) => v.id === e.currentTarget.dataset.id);
    if (x)
      return this.send('/v1/training/consumptions/' + x.id + '/commands', {
        action: e.currentTarget.dataset.action,
        expectedVersion: x.version,
        reason: this.data.reason,
      });
  },
  enrollment(e) {
    this.showEnrollment(e.currentTarget.dataset.id);
  },
  async showEnrollment(id) {
    try {
      const actor = this._actor,
        r = await training.read('/v1/training/enrollments/' + training.id(id));
      if (actor === this._actor && !this._hidden)
        this.setData({ enrollment: training.enrollment(r) });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  refundAction(e) {
    const x = this.data.enrollment?.refunds.find((v) => v.id === e.currentTarget.dataset.id);
    if (x)
      return this.send('/v1/training/refunds/' + x.id + '/commands', {
        action: e.currentTarget.dataset.action,
        expectedVersion: x.version,
        reason: this.data.reason,
      });
  },
  login() {
    ui.login('/pages/training-manage/index');
  },
  async recover() {
    try {
      const r = await training.recover(this._actor);
      this.setData({
        pending: training.pending(this._actor),
        message: r?.pending ? '暂无回执，请用原编号重试。' : '已核对原操作。',
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async retry() {
    try {
      await training.retry(this._actor);
      this.setData({ pending: null });
      await this.load();
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
});
