const api = require('../../utils/api');
const ui = require('../../utils/ui');
const gov = require('../../utils/governance');
const materials = require('../../utils/participant-materials');
const PATH = '/pages/governance/index';
const initial = () => ({
  items: [],
  nextCursor: null,
  selected: null,
  organizations: [],
  orgIndex: 0,
  mode: 'mine',
  isOperator: false,
  assignees: [],
  assigneeIndex: 0,
  kindIndex: 0,
  kinds: ['咨询／服务支持', '举报关联内容', '申诉已处理工单'],
  title: '',
  body: '',
  reason: '',
  replyText: '',
  internal: false,
  reviews: [],
  score: 5,
  reviewText: '',
  publicConsent: false,
  loading: false,
  busy: false,
  error: '',
  notice: '',
  pending: null,
  loginRequired: false,
  chosenFile: '',
});
Page({
  data: initial(),
  onLoad(query = {}) {
    this._alive = true;
    this._visible = true;
    this._temporaryFiles = [];
    this._query = {};
    try {
      if (query.caseId) this._query.caseId = gov.id(query.caseId);
      if (query.orgId) this._query.orgId = gov.id(query.orgId);
      if (query.parentCaseId) {
        this._query.parentCaseId = gov.id(query.parentCaseId);
        this.setData({ kindIndex: 2 });
      }
      if (
        ['PUBLIC_EVENT', 'PLAYER_BOOKING', 'LOCAL_BOOKING'].includes(query.sourceKind) &&
        query.sourceId
      ) {
        this._query.source = {
          kind: query.sourceKind,
          id:
            query.sourceKind === 'PUBLIC_EVENT'
              ? api.publicId(query.sourceId)
              : gov.id(query.sourceId),
        };
      }
      if (query.mode === 'assigned') this.setData({ mode: 'assigned' });
    } catch (error) {
      this._invalid = true;
      this.setData({ error: ui.message(error) });
    }
  },
  onShow() {
    this._visible = true;
    materials.sweepTemps(wx);
    this.load();
  },
  onHide() {
    this._visible = false;
    ui.close(this);
    gov.cleanup(this);
    this._file = null;
    this._viewer = null;
    this.setData({ ...initial(), kindIndex: this.data.kindIndex, mode: this.data.mode });
  },
  onUnload() {
    this._alive = false;
    this.onHide();
  },
  onSessionReset() {
    this._viewer = null;
    this._file = null;
    gov.cleanup(this);
    this.setData({
      ...initial(),
      loginRequired: true,
      notice: '身份已变化，已清空旧账号的工单和表单。',
    });
  },
  login() {
    ui.login(PATH);
  },
  async load() {
    if (!this._alive || this._invalid || !this._visible || this.data.busy) return;
    const token = ui.begin(this);
    this.setData({ loading: true, error: '', selected: null, items: [], assignees: [] });
    const session = await ui.session(this, PATH);
    if (!session || !ui.live(this, token)) return;
    this._viewer = session.user.id;
    let mode = this.data.mode;
    if (mode === 'platform' && !session.platformOperator) mode = 'mine';
    this.setData({
      organizations: session.organizations || [],
      isOperator: !!session.platformOperator,
      mode,
    });
    try {
      const pending = gov.readPending(this._viewer, 'CASE');
      const base =
        mode === 'platform' ? '/v1/platform/governance/cases' : '/v1/me/governance/cases';
      const query = mode === 'assigned' ? '?assigned=true' : '';
      const value = gov.page(await gov.request(api.getClient(), base + query));
      if (!ui.live(this, token)) return;
      this.setData({
        items: value.items,
        nextCursor: value.nextCursor || null,
        pending,
        loading: false,
      });
      if (this._query.caseId) await this.selectId(this._query.caseId);
    } catch (error) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  changeMode(e) {
    if (this.data.busy) return;
    const mode = e.currentTarget.dataset.mode;
    if (['mine', 'assigned', 'platform'].includes(mode)) {
      this._query.caseId = null;
      this.setData({ mode });
      this.load();
    }
  },
  field(e) {
    if (this.data.busy) return;
    const name = e.currentTarget.dataset.field;
    if (['title', 'body', 'reason', 'replyText', 'reviewText'].includes(name))
      this.setData({ [name]: String(e.detail.value || '') });
  },
  org(e) {
    this.setData({ orgIndex: Number(e.detail.value) || 0 });
  },
  kind(e) {
    if (!this.data.busy) this.setData({ kindIndex: Number(e.detail.value) || 0 });
  },
  internal(e) {
    this.setData({ internal: !!e.detail.value });
  },
  async more() {
    if (!this.data.nextCursor || this.data.busy || this.data.loading) return;
    const token = ui.guard(this),
      mode = this.data.mode,
      base = mode === 'platform' ? '/v1/platform/governance/cases' : '/v1/me/governance/cases';
    this.setData({ loading: true });
    try {
      const value = gov.page(
        await gov.request(
          api.getClient(),
          base +
            '?before=' +
            gov.id(this.data.nextCursor) +
            (mode === 'assigned' ? '&assigned=true' : ''),
        ),
      );
      if (ui.held(this, token)) {
        const seen = new Set(this.data.items.map((i) => i.id));
        this.setData({
          items: this.data.items.concat(value.items.filter((i) => !seen.has(i.id))),
          nextCursor: value.nextCursor || null,
          loading: false,
        });
      }
    } catch (error) {
      if (ui.held(this, token)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  select(e) {
    return this.selectId(e.currentTarget.dataset.id);
  },
  async history() {
    const selected = this.data.selected;
    if (!selected?.messagesBefore || this.data.busy) return;
    const token = ui.hold(this);
    this.setData({ busy: true });
    try {
      const value = await gov.request(
        api.getClient(),
        '/v1/me/governance/cases/' +
          selected.id +
          '/messages?before=' +
          gov.id(selected.messagesBefore) +
          '&limit=100',
      );
      if (ui.held(this, token) && Array.isArray(value.items))
        this.setData({
          selected: {
            ...selected,
            messages: value.items.concat(selected.messages),
            messagesBefore: value.nextCursor || null,
          },
        });
    } catch (error) {
      if (ui.held(this, token)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async selectId(id) {
    if (this.data.busy || !this._visible) return;
    const token = ui.begin(this);
    this.setData({ selected: null, assignees: [], loading: true, error: '', chosenFile: '' });
    this._file = null;
    gov.cleanup(this);
    try {
      const selected = gov.item(
        await gov.request(api.getClient(), '/v1/me/governance/cases/' + gov.id(id)),
      );
      if (!ui.live(this, token)) return;
      this._query.caseId = selected.id;
      this.setData({ selected, loading: false });
      if (selected.capabilities?.canAssign) {
        const value = await gov.request(
          api.getClient(),
          '/v1/me/governance/cases/' + selected.id + '/assignees',
        );
        if (ui.live(this, token) && Array.isArray(value.items))
          this.setData({ assignees: value.items });
      }
    } catch (error) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  async create() {
    const kind = ['SUPPORT', 'REPORT', 'APPEAL'][this.data.kindIndex] || 'SUPPORT';
    const orgId =
      this._query.orgId ||
      (!this._query.source && !this._query.parentCaseId
        ? this.data.organizations[this.data.orgIndex]?.id
        : null);
    const body = {
      kind,
      title: this.data.title,
      body: this.data.body,
      ...(orgId ? { orgId } : {}),
      ...(this._query.source ? { source: this._query.source } : {}),
      ...(kind === 'APPEAL' && this._query.parentCaseId
        ? { parentCaseId: this._query.parentCaseId }
        : {}),
    };
    try {
      const value = await gov.perform(this, 'CASE', '/v1/me/governance/cases', body, {
        title: '提交工单',
        content: '仅相关客服和当前授权处理人员可查看，请勿提供密码或支付密钥。',
      });
      if (value && this._visible) {
        this.setData({ title: '', body: '' });
        await this.selectId(value.id);
      }
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  async reply() {
    const row = this.data.selected;
    if (!row?.capabilities?.canReply) return;
    try {
      const value = await gov.perform(
        this,
        'CASE',
        '/v1/me/governance/cases/' + row.id + '/messages',
        {
          expectedVersion: row.version,
          body: this.data.replyText,
          visibility: this.data.internal ? 'INTERNAL' : 'REQUESTER',
        },
      );
      if (value && this._visible) {
        this.setData({ replyText: '' });
        await this.selectId(row.id);
      }
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  assignee(e) {
    this.setData({ assigneeIndex: Number(e.detail.value) || 0 });
  },
  async command(e) {
    const row = this.data.selected,
      type = e.currentTarget.dataset.type;
    if (!row) return;
    const assignee = this.data.assignees[this.data.assigneeIndex];
    const body = {
      expectedVersion: row.version,
      type,
      reason: this.data.reason,
      ...(type === 'ASSIGN' && assignee
        ? { assigneeId: assignee.userId, grantId: assignee.grantId }
        : {}),
    };
    try {
      const value = await gov.perform(
        this,
        'CASE',
        '/v1/me/governance/cases/' + row.id + '/commands',
        body,
      );
      if (value && this._visible) {
        this.setData({ reason: '' });
        await this.selectId(row.id);
      }
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  async choose() {
    if (this.data.busy || !this.data.selected?.capabilities?.canReply) return;
    const token = ui.guard(this);
    try {
      const file = await materials.chooseFile(wx, 'insurance');
      if (!ui.held(this, token)) return;
      if (file.size > 4 * 1024 * 1024) throw new Error('附件不能超过4MiB');
      this._file = file;
      this.setData({ chosenFile: file.name });
    } catch (error) {
      if (ui.held(this, token) && !error.cancelled) this.setData({ error: ui.message(error) });
    }
  },
  async upload() {
    const row = this.data.selected,
      file = this._file;
    if (!row || !file || this.data.busy) return;
    const token = ui.guard(this);
    try {
      const body = await gov.attachmentBody(
        wx,
        file,
        row.version,
        this.data.internal ? 'INTERNAL' : 'REQUESTER',
      );
      if (!ui.held(this, token) || this.data.selected !== row) return;
      const value = await gov.perform(
        this,
        'CASE',
        (id) => '/v1/me/governance/cases/' + row.id + '/attachments/' + id,
        body,
        {
          method: 'PUT',
          pathCommand: true,
          title: '上传私有附件',
          content: '支持JPEG、PNG、PDF，单份4MiB；只按工单当前权限查看。',
        },
      );
      if (value && this._visible) {
        this._file = null;
        this.setData({ chosenFile: '' });
        await this.selectId(row.id);
      }
    } catch (error) {
      if (ui.held(this, token)) this.setData({ error: ui.message(error) });
    }
  },
  preview(e) {
    const row = this.data.selected,
      file = row?.attachments?.find((f) => f.id === e.currentTarget.dataset.id);
    if (file) return gov.previewAttachment(this, row.id, file);
  },
  async recover(e) {
    try {
      const value = await gov.recover(this, 'CASE', e?.currentTarget?.dataset?.cancel === 'true');
      if (value && this._visible) {
        if (value.id) await this.selectId(value.id);
        else await this.load();
      }
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  appeal() {
    const row = this.data.selected;
    if (!row || !row.capabilities?.canReopen) return;
    this._query.parentCaseId = row.id;
    this._query.orgId = row.orgId;
    this._query.caseId = null;
    this.setData({ selected: null, kindIndex: 2, title: '处理结果申诉', body: '' });
  },
});
