const api = require('../../utils/api'),
  ui = require('../../utils/ui'),
  recovery = require('../../utils/insurance-recovery');
Page({
  data: {
    orgId: '',
    entryId: '',
    userId: '',
    workspace: null,
    pending: null,
    consent: false,
    busy: false,
    loading: false,
    error: '',
    message: '',
  },
  onLoad(q) {
    try {
      this.setData({ orgId: api.uuid(q.orgId), entryId: api.uuid(q.entryId) });
    } catch (e) {
      this._invalid = true;
      this.setData({ error: ui.message(e) });
    }
  },
  onShow() {
    this._closed = false;
    this.load();
  },
  onHide() {
    ui.close(this);
    this.setData({
      userId: '',
      workspace: null,
      pending: null,
      consent: false,
      busy: false,
      loading: false,
    });
  },
  onUnload() {
    this.onHide();
  },
  onSessionReset() {
    this.onHide();
    this.setData({ busy: false, loading: false, error: '登录身份已变化，请重新读取。' });
  },
  materials() {
    ui.open('participant-materials', {
      orgId: this.data.orgId,
      entryId: this.data.entryId,
      mode: this.data.workspace?.canReview ? 'review' : 'mine',
    });
  },
  base() {
    return (
      '/v1/orgs/' + this.data.orgId + '/entries/' + this.data.entryId + '/qualification-precheck'
    );
  },
  async load() {
    if (this._invalid || this.data.busy) return;
    const t = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      const s = await ui.session(
        this,
        '/pages/qualification-precheck/index?orgId=' +
          this.data.orgId +
          '&entryId=' +
          this.data.entryId,
      );
      if (!s || !ui.live(this, t)) return;
      const w = (await api.getClient().request(this.base())).data;
      if (ui.live(this, t))
        this.setData({ userId: s.user.id, workspace: w, pending: recovery.read(s.user.id) });
    } catch (e) {
      if (ui.live(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.live(this, t)) this.setData({ loading: false });
    }
  },
  consent() {
    if (!this.data.busy && !this.data.pending) this.setData({ consent: !this.data.consent });
  },
  async request(e) {
    if (!this.data.consent) return;
    const p = this.data.workspace.participants.find(
      (x) => x.memberId === e.currentTarget.dataset.id,
    );
    if (!p?.canRequest) return;
    return this.write('QUAL_REQUEST', this.base() + '/requests', {
      memberId: p.memberId,
      expectedMaterialVersion: p.materialVersion,
      acceptedTermsVersion: 'qualification-precheck-v1',
    });
  },
  async review(e) {
    const p = this.data.workspace.participants.find(
      (x) => x.memberId === e.currentTarget.dataset.id,
    );
    if (!p?.requestId || !p.requestCurrent || !this.data.workspace.canReview) return;
    const decision = e.currentTarget.dataset.decision;
    const op = await ui.confirmOp(
      this,
      '独立资格预审',
      decision === 'APPROVED'
        ? '请先在受控资料页实际核对身份、照片及本人签署。确认已逐项人工核对当前版本，且无需先买保险。'
        : '将当前预审退回补充，不代表最终报名被拒。',
    );
    if (!op) return;
    return this.write(
      'QUAL_REVIEW',
      this.base() + '/reviews',
      {
        memberId: p.memberId,
        requestId: p.requestId,
        expectedMaterialVersion: p.materialVersion,
        decision,
        reason:
          decision === 'APPROVED'
            ? '已人工核对当前身份、照片及本人签署'
            : '请补充符合要求的身份、照片或本人签署资料',
        identityReviewed: decision === 'APPROVED',
        portraitReviewed: decision === 'APPROVED',
        signatureReviewed: decision === 'APPROVED',
      },
      op,
    );
  },
  async write(kind, path, body, op) {
    if (this.data.busy || this.data.pending || !this.data.userId || (op && !op.valid())) return;
    const t = ui.hold(this),
      actor = this.data.userId;
    this.setData({ busy: true, error: '' });
    try {
      const id = await ui.uuid();
      if (!ui.held(this, t) || (op && !op.valid())) return;
      const value = { kind, path, body: { clientRequestId: id, ...body } };
      recovery.save(actor, value);
      this.setData({ pending: value });
      await this.send(actor, value, t);
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async send(actor, v, t) {
    if (!ui.held(this, t)) return;
    try {
      await api.getClient().request(v.path, 'POST', v.body);
      recovery.clear(actor, v);
      if (ui.held(this, t)) {
        this.setData({
          pending: null,
          consent: false,
          message: '预审操作已记录，最终参赛资格仍需保障和报名审核。',
          busy: false,
        });
        await this.load();
      }
    } catch (e) {
      if (e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status))
        recovery.clear(actor, v);
      if (ui.held(this, t)) this.setData({ pending: recovery.read(actor), error: ui.message(e) });
    }
  },
  async recover() {
    if (this.data.busy || !this.data.pending) return;
    const t = ui.hold(this),
      actor = this.data.userId,
      v = this.data.pending;
    this.setData({ busy: true, error: '' });
    try {
      const result = (await api.getClient().request(recovery.receipt(v))).data;
      if (!ui.held(this, t)) return;
      if (result.found) {
        recovery.clear(actor, v);
        this.setData({ pending: null, message: '原请求已完成，请重新读取。' });
      } else await this.send(actor, v, t);
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
});
