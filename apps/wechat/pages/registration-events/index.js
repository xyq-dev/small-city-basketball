const api = require('../../utils/api');
const ui = require('../../utils/ui');
const registration = require('../../utils/registration');
function view(rows) {
  return rows.map((r) => ({
    ...r,
    id: r.event.id,
    statusLabel: registration.stateLabel(r.event.status),
    entryStatus: r.entry ? registration.stateLabel(r.entry.status) : '',
  }));
}
Page({
  data: {
    team: null,
    events: [],
    nextCursor: null,
    loading: false,
    busy: false,
    error: '',
    message: '',
    loginRequired: false,
    chargeDraft: null,
    chargeAccepted: false,
  },
  onLoad(query) {
    this._alive = true;
    try {
      this._org = registration.id(query.orgId);
      this._team = registration.id(query.teamId);
    } catch (error) {
      this._routeError = ui.message(error);
      this.setData({ error: this._routeError });
    }
  },
  onShow() {
    this._alive = true;
    if (this._revision !== undefined && api.getClient().sessionRevision() !== this._revision)
      this.setData({ busy: false });
    this.load();
  },
  onHide() {
    this._alive = false;
    ui.close(this);
    this.setData({ chargeDraft: null, chargeAccepted: false, busy: false });
  },
  onUnload() {
    this.onHide();
  },
  onSessionReset() {
    this._viewer = null;
    this.setData({
      team: null,
      events: [],
      nextCursor: null,
      chargeDraft: null,
      chargeAccepted: false,
      busy: false,
      loading: false,
      loginRequired: true,
    });
  },
  path() {
    return '/pages/registration-events/index?orgId=' + this._org + '&teamId=' + this._team;
  },
  login() {
    ui.login(this.path());
  },
  async load() {
    if (this._routeError || this.data.busy) return;
    this.setData({
      team: null,
      events: [],
      nextCursor: null,
      loading: true,
      error: '',
      loginRequired: false,
      chargeDraft: null,
      chargeAccepted: false,
    });
    ui.begin(this);
    const session = await ui.session(this, this.path());
    if (!this._alive) return;
    if (!session) {
      this.setData({ loading: false });
      return;
    }
    this._viewer = session.user.id;
    this._revision = api.getClient().sessionRevision();
    const token = ui.begin(this),
      repo = registration.createRepository(this._org);
    try {
      const team = await repo.team(this._team),
        result = await repo.events(this._team);
      if (ui.live(this, token))
        this.setData({
          team,
          events: view(result.items),
          nextCursor: result.nextCursor,
          loading: false,
        });
    } catch (error) {
      if (ui.live(this, token))
        this.setData({ team: null, events: [], loading: false, error: ui.message(error) });
    }
  },
  async more() {
    if (!this.data.nextCursor || this.data.loading || this.data.busy) return;
    const session = await ui.session(this, this.path());
    if (!session || !this._alive || session.user.id !== this._viewer) {
      if (this._alive) this.load();
      return;
    }
    const token = ui.begin(this),
      cursor = this.data.nextCursor;
    this.setData({ loading: true, error: '' });
    try {
      const result = await registration.createRepository(this._org).events(this._team, cursor);
      if (ui.live(this, token))
        this.setData({
          events: registration.mergePage(this.data.events, view(result.items), 'eventId'),
          nextCursor: result.nextCursor,
          loading: false,
        });
    } catch (error) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  async enter(e) {
    if (this.data.busy || this.data.chargeDraft) return;
    const eventId = e.currentTarget.dataset.id,
      item = this.data.events.find((r) => r.event.id === eventId);
    if (!item) return;
    if (item.entry) {
      ui.open('entry', { orgId: this._org, entryId: item.entry.id });
      return;
    }
    if (!item.capabilities.canCreateEntry) return;
    const token = ui.hold(this),
      viewer = this._viewer,
      teamId = this._team;
    this.setData({ busy: true, error: '', message: '', chargeDraft: null, chargeAccepted: false });
    try {
      const session = await ui.session(this, this.path());
      if (!ui.held(this, token) || !session || session.user.id !== viewer || this._team !== teamId)
        return;
      const previews = await Promise.all(
        ['ENTRY_FEE', 'ENTRY_DEPOSIT'].map(async (kind) => ({
          kind,
          value: (
            await api.getClient().request('/v1/trades/preview', 'POST', { kind, sourceId: eventId })
          ).data,
        })),
      );
      if (!ui.held(this, token)) return;
      const items = previews
        .filter((x) => {
          if (!x.value || typeof x.value.enabled !== 'boolean')
            throw Error('收费信息不完整，请重新读取');
          return x.value.enabled;
        })
        .map((x) => {
          const v = x.value;
          registration.id(v.termsId);
          if (
            !Number.isSafeInteger(v.totalFen) ||
            v.totalFen < 0 ||
            v.currency !== 'CNY' ||
            ['merchantName', 'title', 'terms'].some(
              (k) => typeof v[k] !== 'string' || !v[k].trim() || v[k].length > 50000,
            )
          )
            throw Error('收费信息不完整，请重新读取');
          return {
            ...v,
            kind: x.kind,
            kindLabel: x.kind === 'ENTRY_FEE' ? '报名费' : '保证金',
            amountLabel: '¥' + (v.totalFen / 100).toFixed(2),
          };
        });
      if (items.length) {
        this.setData({
          chargeDraft: { eventId, eventName: item.event.name, teamId, viewer, items },
          chargeAccepted: false,
        });
        return;
      }
      const op = await ui.confirmOp(
        this,
        '创建本队报名草稿',
        '仅为' + this.data.team.name + '创建本届报名草稿，之后需保存名单并明确提交审核。',
      );
      if (!op || !op.valid() || !ui.held(this, token)) return;
      await this.createOriginal(eventId, teamId, [], token);
    } catch (error) {
      if (ui.held(this, token)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  chargeAgree(e) {
    if (this.data.busy || !this.data.chargeDraft) return;
    this.setData({ chargeAccepted: e.detail.value.includes('yes') });
  },
  cancelCharge() {
    if (!this.data.busy) this.setData({ chargeDraft: null, chargeAccepted: false });
  },
  async confirmCharge() {
    const draft = this.data.chargeDraft;
    if (
      this.data.busy ||
      !draft ||
      !this.data.chargeAccepted ||
      draft.viewer !== this._viewer ||
      draft.teamId !== this._team
    )
      return;
    const token = ui.hold(this);
    this.setData({ busy: true, error: '', message: '' });
    try {
      const session = await ui.session(this, this.path());
      if (
        !ui.held(this, token) ||
        !session ||
        session.user.id !== draft.viewer ||
        this.data.chargeDraft !== draft ||
        !this.data.chargeAccepted
      )
        return;
      await this.createOriginal(draft.eventId, draft.teamId, draft.items, token);
    } catch (error) {
      if (ui.held(this, token)) this.setData({ error: ui.message(error), chargeAccepted: false });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async createOriginal(eventId, teamId, items, token) {
    if (!ui.held(this, token)) return;
    try {
      let entry;
      if (items.length) {
        const acceptedTermsIds = Object.fromEntries(items.map((x) => [x.kind, x.termsId]));
        entry = (
          await api
            .getClient()
            .request('/v1/orgs/' + this._org + '/events/' + eventId + '/entries', 'POST', {
              teamId,
              acceptedTermsIds,
              chargeConsent: true,
            })
        ).data;
        if (
          !registration.validEntry(entry) ||
          entry.orgId !== this._org ||
          entry.eventId !== eventId ||
          entry.teamId !== teamId
        )
          throw Error('报名结果不完整，请刷新本队报名列表核对');
      } else entry = await registration.createRepository(this._org).createEntry(eventId, teamId);
      if (ui.held(this, token)) {
        this.setData({ chargeDraft: null, chargeAccepted: false });
        ui.open('entry', { orgId: this._org, entryId: entry.id });
      }
    } catch (error) {
      if (ui.held(this, token))
        this.setData({
          chargeDraft: null,
          chargeAccepted: false,
          message:
            '请先刷新本队报名列表核对原结果。已存在的本队报名不会再次创建；收费条款变化需重新查看并明确同意。',
        });
      throw error;
    }
  },
});
