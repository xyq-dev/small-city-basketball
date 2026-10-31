const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const reset = {
  profiles: [],
  pendingSources: [],
  teams: [],
  events: [],
  options: [],
  eventIndex: 0,
  optionIndex: 0,
  teamIndex: 0,
  displayName: '',
  kind: 'PLAYER',
  reason: '',
  publicConsent: false,
  publisherConsent: false,
  disclosureNotice: '',
  optionsTruncated: false,
  pending: null,
  profileEdit: null,
};
Page({
  data: { ...reset, loading: false, busy: false, error: '', notice: '', loginRequired: false },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    this.load();
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  onSessionReset() {
    this._pending = null;
    this._viewer = null;
    this.setData({
      ...reset,
      loading: false,
      busy: false,
      loginRequired: true,
      error: '登录身份已变化，请重新登录。',
    });
  },
  async load() {
    if (this.data.busy) return;
    const token = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      const client = api.getClient();
      if (!client.hasSession()) {
        this.setData({ ...reset, loading: false, loginRequired: true });
        return;
      }
      const session = await events.session(client);
      if (!ui.live(this, token)) return;
      this._viewer = session.user.id;
      const result = (await client.request('/v1/me/public-archives')).data;
      if (!ui.live(this, token)) return;
      this.setData({
        loading: false,
        loginRequired: false,
        profiles: result.profiles,
        pendingSources: result.pendingSources.filter(
          (s) => !result.profiles.some((p) => p.sources.some((source) => source.id === s.id)),
        ),
        teams: result.manageableTeams,
        events: result.manageableEvents,
        disclosureNotice: result.disclosureNotice,
        optionsTruncated: !!result.optionsTruncated,
        displayName: this.data.displayName || session.user.displayName,
      });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(e) });
    }
  },
  input(e) {
    const f = e.currentTarget.dataset.field;
    if (['displayName', 'reason'].includes(f)) this.setData({ [f]: e.detail.value });
  },
  consent(e) {
    const f = e.currentTarget.dataset.field;
    if (['publicConsent', 'publisherConsent'].includes(f)) this.setData({ [f]: !!e.detail.value });
  },
  kind(e) {
    this.setData({ kind: e.currentTarget.dataset.kind });
  },
  selectTeam(e) {
    this.setData({ teamIndex: Number(e.detail.value) });
  },
  async selectEvent(e) {
    const i = Number(
        e.detail && e.detail.value !== undefined ? e.detail.value : e.currentTarget.dataset.index,
      ),
      item = this.data.events[i];
    this.setData({ eventIndex: i, options: [], optionIndex: 0 });
    if (!item || this.data.busy) return;
    const token = ui.begin(this);
    try {
      const data = (
        await api
          .getClient()
          .request(
            '/v1/orgs/' +
              api.uuid(item.orgId) +
              '/events/' +
              api.uuid(item.id) +
              '/public-archive-sources',
          )
      ).data;
      if (!ui.live(this, token)) return;
      const options = data.players.map((p) => ({
        ...p,
        label: '球员 · ' + p.teamName + ' · ' + p.jerseyNo + '号 ' + p.memberName,
      }));
      for (const profile of this.data.profiles.filter(
        (p) => p.kind === 'TEAM' && p.orgId === item.orgId,
      )) {
        const t = data.teams.find((t) => t.teamId === profile.teamId);
        if (t)
          options.push({
            profileId: profile.id,
            teamId: t.teamId,
            memberId: null,
            label: '球队 · ' + t.teamName,
          });
      }
      this.setData({ options, optionIndex: 0 });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ error: ui.message(e) });
    }
  },
  selectOption(e) {
    this.setData({ optionIndex: Number(e.detail.value) });
  },
  async write(path, body, label) {
    if (this.data.busy || this.data.pending) return;
    const token = ui.hold(this);
    this.setData({ busy: true, error: '', notice: '' });
    try {
      body = { ...body, commandId: await ui.uuid() };
      if (!ui.held(this, token)) return;
      this._pending = { path, body, label, actor: this._viewer };
      await this.submit(token);
    } catch (e) {
      if (ui.held(this, token)) this.setData({ busy: false, error: ui.message(e) });
    }
  },
  async submit(token) {
    const pending = this._pending;
    if (!pending || pending.actor !== this._viewer) return;
    try {
      await api.getClient().request(pending.path, 'POST', pending.body);
      if (!ui.held(this, token)) return;
      this._pending = null;
      this.setData({
        busy: false,
        pending: null,
        notice: pending.label + ' 已处理',
        publicConsent: false,
        publisherConsent: false,
        profileEdit: null,
      });
      this.load();
    } catch (e) {
      if (!ui.held(this, token)) return;
      if (e.code === 'NETWORK_ERROR' || !e.status) {
        this.setData({
          busy: false,
          pending: { label: pending.label },
          error: '结果待核对，请按原操作编号重试；不要重复提交新操作。',
        });
      } else {
        this._pending = null;
        this.setData({ busy: false, pending: null, error: ui.message(e) });
      }
    }
  },
  retry() {
    if (this.data.busy || !this._pending) return;
    const token = ui.hold(this);
    this.setData({ busy: true });
    this.submit(token);
  },
  create() {
    const team = this.data.teams[this.data.teamIndex];
    if (this.data.kind === 'TEAM' && !team) return;
    this.write(
      '/v1/me/public-archives',
      {
        kind: this.data.kind,
        displayName: this.data.displayName,
        ...(this.data.kind === 'TEAM' ? { orgId: team.orgId, teamId: team.id } : {}),
      },
      '创建档案',
    );
  },
  editProfile(e) {
    const p = this.data.profiles.find((p) => p.id === e.currentTarget.dataset.id);
    if (p) this.setData({ profileEdit: { id: p.id, version: p.version, name: p.displayName } });
  },
  editName(e) {
    this.setData({ 'profileEdit.name': e.detail.value });
  },
  saveProfile() {
    const p = this.data.profileEdit;
    if (p)
      this.write(
        '/v1/me/public-archives/' + api.uuid(p.id) + '/commands',
        { expectedVersion: p.version, type: 'UPDATE', displayName: p.name },
        '修改公开显示名',
      );
  },
  async profileCommand(e) {
    const p = this.data.profiles.find((p) => p.id === e.currentTarget.dataset.id),
      type = e.currentTarget.dataset.type;
    if (!p) return;
    if (type === 'PUBLISH' && !this.data.publicConsent) {
      this.setData({ error: '请明确勾选独立公开授权。' });
      return;
    }
    const op = await ui.confirmOp(
      this,
      type === 'PUBLISH' ? '发布公开档案' : '撤销公开档案',
      type === 'PUBLISH'
        ? this.data.disclosureNotice
        : '撤销后旧分享链接永久失效，公开榜单即时移除。',
    );
    if (!op || !op.valid()) return;
    this.write(
      '/v1/me/public-archives/' + api.uuid(p.id) + '/commands',
      {
        expectedVersion: p.version,
        type,
        ...(type === 'PUBLISH' ? { publicConsent: true } : { reason: '本人或组织撤销公开授权' }),
      },
      type === 'PUBLISH' ? '发布档案' : '撤销档案',
    );
  },
  nominate() {
    const e = this.data.events[this.data.eventIndex],
      p = this.data.options[this.data.optionIndex];
    if (!e || !p || !this.data.publisherConsent) {
      this.setData({ error: '请选择精确赛事身份，并明确勾选主办公开授权。' });
      return;
    }
    this.write(
      '/v1/public-archive-sources',
      {
        profileId: p.profileId,
        orgId: e.orgId,
        eventId: e.id,
        teamId: p.teamId,
        memberId: p.memberId,
        publisherConsent: true,
        reason: this.data.reason,
      },
      '提名公开来源',
    );
  },
  async sourceCommand(e) {
    const all = this.data.pendingSources.concat(...this.data.profiles.map((p) => p.sources));
    const source = all.find((s) => s.id === e.currentTarget.dataset.id),
      type = e.currentTarget.dataset.type;
    if (!source) return;
    const op = await ui.confirmOp(
      this,
      type === 'CONSENT' ? '本人同意独立公开来源' : '撤销公开来源',
      type === 'CONSENT'
        ? this.data.disclosureNotice +
            ' 本次仅公开' +
            source.eventName +
            '／' +
            source.teamName +
            '／' +
            source.memberName
        : '该来源立即停止进入公共生涯与榜单。',
    );
    if (!op || !op.valid()) return;
    this.write(
      '/v1/public-archive-sources/' + api.uuid(source.id) + '/commands',
      {
        expectedVersion: source.version,
        type,
        reason: type === 'CONSENT' ? '本人明确同意本届公共档案来源' : '本人或主办撤销本届公开来源',
        ...(type === 'CONSENT' ? { playerConsent: true } : {}),
      },
      type === 'CONSENT' ? '同意来源' : '撤销来源',
    );
  },
  openPublic(e) {
    const key = api.publicId(e.currentTarget.dataset.key);
    wx.navigateTo({ url: '/pages/public-archive/index?key=' + key });
  },
  rankings() {
    wx.navigateTo({ url: '/pages/public-archive/index?kind=PLAYER' });
  },
});
