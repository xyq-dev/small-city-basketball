const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');

// Registration staff view. Independence (reviewer is not the leader or last submitter),
// stage guards and CAS are all enforced by the API; capabilities only decide what to show.
const statusOrder = [
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'DRAFT',
  'REJECTED',
  'WITHDRAWN',
];
const statusLabels = {
  DRAFT: '草稿未提交',
  SUBMITTED: '已提交待审核',
  APPROVED: '已通过',
  CHANGES_REQUESTED: '已退回补齐',
  REJECTED: '已拒绝',
  WITHDRAWN: '已撤回',
};
const commandLabels = {
  SUBMIT: '提交',
  WITHDRAW: '撤回',
  APPROVE: '通过',
  REQUEST_CHANGES: '退回补齐',
  REJECT: '拒绝',
};
const stageCommands = [
  {
    type: 'OPEN_REGISTRATION',
    cap: 'canOpen',
    label: '开放报名',
    note: '球队领队可以创建本届报名并提交名单。',
  },
  {
    type: 'CLOSE_REGISTRATION',
    cap: 'canClose',
    label: '截止报名',
    note: '截止后仅已退回的报名可以补交。',
  },
  {
    type: 'FREEZE_REGISTRATION',
    cap: 'canFreeze',
    label: '冻结名单',
    note: '需至少2支已通过且没有待审核/待补齐；冻结后本届名单不可再改，用于排赛。',
  },
];
const MAX_PAGES = 10;
const privateDefaults = {
  event: null,
  counts: [],
  freeze: null,
  rules: '',
  stages: [],
  entries: [],
  detail: null,
  reason: '',
  unavailable: false,
};

Page({
  data: { loading: false, busy: false, error: '', notice: '', ...privateDefaults },
  onLoad(query) {
    this._alive = true;
    try {
      this.orgId = api.uuid(query.orgId);
      this.eventId = api.uuid(query.eventId);
    } catch {
      this.setData({ unavailable: true, error: '报名入口无效，请从赛事详情重新进入。' });
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
      error: '登录身份已变化，已清除上一身份的报名资料。',
    });
  },
  base() {
    return '/v1/orgs/' + this.orgId;
  },
  async load() {
    if (!this.orgId || this.data.loading || this.data.busy) return;
    const client = api.getClient();
    const load = (this._load = (this._load || 0) + 1);
    const current = () => this._alive && load === this._load;
    if (!client.hasSession()) {
      this.setData({ ...privateDefaults, unavailable: true, error: '请先登录后处理报名。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const session = await events.session(client);
      if (!current()) return;
      if (this._viewer && this._viewer !== session.user.id) this.setData({ ...privateDefaults });
      this._viewer = session.user.id;
    } catch (error) {
      if (current()) this.setData({ ...privateDefaults, loading: false, error: ui.message(error) });
      return;
    }
    const token = ui.begin(this);
    const live = () => ui.live(this, token) && current();
    try {
      const reg = (await client.request(this.base() + '/events/' + this.eventId + '/registration'))
        .data;
      let cursor = null,
        rows = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await client.request(
          this.base() +
            '/events/' +
            this.eventId +
            '/entries?limit=100' +
            (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
        );
        if (!Array.isArray(response.data)) throw { message: '报名资料格式无效' };
        rows = rows.concat(response.data);
        cursor = response.meta.nextCursor;
        if (!cursor) break;
      }
      if (!live()) return;
      this._eventVersion = reg.event.version;
      rows.sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
      this.setData({
        loading: false,
        unavailable: false,
        event: {
          name: reg.event.name,
          status: reg.event.status,
          statusLabel: api.eventStatus(reg.event.status),
        },
        rules: reg.rules
          ? '每队 ' +
            reg.rules.minPlayers +
            '–' +
            reg.rules.maxPlayers +
            ' 人' +
            (reg.rules.requireIdentity ? ' · 需身份资料' : '') +
            (reg.rules.requireInsurance ? ' · 需保险资料' : '')
          : '报名规则尚未设置',
        counts: statusOrder
          .filter((s) => reg.counts[s])
          .map((s) => ({ key: s, label: statusLabels[s], count: reg.counts[s] })),
        freeze: reg.freeze
          ? {
              teams: reg.freeze.entries.length,
              time: ui.localTime(reg.freeze.createdAt),
            }
          : null,
        stages: stageCommands
          .filter((c) => reg.capabilities[c.cap])
          .map((c) => ({ type: c.type, label: c.label, note: c.note })),
        entries: rows.map((e) => ({
          key: e.id,
          id: e.id,
          teamName: e.teamName,
          status: e.status,
          statusLabel: statusLabels[e.status] || e.status,
          reason: e.latestReviewReason || '',
          waiting: e.status === 'SUBMITTED',
        })),
      });
      if (this.data.detail)
        this.openEntry({ currentTarget: { dataset: { id: this.data.detail.id } } });
    } catch (error) {
      if (!live()) return;
      const hidden = error.status === 401 || error.status === 403 || error.status === 404;
      this.setData({
        ...(hidden ? privateDefaults : {}),
        loading: false,
        unavailable: hidden,
        error: hidden ? '当前身份不能处理本届报名。' : ui.message(error),
      });
    }
  },
  async openEntry(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.busy) return;
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', reason: '' });
    try {
      const entry = (await api.getClient().request(this.base() + '/entries/' + api.uuid(id))).data;
      if (!ui.held(this, token)) return;
      const c = entry.capabilities || {};
      this.setData({
        busy: false,
        detail: {
          id: entry.id,
          version: entry.version,
          teamName: entry.teamName,
          statusLabel: statusLabels[entry.status] || entry.status,
          players: entry.players.map((p) => ({
            key: p.memberId,
            text: p.jerseyNo + '号 · ' + p.name,
          })),
          history: entry.history
            .slice()
            .reverse()
            .map((h) => ({
              key: h.id,
              text: (commandLabels[h.type] || h.type) + (h.reason ? '：' + h.reason : ''),
              time: ui.localTime(h.createdAt),
            })),
          approve: !!c.canApprove,
          changes: !!c.canRequestChanges,
          reject: !!c.canReject,
          reviewBlocked: entry.status === 'SUBMITTED' && !c.canReview,
        },
      });
    } catch (error) {
      if (ui.held(this, token)) this.setData({ busy: false, error: ui.message(error) });
    }
  },
  closeEntry() {
    this.setData({ detail: null, reason: '' });
  },
  reasonInput(e) {
    this.setData({ reason: String(e.detail.value || '').slice(0, 500) });
  },
  async review(e) {
    const type = e.currentTarget.dataset.type;
    const detail = this.data.detail;
    if (!detail || this.data.busy || !commandLabels[type]) return;
    const reason = this.data.reason.trim();
    if (type !== 'APPROVE' && !reason) {
      this.setData({ error: '退回或拒绝须填写原因，领队会看到该说明。' });
      return;
    }
    const note =
      type === 'APPROVE'
        ? '通过后名单锁定；如需修改须先退回。'
        : type === 'REJECT'
          ? '拒绝为终态，该队本届报名不能再提交。'
          : '领队补齐后可重新提交。';
    if (!(await ui.confirm(commandLabels[type] + '：' + detail.teamName, note))) return;
    if (this.data.busy || !this.data.detail || this.data.detail.id !== detail.id) return;
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      await api.getClient().request(this.base() + '/entries/' + detail.id + '/commands', 'POST', {
        type,
        expectedVersion: detail.version,
        ...(type === 'APPROVE' ? {} : { reason }),
      });
      if (!ui.held(this, token)) return;
      this.setData({ busy: false, notice: detail.teamName + ' 已' + commandLabels[type] + '。' });
      await this.load();
    } catch (error) {
      if (!ui.held(this, token)) return;
      this.setData({
        busy: false,
        error:
          error && error.code === 'VERSION_CONFLICT'
            ? '该报名已被更新，已重新读取，请核对后再审核。'
            : ui.message(error),
      });
      if (error && error.code === 'VERSION_CONFLICT') await this.load();
    }
  },
  async stage(e) {
    const type = e.currentTarget.dataset.type;
    const command = stageCommands.find((c) => c.type === type);
    if (!command || this.data.busy) return;
    if (!(await ui.confirm(command.label, command.note)) || this.data.busy) return;
    const token = ui.hold(this);
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      await api
        .getClient()
        .request(this.base() + '/events/' + this.eventId + '/registration-commands', 'POST', {
          type,
          expectedVersion: this._eventVersion,
        });
      if (!ui.held(this, token)) return;
      this.setData({ busy: false, notice: command.label + '已完成。' });
      await this.load();
    } catch (error) {
      if (!ui.held(this, token)) return;
      this.setData({
        busy: false,
        error:
          error && error.code === 'VERSION_CONFLICT'
            ? '赛事已被更新，已重新读取，请核对后再操作。'
            : ui.message(error),
      });
      if (error && error.code === 'VERSION_CONFLICT') await this.load();
    }
  },
});
