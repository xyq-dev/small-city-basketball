const api = require('../../utils/api');
const ui = require('../../utils/ui');
const model = require('../../utils/seasons');
const basePath = '/pages/season-grants/index';

// Private, account-bound state; cleared on every identity change, sign-out or unload.
const privateDefaults = () => ({
  grants: [],
  truncated: false,
  disclosure: null,
  acknowledged: '',
  stats: null,
  statsError: '',
  event: null,
  season: null,
  frozen: false,
  sources: [],
  teamLabels: [],
  memberLabels: [],
  teamIndex: -1,
  memberIndex: -1,
  reason: '',
  nominationPending: false,
  withdrawId: '',
  withdrawReason: '',
  message: '',
});

/**
 * Two entries on one page: with ?orgId&eventId the current organizer nominates and withdraws;
 * without them the signed-in player reads the consent screen, answers and sees only own data.
 */
Page({
  data: {
    mode: 'player',
    orgId: '',
    eventId: '',
    invalid: false,
    loginRequired: false,
    loading: false,
    busy: false,
    error: '',
    ...privateDefaults(),
  },
  onLoad(query) {
    if (query && (query.orgId || query.eventId)) {
      try {
        this.setData({
          mode: 'organizer',
          orgId: model.uuid(query.orgId || ''),
          eventId: model.uuid(query.eventId || ''),
        });
      } catch {
        this.setData({ invalid: true, error: '页面参数无效，请从赛季页的赛事入口重新进入。' });
      }
    }
  },
  onShow() {
    if (!this.data.invalid) this.load();
  },
  onUnload() {
    this._pendingNomination = null;
    ui.close(this);
  },
  onSessionReset() {
    this._pendingNomination = null;
    if (this._closed || !this.setData) return;
    this.setData({
      ...privateDefaults(),
      loginRequired: true,
      loading: false,
      busy: false,
      error: '登录身份已变化，请重新登录并读取当前资料。',
    });
  },
  returnPath() {
    return (
      basePath +
      (this.data.mode === 'organizer'
        ? model.seasonsPath({ orgId: this.data.orgId, eventId: this.data.eventId })
        : '')
    );
  },
  login() {
    ui.login(this.returnPath());
  },
  eventPath() {
    return '/v1/orgs/' + this.data.orgId + '/events/' + this.data.eventId + '/season-data-grants';
  },
  async load() {
    if (this.data.busy || this.data.invalid) return;
    const token = ui.begin(this);
    this.setData({ loading: true, error: '' });
    const session = await ui.session(this, this.returnPath());
    if (!session || !ui.live(this, token)) return;
    try {
      if (this.data.mode === 'organizer') {
        const result = (await api.getClient().request(this.eventPath())).data;
        if (!ui.live(this, token)) return;
        const sources = result.sources;
        this.setData({
          event: result.event,
          season: result.season,
          frozen: result.frozen,
          sources,
          disclosure: result.disclosure,
          teamLabels: sources.map((t) => t.teamName),
          grants: result.grants.map(model.grantView),
        });
        this.refreshMembers();
      } else {
        const result = (await api.getClient().request('/v1/me/season-data-grants')).data;
        if (!ui.live(this, token)) return;
        const grants = result.grants.map(model.grantView);
        this.setData({
          grants,
          truncated: result.truncated,
          disclosure: result.disclosure,
          acknowledged: grants.some((g) => g.id === this.data.acknowledged)
            ? this.data.acknowledged
            : '',
        });
        if (this._statsKey) await this.loadStats(this._statsKey, token);
      }
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          error:
            error && error.status === 403
              ? '只有机构负责人/管理员或这一届赛事的赛事负责人可以提名。'
              : ui.message(error),
        });
    } finally {
      if (ui.live(this, token)) this.setData({ loading: false });
    }
  },
  refreshMembers() {
    const team = this.data.sources[this.data.teamIndex];
    this.setData({
      memberLabels: team
        ? team.members.map(
            (m) =>
              m.jerseyNo +
              '号 ' +
              m.name +
              (m.binding ? ' · 绑定账号：' + m.binding.displayName : ' · 未绑定（不能提名）'),
          )
        : [],
    });
  },
  pickTeam(event) {
    if (this.data.busy || this.data.nominationPending) return;
    this.setData({ teamIndex: Number(event.detail.value), memberIndex: -1 });
    this.refreshMembers();
  },
  pickMember(event) {
    if (this.data.busy || this.data.nominationPending) return;
    this.setData({ memberIndex: Number(event.detail.value) });
  },
  input(event) {
    const field = event.currentTarget.dataset.field;
    if (field === 'reason' && this.data.nominationPending) return;
    if (!['reason', 'withdrawReason'].includes(field)) return;
    this.setData({ [field]: String(event.detail.value || '') });
  },
  selection() {
    const team = this.data.sources[this.data.teamIndex];
    const member = team && team.members[this.data.memberIndex];
    return {
      teamId: team ? team.teamId : '',
      memberId: member ? member.memberId : '',
      reason: this.data.reason,
    };
  },
  /** A write confirmed for this session and page; reads are cancelled while it runs. */
  async write(title, content, send) {
    if (this.data.busy || this.data.loading) return null;
    const op = await ui.confirmOp(this, title, content);
    if (!op) return null;
    const token = ui.hold(this);
    this.setData({ busy: true, error: '', message: '' });
    try {
      if (!op.valid()) return null;
      const result = await send();
      if (!ui.held(this, token)) return null;
      return result;
    } catch (error) {
      if (!ui.held(this, token)) return null;
      throw error;
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async nominate() {
    if (this.data.busy || this.data.loading) return;
    const selection = this.selection();
    let input;
    try {
      const pending = this._pendingNomination;
      const same =
        pending &&
        pending.selection.teamId === selection.teamId &&
        pending.selection.memberId === selection.memberId &&
        pending.selection.reason === selection.reason;
      input = model.nominateInput(
        this.data.sources,
        selection,
        same ? pending.id : await ui.uuid(),
      );
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    let result;
    try {
      result = await this.write(
        '提名私有赛季授权',
        '提名不会立即生效：须由被提名本人在“我的私有赛季授权”中明确同意后才会计入本机构私有赛季统计。',
        () => {
          this._pendingNomination = { id: input.clientRequestId, selection };
          return api.getClient().request(this.eventPath(), 'POST', input);
        },
      );
    } catch (error) {
      const unknown = !error || !error.status;
      if (!unknown) this._pendingNomination = null;
      this.setData({
        nominationPending: unknown && !!this._pendingNomination,
        error: unknown
          ? '提名结果未知。请点“核对并重试”，将沿用原请求编号，不会重复提名。'
          : ui.message(error),
      });
      return;
    }
    if (!result) return;
    this._pendingNomination = null;
    this.setData({
      nominationPending: false,
      reason: '',
      memberIndex: -1,
      message: '已提名，等待本人同意。',
    });
    this.load();
  },
  askWithdraw(event) {
    if (this.data.busy) return;
    this.setData({ withdrawId: event.currentTarget.dataset.id, withdrawReason: '' });
  },
  cancelWithdraw() {
    if (this.data.busy) return;
    this.setData({ withdrawId: '', withdrawReason: '' });
  },
  async withdraw() {
    const grant = this.data.grants.find((g) => g.id === this.data.withdrawId);
    let body;
    try {
      body = model.withdrawInput(grant, this.data.withdrawReason);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    await this.mutate(
      '撤回授权',
      '撤回后该来源立即停止计入；不能恢复，只能重新提名并由本人再次同意。',
      () =>
        api
          .getClient()
          .request(
            '/v1/orgs/' + this.data.orgId + '/season-data-grants/' + grant.id + '/withdraw',
            'POST',
            body,
          ),
      { withdrawId: '', withdrawReason: '' },
    );
  },
  acknowledge(event) {
    if (this.data.busy) return;
    const id = event.currentTarget.dataset.id;
    const values = (event.detail && event.detail.value) || [];
    this.setData({ acknowledged: values.length ? id : '' });
  },
  async answer(event) {
    const { id, type } = event.currentTarget.dataset;
    const grant = this.data.grants.find((g) => g.id === id);
    let body;
    try {
      if (type === 'CONSENT' && this.data.acknowledged !== id)
        throw new Error('请先勾选已阅读范围、读者、统计口径与撤销方式');
      body = model.grantCommandInput(grant, type);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const texts = {
      CONSENT: [
        '同意私有赛季授权',
        '同意后，' +
          grant.orgName +
          '的负责人/管理员可在本机构私有赛季中看到您在“' +
          grant.eventName +
          '”的逐人确认得分与犯规。可随时撤销。',
      ],
      DECLINE: ['拒绝提名', '拒绝后该提名结束；如需授权须由主办方重新提名。'],
      REVOKE: ['撤销授权', '撤销后下一次读取即不再计入，不能恢复；需主办方重新提名并再次同意。'],
    };
    await this.mutate(
      texts[type][0],
      texts[type][1],
      () =>
        api
          .getClient()
          .request('/v1/me/season-data-grants/' + grant.id + '/commands', 'POST', body),
      { acknowledged: '' },
    );
  },
  async mutate(title, content, send, reset) {
    let result;
    try {
      result = await this.write(title, content, send);
    } catch (error) {
      const conflict = error && ['VERSION_CONFLICT', 'SEASON_GRANT_STATE'].includes(error.code);
      const text = conflict ? '授权状态已更新，已重新读取，请核对后再操作。' : ui.message(error);
      // Re-read the current state first, then explain why nothing was changed.
      if (conflict || !error || !error.status) await this.load();
      if (!this._closed && !this.data.loginRequired) this.setData({ error: text });
      return;
    }
    if (!result) return;
    this.setData({ ...reset, message: '已处理。' });
    this.load();
  },
  async showStats(event) {
    const { org, season } = event.currentTarget.dataset;
    if (this.data.busy) return;
    try {
      this._statsKey = { orgId: model.uuid(org), seasonId: model.uuid(season) };
    } catch (error) {
      this.setData({ statsError: ui.message(error) });
      return;
    }
    const token = ui.begin(this);
    this.setData({ loading: true, statsError: '' });
    await this.loadStats(this._statsKey, token);
    if (ui.live(this, token)) this.setData({ loading: false });
  },
  async loadStats(key, token) {
    try {
      const result = (
        await api
          .getClient()
          .request('/v1/me/season-statistics?orgId=' + key.orgId + '&seasonId=' + key.seasonId)
      ).data;
      if (!ui.live(this, token)) return;
      const summary = result.summary;
      this.setData({
        statsError: '',
        stats: {
          seasonName: result.season.name,
          orgName: result.season.orgName,
          statusText: model.seasonStatus[result.season.status] || result.season.status,
          row: summary.rows.length ? model.playerRow(summary.rows[0]) : null,
          coverage: model.coverageRows(summary),
          asOf: ui.localTime(summary.asOf, true),
          sourceHash: summary.sourceHash,
        },
      });
    } catch (error) {
      if (ui.live(this, token)) this.setData({ stats: null, statsError: ui.message(error) });
    }
  },
});
