const api = require('../../utils/api');
const ui = require('../../utils/ui');
const training = require('../../utils/training');
Page({
  data: {
    viewTab: 'catalog',
    signupStep: 'course',
    mineLoaded: false,
    mineLoading: false,
    signupSteps: [
      { key: 'course', label: '课程班次' },
      { key: 'review', label: '本人资料与合同' },
    ],
    items: [],
    mine: [],
    detail: null,
    enrollment: null,
    isLearner: false,
    loading: false,
    busy: false,
    error: '',
    message: '',
    enabled: false,
    adult: false,
    accepted: false,
    chargeConsent: false,
    waitlist: false,
    payerUserId: '',
    reason: '',
    makeup: null,
    makeupLoading: false,
    pending: null,
    loginRequired: false,
  },
  onLoad(q) {
    this._alive = true;
    this._generation = 0;
    try {
      this._cohort = q && q.cohort ? training.id(q.cohort) : '';
      this._enrollment = q && q.enrollment ? training.id(q.enrollment) : '';
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  onShow() {
    this._hidden = false;
    this.load();
    if (this._enrollment) this.showEnrollment(this._enrollment);
  },
  onHide() {
    this._hidden = true;
    this._generation++;
    this._makeupRequest = (this._makeupRequest || 0) + 1;
    this.setData({
      adult: false,
      accepted: false,
      chargeConsent: false,
      makeup: null,
      makeupLoading: false,
    });
  },
  onUnload() {
    this._alive = false;
    this._generation++;
    ui.close(this);
  },
  onSessionReset() {
    this._generation++;
    this._makeupRequest = (this._makeupRequest || 0) + 1;
    this._actor = '';
    this._cohort = '';
    this._enrollment = '';
    this._writeToken = null;
    this.setData({
      mine: [],
      detail: null,
      viewTab: 'catalog',
      signupStep: 'course',
      mineLoaded: false,
      mineLoading: false,
      enabled: false,
      waitlist: false,
      enrollment: null,
      isLearner: false,
      pending: null,
      payerUserId: '',
      reason: '',
      makeup: null,
      makeupLoading: false,
      busy: false,
      adult: false,
      accepted: false,
      chargeConsent: false,
      loginRequired: true,
      error: '登录身份已变化，请重新读取。',
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
      const r = await training.read('/v1/training/catalog');
      if (!this.live(g)) return;
      this.setData({
        items: r.items.map(training.cohort),
        enabled: r.capabilities.enabled,
        loading: false,
      });
      if (this._cohort) await this.showDetail(this._cohort);
    } catch (e) {
      if (this.live(g)) this.setData({ loading: false, error: ui.message(e) });
    }
  },
  async identify() {
    const token = ui.begin(this),
      s = await ui.session(this, '/pages/training/index');
    if (!s || !ui.live(this, token) || this._hidden) return null;
    if (this._actor && this._actor !== s.user.id) this.onSessionReset();
    this._actor = s.user.id;
    this.setData({ pending: training.pending(s.user.id), loginRequired: false });
    return s;
  },
  async loadMine() {
    if (this.data.busy) return;
    this.setData({
      viewTab: 'mine',
      detail: null,
      enrollment: null,
      makeup: null,
      mineLoading: true,
    });
    try {
      const s = await this.identify();
      if (!s) return;
      const g = this._generation;
      const r = await training.read('/v1/training/mine');
      if (this.live(g) && this._actor === s.user.id)
        this.setData({ mine: r.items.map(training.enrollment), mineLoaded: true });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    } finally {
      if (this._alive && !this._hidden) this.setData({ mineLoading: false });
    }
  },
  select(e) {
    this.showDetail(training.id(e.currentTarget.dataset.id));
  },
  async showDetail(id) {
    try {
      const g = this._generation,
        r = await training.read('/v1/training/cohorts/' + training.id(id));
      if (this.live(g))
        this.setData({
          detail: training.cohort(r),
          enrollment: null,
          signupStep: 'course',
          viewTab: 'catalog',
          adult: false,
          accepted: false,
          chargeConsent: false,
        });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  selectEnrollment(e) {
    this.showEnrollment(e.currentTarget.dataset.id);
  },
  async showEnrollment(id) {
    try {
      const s = await this.identify();
      if (!s) return;
      const g = this._generation,
        r = await training.read('/v1/training/enrollments/' + training.id(id));
      if (this.live(g) && this._actor === s.user.id)
        this.setData({
          enrollment: training.enrollment(r),
          detail: null,
          viewTab: 'mine',
          isLearner: r.learnerUserId === s.user.id,
          makeup: null,
          makeupLoading: false,
        });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  showCatalog() {
    if (this.data.busy) return;
    this._cohort = '';
    this._enrollment = '';
    this.setData({
      viewTab: 'catalog',
      detail: null,
      enrollment: null,
      makeup: null,
      signupStep: 'course',
      adult: false,
      accepted: false,
      chargeConsent: false,
    });
  },
  backToList() {
    if (this.data.busy) return;
    this._cohort = '';
    this._enrollment = '';
    this.setData({
      detail: null,
      enrollment: null,
      makeup: null,
      signupStep: 'course',
      adult: false,
      accepted: false,
      chargeConsent: false,
    });
  },
  signupStep(e) {
    if (this.data.busy || this.data.pending || !this.data.detail) return;
    const key = e.detail.key;
    if (['course', 'review'].includes(key)) this.setData({ signupStep: key });
  },
  reviewSignup() {
    if (this.data.busy || this.data.pending || !this.data.detail) return;
    this.setData({ signupStep: 'review', adult: false, accepted: false, chargeConsent: false });
  },
  input(e) {
    const key = e.currentTarget.dataset.field;
    if (['payerUserId', 'reason'].includes(key)) this.setData({ [key]: e.detail.value });
  },
  consent(e) {
    const checked = e.detail.value || [];
    this.setData({
      adult: checked.includes('adult'),
      accepted: checked.includes('terms'),
      chargeConsent: checked.includes('payment'),
      waitlist: checked.includes('waitlist'),
    });
  },
  async send(path, body) {
    if (this.data.busy) return;
    const s = await this.identify();
    if (!s) return;
    const actor = s.user.id,
      token = ui.hold(this);
    this._writeToken = token;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const r = await training.write(actor, path, body);
      if (!this._alive || this._hidden || !ui.held(this, token) || this._actor !== actor) return;
      this.setData({ message: '操作已记录，请核对当前状态。', pending: null });
      if (r.enrollmentId) {
        const n = await training.read('/v1/training/enrollments/' + training.id(r.enrollmentId));
        if (this._alive && !this._hidden && ui.held(this, token) && this._actor === actor)
          this.setData({
            enrollment: training.enrollment(n),
            detail: null,
            viewTab: 'mine',
            isLearner: n.learnerUserId === actor,
            makeup: null,
            makeupLoading: false,
          });
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
  async enroll() {
    const h = this.data.detail;
    if (!h || !this.data.adult || !this.data.accepted)
      return this.setData({ error: '请本人确认成年并阅读本次合同。' });
    if (h.totalFen > 0 && !this.data.chargeConsent)
      return this.setData({ error: '收费课程需要明确同意付款条款。' });
    const s = await this.identify();
    if (!s) return;
    return this.send('/v1/training/cohorts/' + h.id + '/enrollments', {
      payerUserId: this.data.payerUserId ? training.id(this.data.payerUserId) : s.user.id,
      learnerUserId: s.user.id,
      adultConfirmed: true,
      acceptedTermsId: h.termsId,
      chargeConsent: this.data.chargeConsent,
      waitlist: this.data.waitlist,
    });
  },
  enrollmentAction(e) {
    const n = this.data.enrollment;
    if (!n) return;
    const action = e.currentTarget.dataset.action;
    const body = { action, expectedVersion: n.version };
    if (action === 'AUTHORIZE_PAYMENT') {
      if (!this.data.chargeConsent)
        return this.setData({ error: '请阅读冻结合同并明确同意付款。' });
      body.acceptedTermsId = n.termsId;
      body.chargeConsent = true;
    }
    return this.send('/v1/training/enrollments/' + n.id + '/commands', body);
  },
  entitlementAction(e) {
    const n = this.data.enrollment,
      x = n && n.entitlements.find((v) => v.id === e.currentTarget.dataset.id);
    if (!x) return;
    const action = e.currentTarget.dataset.action;
    const body = { action, expectedVersion: x.version };
    if (this.data.reason) body.reason = this.data.reason;
    if (action !== 'LEAVE') return;
    return this.send('/v1/training/entitlements/' + x.id + '/commands', body);
  },
  async chooseMakeup(event) {
    if (this.data.busy || this.data.pending) return;
    const n = this.data.enrollment,
      entitlementId = event.currentTarget.dataset.id;
    const right =
      n && n.entitlements.find((x) => x.id === entitlementId && x.state === 'MAKEUP_DUE');
    if (!right) return;
    const request = (this._makeupRequest || 0) + 1;
    this._makeupRequest = request;
    this.setData({ makeup: null, makeupLoading: true, error: '' });
    try {
      const identity = await this.identify();
      if (!identity) return;
      const raw = await training.read(
        '/v1/training/entitlements/' + training.id(right.id) + '/makeup-options',
      );
      if (
        !this._alive ||
        this._hidden ||
        this._actor !== identity.user.id ||
        request !== this._makeupRequest ||
        this.data.enrollment?.id !== n.id ||
        !this.data.enrollment.entitlements.some(
          (x) => x.id === right.id && x.state === 'MAKEUP_DUE',
        )
      )
        return;
      this.setData({ makeup: training.makeupOptions(raw, right.id) });
    } catch (error) {
      if (this._alive && !this._hidden && request === this._makeupRequest)
        this.setData({ error: ui.message(error) });
    } finally {
      if (this._alive && !this._hidden && request === this._makeupRequest)
        this.setData({ makeupLoading: false });
    }
  },
  selectMakeup(event) {
    const m = this.data.makeup,
      index = Number(event.detail.value);
    if (!m || !Number.isInteger(index) || index < 0 || index >= m.items.length) return;
    this.setData({ makeup: { ...m, selectedIndex: index, selected: m.items[index] } });
  },
  confirmMakeup() {
    const m = this.data.makeup,
      selected = m?.items[m.selectedIndex];
    if (
      !m ||
      !selected ||
      !this.data.enrollment?.entitlements.some(
        (x) => x.id === m.entitlementId && x.state === 'MAKEUP_DUE',
      )
    )
      return this.setData({ error: '请先读取并选择可补课的课次。' });
    this._makeupRequest = (this._makeupRequest || 0) + 1;
    this.setData({ makeup: null });
    return this.send('/v1/training/entitlements/' + training.id(m.entitlementId) + '/commands', {
      action: 'MAKEUP',
      expectedVersion: m.entitlementVersion,
      sessionId: training.id(selected.sessionId),
    });
  },
  consumptionAction(e) {
    const n = this.data.enrollment,
      x = n && n.consumptions.find((v) => v.id === e.currentTarget.dataset.id);
    if (!x) return;
    const body = { action: e.currentTarget.dataset.action, expectedVersion: x.version };
    if (body.action === 'DISPUTE') body.reason = this.data.reason;
    return this.send('/v1/training/consumptions/' + x.id + '/commands', body);
  },
  refund(e) {
    const n = this.data.enrollment;
    if (!n) return;
    return this.send('/v1/training/enrollments/' + n.id + '/refunds', {
      expectedVersion: n.version,
      entitlementIds: [training.id(e.currentTarget.dataset.id)],
      reason: this.data.reason,
    });
  },
  refreshRefund(e) {
    const n = this.data.enrollment,
      x = n && n.refunds.find((v) => v.id === e.currentTarget.dataset.id);
    if (x)
      return this.send('/v1/training/refunds/' + x.id + '/commands', {
        action: 'REFRESH',
        expectedVersion: x.version,
      });
  },
  openTrade() {
    const n = this.data.enrollment;
    if (n && n.tradeOrderId)
      ui.open('trade-order', { kind: 'TRAINING_ENROLLMENT', sourceId: n.id });
  },
  manage() {
    training.open('training-manage');
  },
  login() {
    ui.login('/pages/training/index');
  },
  async recover() {
    if (!this._actor || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const r = await training.recover(this._actor);
      this.setData({
        pending: training.pending(this._actor),
        message: r && r.pending ? '服务端尚无确认回执，可用原操作重试。' : '已核对原操作。',
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
  async retry() {
    if (!this._actor || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const r = await training.retry(this._actor);
      this.setData({ pending: null, message: '原操作已确认。' });
      if (r.enrollmentId) {
        this.setData({ busy: false });
        await this.showEnrollment(r.enrollmentId);
      }
    } catch (e) {
      this.setData({ error: ui.message(e) });
    } finally {
      this.setData({ busy: false });
    }
  },
});
