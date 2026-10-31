const api = require('../../utils/api'),
  ui = require('../../utils/ui'),
  repo = require('../../utils/recruitment'),
  recovery = require('../../utils/recruitment-recovery');
Page({
  data: {
    mode: 'mine',
    orgId: '',
    eventId: '',
    publicId: '',
    userId: '',
    public: null,
    workspace: null,
    applications: [],
    invitations: [],
    applicationCursor: null,
    invitationCursor: null,
    preview: null,
    pending: null,
    title: '',
    description: '',
    closesAt: '',
    maxApplications: '64',
    teamName: '',
    teamId: '',
    note: '',
    reason: '',
    bulk: '',
    targetUserId: '',
    expiresAt: '',
    busy: false,
    loading: false,
    loginRequired: false,
    error: '',
    message: '',
  },
  onLoad(q) {
    try {
      if (q.publicId) this.setData({ mode: 'public', publicId: api.publicId(q.publicId) });
      else if (q.orgId && q.eventId)
        this.setData({ mode: 'manage', orgId: api.uuid(q.orgId), eventId: api.uuid(q.eventId) });
    } catch (e) {
      this._invalid = true;
      this.setData({ error: ui.message(e) });
    }
  },
  onShow() {
    this._visible = true;
    this.load();
  },
  onHide() {
    this._visible = false;
    ui.close(this);
    this.setData({
      userId: '',
      applications: [],
      invitations: [],
      preview: null,
      pending: null,
      teamName: '',
      teamId: '',
      note: '',
      targetUserId: '',
      bulk: '',
      reason: '',
    });
  },
  onUnload() {
    this.onHide();
  },
  onSessionReset() {
    this.setData({
      userId: '',
      applications: [],
      invitations: [],
      workspace: null,
      preview: null,
      pending: null,
      teamName: '',
      teamId: '',
      note: '',
      targetUserId: '',
      bulk: '',
      reason: '',
      busy: false,
      loading: false,
      loginRequired: true,
      error: '登录身份已变化，请重新读取。',
    });
  },
  login() {
    ui.login(
      '/pages/recruitment/index' +
        (this.data.publicId
          ? '?publicId=' + this.data.publicId
          : this.data.orgId
            ? '?orgId=' + this.data.orgId + '&eventId=' + this.data.eventId
            : ''),
    );
  },
  input(e) {
    const k = e.currentTarget.dataset.field;
    if (
      [
        'title',
        'description',
        'closesAt',
        'maxApplications',
        'teamName',
        'teamId',
        'note',
        'reason',
        'bulk',
        'targetUserId',
        'expiresAt',
      ].includes(k) &&
      !this.data.busy &&
      !this.data.pending
    )
      this.setData({ [k]: e.detail.value, ...(k === 'bulk' ? { preview: null } : {}) });
  },
  base() {
    return repo.base(this.data.orgId, this.data.eventId);
  },
  async load() {
    if (this._invalid || this.data.busy) return;
    const t = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      if (this.data.mode === 'public') {
        this.setData({ public: null });
        const r = await api.getClient().requestPublic(repo.publicPath(this.data.publicId));
        if (!ui.live(this, t)) return;
        this.setData({ public: r.data });
      }
      const s = await ui.session(this, '/pages/recruitment/index');
      if (!s || !ui.live(this, t)) return;
      this.setData({ userId: s.user.id, pending: recovery.read(s.user.id) });
      if (this.data.mode === 'manage') {
        const w = await repo.get(this.base() + '/recruitment');
        if (!ui.live(this, t)) return;
        this.setData({ workspace: w });
      }
      const a = await repo.listing(
        this.data.mode === 'manage'
          ? this.base() + '/recruitment-applications'
          : '/v1/me/recruitment-applications',
      );
      if (!ui.live(this, t)) return;
      this.setData({ applications: a.items, applicationCursor: a.nextCursor });
      const i = await repo.listing(
        this.data.mode === 'manage'
          ? this.base() + '/event-invitations'
          : '/v1/me/event-invitations',
      );
      if (!ui.live(this, t)) return;
      this.setData({ invitations: i.items, invitationCursor: i.nextCursor });
    } catch (e) {
      if (ui.live(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.live(this, t)) this.setData({ loading: false });
    }
  },
  async more(e) {
    if (this.data.busy || this.data.loading) return;
    const kind = e.currentTarget.dataset.kind,
      key = kind === 'applications' ? 'applicationCursor' : 'invitationCursor',
      cursor = this.data[key];
    if (!cursor) return;
    const t = ui.begin(this);
    this.setData({ loading: true });
    try {
      const path =
        kind === 'applications'
          ? this.data.mode === 'manage'
            ? this.base() + '/recruitment-applications'
            : '/v1/me/recruitment-applications'
          : this.data.mode === 'manage'
            ? this.base() + '/event-invitations'
            : '/v1/me/event-invitations';
      const r = await repo.listing(path, cursor);
      if (ui.live(this, t))
        this.setData({ [kind]: this.data[kind].concat(r.items), [key]: r.nextCursor });
    } catch (e) {
      if (ui.live(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.live(this, t)) this.setData({ loading: false });
    }
  },
  async command(kind, path, body) {
    if (this.data.busy || this.data.pending || !this.data.userId) return;
    const op = await ui.confirmOp(
      this,
      '确认提交',
      '请核对当前账号、赛事和填写内容。申请通过只创建待补齐报名；邀请只授单队领队权限。',
    );
    if (!op || !op.valid()) return;
    const t = ui.hold(this),
      actor = this.data.userId;
    this.setData({ busy: true, error: '', message: '' });
    try {
      const id = await ui.uuid();
      if (!op.valid() || !ui.held(this, t)) return;
      const original = { kind, path, body: { clientRequestId: id, ...body } };
      recovery.save(actor, original);
      if (!op.valid() || !ui.held(this, t)) return;
      this.setData({ pending: original });
      await this.send(original, actor, t);
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async send(original, actor, t) {
    try {
      const r = await api.getClient().request(original.path, 'POST', original.body);
      recovery.clear(actor, original);
      if (!ui.held(this, t)) return;
      this.setData({
        pending: null,
        message: '已提交，请重新读取核对最新状态。',
        ...(original.kind === 'COMMIT' ? { preview: null, bulk: '' } : {}),
        ...(r.data.preview ? { preview: r.data.preview } : {}),
      });
    } catch (e) {
      if (!recovery.unknown(e)) recovery.clear(actor, original);
      if (ui.held(this, t))
        this.setData({
          pending: recovery.read(actor),
          error: ui.message(e) + (recovery.unknown(e) ? ' 请核对原编号；不要重新提交。' : ''),
          ...(original.kind === 'COMMIT' && !recovery.unknown(e) ? { preview: null } : {}),
        });
    }
  },
  async recover(e) {
    if (this.data.busy || !this.data.pending || !this.data.userId) return;
    const original = this.data.pending,
      actor = this.data.userId;
    const op = await ui.confirmOp(
      this,
      '核对原请求',
      e.currentTarget.dataset.replay
        ? '以原编号和原内容重试，服务端不会重复创建。'
        : '查询原请求回执；查不到不能据此认定没有提交。',
    );
    if (!op || !op.valid()) return;
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      if (e.currentTarget.dataset.replay) {
        if (op.valid()) await this.send(original, actor, t);
      } else {
        const r = await repo.get(
          '/v1/me/recruitment-requests/' + api.uuid(original.body.clientRequestId),
        );
        if (!op.valid() || !ui.held(this, t)) return;
        recovery.clear(actor, original);
        this.setData({
          pending: null,
          message: '已找到原请求回执，请重新读取核对。',
          ...(r.result?.preview ? { preview: r.result.preview } : {}),
        });
      }
    } catch (e) {
      if (ui.held(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  publish() {
    const d = this.data;
    return this.command('PUBLISH', this.base() + '/recruitment/publish', {
      expectedEventVersion: d.workspace.event.version,
      title: d.title,
      description: d.description,
      closesAt: d.closesAt,
      maxApplications: Number(d.maxApplications),
    });
  },
  revoke() {
    const d = this.data;
    return this.command('REVOKE', this.base() + '/recruitment/revoke', {
      expectedVersion: d.workspace.publication.version,
      reason: d.reason,
    });
  },
  apply() {
    const d = this.data;
    return this.command('APPLY', repo.publicPath(d.publicId) + '/applications', {
      teamName: d.teamName,
      teamId: d.teamId || null,
      note: d.note || null,
    });
  },
  review(e) {
    const row = this.data.applications.find((r) => r.id === e.currentTarget.dataset.id);
    if (!row) return;
    return this.command(
      'REVIEW',
      repo.base(row.orgId, row.eventId) +
        '/recruitment-applications/' +
        api.uuid(row.id) +
        '/commands',
      {
        expectedVersion: row.version,
        type: e.currentTarget.dataset.decision,
        reason: this.data.reason,
      },
    );
  },
  preview() {
    try {
      return this.command('PREVIEW', this.base() + '/team-import/previews', {
        expectedEventVersion: this.data.workspace.event.version,
        rows: repo.parseTeams(this.data.bulk),
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  commit() {
    const p = this.data.preview;
    if (p && p.canCommit)
      return this.command('COMMIT', this.base() + '/team-import/commit', {
        expectedEventVersion: p.eventVersion,
        previewId: p.id,
        previewHash: p.previewHash,
      });
  },
  invite() {
    const d = this.data;
    return this.command('INVITE', this.base() + '/event-invitations', {
      expectedEventVersion: d.workspace.event.version,
      teamId: d.teamId,
      targetUserId: d.targetUserId,
      expiresAt: d.expiresAt,
    });
  },
  decide(e) {
    const r = this.data.invitations.find((r) => r.id === e.currentTarget.dataset.id);
    if (!r) return;
    return this.command('DECIDE', '/v1/event-invitations/' + api.uuid(r.id) + '/commands', {
      expectedVersion: r.version,
      type: e.currentTarget.dataset.decision,
    });
  },
  onShareAppMessage() {
    const p =
      this.data.mode === 'public'
        ? this.data.publicId
        : this.data.workspace?.publication?.status === 'ACTIVE'
          ? this.data.workspace.publication.publicId
          : '';
    return {
      title: this.data.public?.title || this.data.workspace?.publication?.title || '赛事招募',
      path: p ? '/pages/recruitment/index?publicId=' + p : '/pages/recruitment/index',
    };
  },
});
