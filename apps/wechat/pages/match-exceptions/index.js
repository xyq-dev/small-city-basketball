const api = require('../../utils/api');
const ui = require('../../utils/ui');
const exceptions = require('../../utils/match-exceptions');
const empty = {
  event: null,
  match: null,
  rules: null,
  active: null,
  requests: [],
  pending: null,
  canEdit: false,
  canPropose: false,
  canRevoke: false,
  canReview: false,
};
Page({
  data: {
    ...empty,
    loading: false,
    busy: false,
    error: '',
    notice: '',
    reason: '',
    winPoints: '2',
    lossPoints: '0',
    kind: 'FORFEIT',
    side: 'HOME',
    uncertain: false,
    rulesOnly: false,
  },
  onLoad(q = {}) {
    this._alive = true;
    try {
      this.org = api.uuid(q.orgId);
      this.match = q.matchId ? api.uuid(q.matchId) : null;
      this.event = q.eventId ? api.uuid(q.eventId) : null;
      if (!this.match && !this.event) throw new Error('无效入口');
      this.setData({ rulesOnly: !this.match });
      this.load();
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  onUnload() {
    this._alive = false;
    this._raw = null;
    this._pendingWrite = null;
    ui.close(this);
  },
  onSessionReset() {
    this._raw = null;
    this._pendingWrite = null;
    this.setData({
      ...empty,
      loading: false,
      busy: false,
      uncertain: false,
      error: '登录身份已变化，请重新进入。',
    });
  },
  path() {
    return (
      '/v1/orgs/' +
      this.org +
      (this.match
        ? '/matches/' + this.match + '/exceptions'
        : '/events/' + this.event + '/exception-rules')
    );
  },
  async load() {
    if (!this._alive || this.data.loading || this.data.busy) return;
    const client = api.getClient();
    if (!client.hasSession()) {
      this.setData({ ...empty, error: '请先登录后管理比赛异常。' });
      return;
    }
    const token = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      const v = exceptions.valid((await client.request(this.path())).data, !this.match);
      if (!ui.live(this, token)) return;
      this._raw = v;
      const requests = (v.requests || []).map(exceptions.requestView);
      this.setData({
        ...empty,
        event: v.event,
        match: v.match || null,
        rules: v.rules,
        active: v.active ? exceptions.requestView(v.active) : null,
        requests,
        pending: requests.find((r) => r.status === 'PENDING') || null,
        canEdit: v.canEdit === true,
        ...(v.capabilities || {}),
        winPoints: String(v.rules?.forfeitWinPoints ?? 2),
        lossPoints: String(v.rules?.forfeitLossPoints ?? 0),
      });
    } catch (e) {
      if (ui.live(this, token)) {
        this._raw = null;
        this.setData({ ...empty, error: ui.message(e) });
      }
    } finally {
      if (ui.live(this, token)) this.setData({ loading: false });
    }
  },
  input(e) {
    const key = e.currentTarget.dataset.field;
    if (['reason', 'winPoints', 'lossPoints'].includes(key))
      this.setData({ [key]: e.detail.value });
  },
  choose(e) {
    if (this.data.busy || this.data.uncertain) return;
    const { field, value } = e.currentTarget.dataset;
    if (
      (field === 'kind' && ['FORFEIT', 'CANCELLED'].includes(value)) ||
      (field === 'side' && ['HOME', 'AWAY'].includes(value))
    )
      this.setData({ [field]: value });
  },
  async saveRules() {
    if (!this._raw?.canEdit || this.data.uncertain) return;
    const win = Number(this.data.winPoints),
      loss = Number(this.data.lossPoints);
    if (
      !Number.isInteger(win) ||
      win < 0 ||
      win > 1000 ||
      !Number.isInteger(loss) ||
      loss < 0 ||
      loss > 1000
    ) {
      this.setData({ error: '请显式填写0至1000的整数积分。' });
      return;
    }
    await this.submit(
      this.path(),
      'PUT',
      {
        expectedEventVersion: this._raw.event.version,
        expectedVersion: this._raw.rules?.version || 0,
        forfeitWinPoints: win,
        forfeitLossPoints: loss,
        cancellationPolicy: 'EXCLUDE_FROM_TABLE',
      },
      '锁定异常规则',
      '规则只能在赛事草稿阶段修改；弃权只计积分，取消排除出积分表，均不产生技术统计。',
    );
  },
  async propose(e) {
    if (!this._raw || this.data.uncertain) return;
    const revoke = e.currentTarget.dataset.operation === 'REVOKE';
    if (revoke ? !this._raw.capabilities.canRevoke : !this._raw.capabilities.canPropose) return;
    const a = this._raw.active,
      kind = revoke ? a.kind : this.data.kind;
    await this.submit(
      this.path() + '/proposals',
      'POST',
      {
        expectedEventVersion: this._raw.event.version,
        expectedMatchVersion: this._raw.match.version,
        operation: revoke ? 'REVOKE' : 'DECLARE',
        kind,
        forfeitingSide: kind === 'FORFEIT' ? (revoke ? a.forfeitingSide : this.data.side) : null,
        ...(revoke ? { targetAdjudicationId: a.id } : {}),
        reason: this.data.reason.trim(),
      },
      revoke ? '提议撤回裁定' : '提议比赛裁定',
      '需要另一名独立工作人员复核；已开赛或已被下一轮消费的结果不可直接裁定或撤回。',
    );
  },
  async review(e) {
    const p = this._raw?.requests.find((r) => r.status === 'PENDING');
    if (!p || !this._raw.capabilities.canReview || this.data.uncertain) return;
    const type = e.currentTarget.dataset.type;
    if (!['APPROVE', 'REJECT'].includes(type)) return;
    await this.submit(
      this.path() + '/' + p.id + '/review',
      'POST',
      {
        expectedEventVersion: this._raw.event.version,
        expectedMatchVersion: this._raw.match.version,
        expectedRequestVersion: p.version,
        type,
        reason: this.data.reason.trim(),
      },
      type === 'APPROVE' ? '批准裁定' : '驳回提案',
      type === 'APPROVE'
        ? '批准后立即参与排名和晋级，并禁止本场继续记分、改期；撤回也须独立复核。'
        : '将保留驳回记录；未生效的提案不会改变比赛结果。',
    );
  },
  async submit(path, method, body, title, content) {
    if (this.data.busy || this.data.loading) return;
    if (body.reason !== undefined && (body.reason.length < 4 || body.reason.length > 500)) {
      this.setData({ error: '请填写4至500字原因。' });
      return;
    }
    const op = await ui.confirmOp(this, title, content);
    if (!op) return;
    try {
      body.clientRequestId = await ui.uuid();
      if (!op.valid()) return;
      this._pendingWrite = { path, method, body };
      await this.send(op);
    } catch (e) {
      if (op.valid()) this.setData({ error: ui.message(e) });
    }
  },
  async send(op) {
    if (!this._pendingWrite || this.data.busy || !op.valid()) return;
    const token = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      const p = this._pendingWrite;
      await api.getClient().request(p.path, p.method, p.body);
      if (!ui.held(this, token)) return;
      this._pendingWrite = null;
      this.setData({
        busy: false,
        uncertain: false,
        reason: '',
        notice: '操作已记录，请以刷新后的审核状态为准。',
      });
      await this.load();
    } catch (e) {
      if (!ui.held(this, token)) return;
      const certain = e && e.status && e.status < 500;
      this.setData({
        busy: false,
        uncertain: !certain,
        error: certain ? ui.message(e) : '网络结果未确认。可重试原操作编号；勿重新提交新的裁定。',
      });
      if (certain) {
        this._pendingWrite = null;
        await this.load();
      }
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async retry() {
    if (!this._pendingWrite || !this.data.uncertain) return;
    const op = await ui.confirmOp(
      this,
      '重试原操作',
      '将使用相同操作编号和内容核对原操作，不创建另一份裁定。',
    );
    if (op) await this.send(op);
  },
});
