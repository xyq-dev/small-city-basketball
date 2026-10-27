const ui = require('../../utils/ui');
const tm = require('../../utils/team-membership');
const PATH = '/pages/team-requests/index';
const linkView = (l) => ({
  ...l,
  stateText: tm.linkState(l.status),
  expires: ui.localTime(l.expiresAt, true),
});
const requestView = (r) => ({
  ...r,
  stateText: tm.requestState(r.status),
  created: ui.localTime(r.createdAt, true),
});
// Organization OWNER/ADMIN entry: issue and revoke "apply to create a team" share links and
// review team requests. The share token is shown once in page memory and never stored.
Page({
  data: {
    orgId: '',
    orgName: '',
    allowed: false,
    links: [],
    requests: [],
    filter: 'PENDING',
    hours: '72',
    maxUses: '20',
    linkReason: '',
    revokeReason: '',
    issued: null,
    selectedId: '',
    reviewReason: '',
    loading: false,
    busy: false,
    uncertain: false,
    error: '',
    message: '',
    loginRequired: false,
  },
  onLoad(query) {
    this._alive = true;
    try {
      this.setData({ orgId: tm.id(query && query.orgId) });
    } catch (error) {
      this._routeError = true;
      this.setData({ error: ui.message(error) });
    }
  },
  onShow() {
    if (!this.data.busy && !this._routeError) this.load();
  },
  onHide() {
    // The one-time share token is not kept once the page is left.
    this.setData({ issued: null });
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  login() {
    ui.login('');
  },
  async load() {
    if (this.data.busy) return;
    this.setData({ loading: true, error: '', links: [], requests: [] });
    ui.begin(this);
    const session = await ui.session(this, PATH);
    if (!this._alive) return;
    if (!session) {
      this.setData({ loading: false });
      return;
    }
    this._viewer = session.user.id;
    const membership = session.organizations.find((o) => o.id === this.data.orgId);
    const allowed = !!membership && ['ORG_OWNER', 'ORG_ADMIN'].includes(membership.role);
    this.setData({ allowed, orgName: membership ? membership.name : '' });
    if (!allowed) {
      this.setData({ loading: false });
      return;
    }
    const token = ui.begin(this);
    try {
      const repo = tm.createRepository();
      const [links, requests] = await Promise.all([
        repo.links(this.data.orgId),
        repo.orgRequests(this.data.orgId, this.data.filter),
      ]);
      if (ui.live(this, token))
        this.setData({
          loading: false,
          links: links.map(linkView),
          requests: requests.map(requestView),
        });
    } catch (error) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  input(e) {
    if (this.data.busy) return;
    const field = e.currentTarget.dataset.field;
    if (['hours', 'maxUses', 'linkReason', 'revokeReason', 'reviewReason'].includes(field))
      this.setData({ [field]: e.detail.value });
  },
  filter(e) {
    const value = e.currentTarget.dataset.value;
    if (this.data.busy || !['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(value)) return;
    this.setData({ filter: value, selectedId: '' });
    this.load();
  },
  async createLink() {
    const orgId = this.data.orgId;
    let input;
    try {
      input = {
        expiresInHours: Number(this.data.hours),
        maxUses: Number(this.data.maxUses),
        reason: tm.reason(this.data.linkReason, '生成原因'),
      };
      if (
        !Number.isInteger(input.expiresInHours) ||
        input.expiresInHours < 1 ||
        input.expiresInHours > 168
      )
        throw new Error('有效期需为1–168小时');
      if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 200)
        throw new Error('可用次数需为1–200');
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    await tm.confirmedWrite(this, ui, {
      title: '生成申请建队入口',
      content:
        '入口' +
        input.expiresInHours +
        '小时内有效、最多' +
        input.maxUses +
        '份申请；持有入口的已登录用户可向本机构提交建队申请，批准仍需管理员审核。',
      path: PATH,
      send: () => tm.createRepository().createLink(orgId, input),
      done: async (result) =>
        this.setData({
          issued: { token: result.token, path: tm.sharePath(result.token), linkId: result.link.id },
          links: [linkView(result.link)].concat(this.data.links),
          linkReason: '',
          uncertain: false,
          message: '入口已生成。分享入口只显示这一次，离开本页后不能再次查看。',
        }),
    });
    if (this.data.uncertain)
      this.setData({ message: '生成结果未知；未显示的入口无法找回，请在列表核对后撤销多余入口。' });
  },
  copyLink() {
    if (this.data.issued && typeof wx.setClipboardData === 'function')
      wx.setClipboardData({ data: this.data.issued.path });
  },
  onShareAppMessage() {
    const issued = this.data.issued;
    return issued
      ? { title: '申请在' + this.data.orgName + '建队', path: issued.path }
      : { title: '小城市篮球', path: '/pages/home/index' };
  },
  async revokeLink(e) {
    const link = this.data.links.find((l) => l.id === e.currentTarget.dataset.id);
    if (!link || link.status === 'REVOKED') return;
    let why;
    try {
      why = tm.reason(this.data.revokeReason, '撤销原因');
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const orgId = this.data.orgId;
    await tm.confirmedWrite(this, ui, {
      title: '撤销申请入口',
      content: '撤销后该入口不能再提交申请；已提交的申请不受影响。',
      path: PATH,
      send: () => tm.createRepository().revokeLink(orgId, link.id, why),
      done: async (updated) =>
        this.setData({
          links: this.data.links.map((l) => (l.id === updated.id ? linkView(updated) : l)),
          issued:
            this.data.issued && this.data.issued.linkId === updated.id ? null : this.data.issued,
          revokeReason: '',
          message: '入口已撤销。',
        }),
    });
  },
  select(e) {
    if (!this.data.busy) this.setData({ selectedId: e.currentTarget.dataset.id, reviewReason: '' });
  },
  async review(e) {
    const decision = e.currentTarget.dataset.decision;
    const item = this.data.requests.find((r) => r.id === this.data.selectedId);
    if (!item || !item.capabilities.canReview || !['APPROVE', 'REJECT'].includes(decision)) return;
    let why;
    try {
      why = tm.reason(this.data.reviewReason, '审核原因');
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const orgId = this.data.orgId;
    await tm.confirmedWrite(this, ui, {
      title: decision === 'APPROVE' ? '批准建队申请' : '拒绝建队申请',
      content:
        decision === 'APPROVE'
          ? '将创建球队“' +
            item.teamName +
            '”，并授予申请人“' +
            item.requesterDisplayName +
            '”该队领队权限；不授予机构或赛事工作人员身份。'
          : '拒绝后申请人可看到审核说明。',
      path: PATH,
      send: () => tm.createRepository().review(orgId, item.id, decision, why, item.version),
      done: async (updated) =>
        this.setData({
          requests: this.data.requests.map((r) => (r.id === updated.id ? requestView(updated) : r)),
          selectedId: '',
          reviewReason: '',
          message: decision === 'APPROVE' ? '已批准，球队已创建。' : '已拒绝。',
        }),
    });
    if (/已更新|已处理/.test(this.data.error))
      this.setData({ message: '记录已变化，请重新读取后再审核。' });
  },
  refresh() {
    if (!this.data.busy) this.load();
  },
});
