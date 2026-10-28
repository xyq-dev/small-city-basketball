const api = require('../../utils/api');
const ui = require('../../utils/ui');
const tm = require('../../utils/team-membership');
const PATH = '/pages/team-request/index';
const view = (r) => ({
  ...r,
  stateText: tm.requestState(r.status),
  created: ui.localTime(r.createdAt, true),
});
// Applicant entry: open an organization's share link, submit one team request (persistently
// deduplicated by its original clientRequestId), follow my requests and withdraw them.
// The share token lives only in page memory; it is never stored or shown.
Page({
  data: {
    hasLink: false,
    link: null,
    teamName: '',
    note: '',
    requests: [],
    pending: null,
    loading: false,
    busy: false,
    uncertain: false,
    error: '',
    message: '',
    loginRequired: false,
  },
  onLoad(query) {
    this._alive = true;
    this._token = '';
    try {
      if (query && query.token) this._token = tm.linkToken(query.token);
    } catch (error) {
      this.setData({ error: ui.message(error) });
    }
    this.setData({ hasLink: !!this._token });
  },
  onShow() {
    if (!this.data.busy) this.load();
  },
  onUnload() {
    this._alive = false;
    this._token = '';
    ui.close(this);
  },
  login() {
    ui.login('');
  },
  async load() {
    if (this.data.busy) return;
    this.setData({ loading: true, error: '', link: null, requests: [], pending: null });
    ui.begin(this);
    const session = await ui.session(this, PATH);
    if (!this._alive) return;
    if (!session) {
      this.setData({ loading: false });
      return;
    }
    this._viewer = session.user.id;
    const token = ui.begin(this);
    const repo = tm.createRepository();
    try {
      const link = this._token
        ? await repo.resolve(this._token).catch((e) => ({ error: e }))
        : null;
      const requests = await repo.myRequests();
      if (!ui.live(this, token)) return;
      const stored = tm.readPending(wx, this._viewer);
      let pending = stored.record;
      let message = '';
      if (pending && requests.some((r) => r.clientRequestId === pending.clientRequestId)) {
        // The server has the original submission: recovery is complete.
        tm.writePending(wx, this._viewer, null, pending.clientRequestId);
        pending = null;
        message = '上次提交已由服务器确认，见下方我的申请。';
      }
      this.setData({
        loading: false,
        link: link && !link.error ? link : null,
        error: link && link.error ? ui.message(link.error) : '',
        requests: requests.map(view),
        pending,
        uncertain: !!pending,
        message,
      });
    } catch (error) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  input(e) {
    if (this.data.busy) return;
    const field = e.currentTarget.dataset.field;
    if (field === 'teamName' || field === 'note') this.setData({ [field]: e.detail.value });
  },
  async submit() {
    if (this.data.busy || this._preparing || !this.data.link || this.data.pending) return;
    const guard = ui.guard(this);
    const viewer = this._viewer;
    const link = this.data.link;
    const linkToken = this._token;
    const still = () =>
      ui.held(this, guard) &&
      this._viewer === viewer &&
      this._token === linkToken &&
      this.data.link &&
      this.data.link.linkId === link.linkId &&
      !this.data.pending;
    let teamName, note;
    try {
      teamName = tm.text(this.data.teamName, '球队名称', 1, 80);
      note = this.data.note.trim() ? tm.text(this.data.note, '补充说明', 1, 500) : null;
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    let clientRequestId;
    this._preparing = true;
    try {
      clientRequestId = await ui.uuid();
    } catch (error) {
      if (still()) this.setData({ error: ui.message(error) });
      return;
    } finally {
      this._preparing = false;
    }
    if (!still()) return;
    const record = {
      clientRequestId,
      teamName,
      note,
      linkId: link.linkId,
      orgName: link.orgName,
    };
    await this.send(
      record,
      '提交建队申请',
      '向“' +
        link.orgName +
        '”提交球队“' +
        teamName +
        '”的建队申请。批准前不能报名；机构管理员审核后才会创建球队。',
      true,
    );
  },
  /** Resend the original submission with its original id; the server returns the same request. */
  async recover() {
    const record = this.data.pending;
    if (this.data.busy || !record) return;
    if (!this._token || !this.data.link || this.data.link.linkId !== record.linkId) {
      await this.load();
      if (this.data.pending)
        this.setData({
          message:
            '上次提交结果仍未确认，且当前没有同一申请入口。请重新打开机构发来的同一入口后再核对；不会创建第二份申请。',
        });
      return;
    }
    await this.send(
      record,
      '核对上次提交',
      '将以原请求编号重新发送同一份申请；服务器只会保留一份。',
      false,
    );
  },
  async send(record, title, content, fresh) {
    const viewer = this._viewer;
    const guard = ui.guard(this);
    if (fresh && !tm.writePending(wx, viewer, record)) {
      this.setData({ error: '无法在本机保存请求编号，未提交申请；请检查存储空间后重试。' });
      return;
    }
    const tokenText = this._token;
    const outcome = {};
    const ok = await tm.confirmedWrite(this, ui, {
      title,
      content,
      path: PATH,
      outcome,
      still: () =>
        this._viewer === viewer &&
        this._token === tokenText &&
        this.data.link &&
        this.data.link.linkId === record.linkId &&
        tm.readPending(wx, viewer).record?.clientRequestId === record.clientRequestId,
      send: () =>
        tm.createRepository().submit({
          token: tokenText,
          clientRequestId: record.clientRequestId,
          teamName: record.teamName,
          note: record.note,
        }),
      done: async (request) => {
        tm.writePending(wx, viewer, null, record.clientRequestId);
        this.setData({
          pending: null,
          uncertain: false,
          teamName: '',
          note: '',
          requests: [view(request)].concat(this.data.requests.filter((r) => r.id !== request.id)),
          message: '申请已提交，等待机构管理员审核。',
        });
      },
    });
    if (!ok && fresh && (!outcome.sent || outcome.resolved)) {
      // Declined, refused before sending, or a definite server refusal: nothing is pending.
      tm.writePending(wx, viewer, null, record.clientRequestId);
    }
    if (!ok && outcome.sent && !outcome.resolved && ui.held(this, guard))
      this.setData({
        pending: record,
        message: '提交结果未知。请点击“核对上次提交”，将以原请求编号恢复，不会重复创建。',
      });
  },
  async withdraw(e) {
    const item = this.data.requests.find((r) => r.id === e.currentTarget.dataset.id);
    if (!item || !item.capabilities.canWithdraw) return;
    await tm.confirmedWrite(this, ui, {
      title: '撤回建队申请',
      content: '撤回“' + item.teamName + '”的申请后不可恢复，需要时请重新提交。',
      path: PATH,
      still: () =>
        this.data.requests.some(
          (r) =>
            r.id === item.id &&
            r.version === item.version &&
            r.status === item.status &&
            r.capabilities.canWithdraw,
        ),
      send: () => tm.createRepository().withdraw(item.id, item.version),
      done: async (updated) =>
        this.setData({
          requests: this.data.requests.map((r) => (r.id === updated.id ? view(updated) : r)),
          message: '申请已撤回。',
          uncertain: false,
        }),
    });
  },
  openTeam(e) {
    const item = this.data.requests.find((r) => r.id === e.currentTarget.dataset.id);
    if (item && item.teamId) tm.go('team', { orgId: item.orgId, teamId: item.teamId });
  },
  refresh() {
    if (!this.data.busy) this.load();
  },
});
