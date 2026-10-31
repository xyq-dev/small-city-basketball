const api = require('../../utils/api');
const ui = require('../../utils/ui');
const gov = require('../../utils/governance');
const regions = require('../../utils/regions');
const PATH = '/pages/city-operations/index';
const actions = ['SUPPLY_REVIEW', 'SUPPLY_SUSPEND', 'CASE_MANAGE', 'SPONSOR_REVIEW'];
const actionNames = ['供给资质审核', '供给质量下架', '明确分派工单处理', '城市赞助审核'];
const initial = () => ({
  items: [],
  nextCursor: null,
  organizations: [],
  people: [],
  regions: [],
  orgIndex: 0,
  userIndex: 0,
  regionIndex: 0,
  actionIndex: 0,
  actionNames,
  date: '',
  time: '23:59',
  reason: '',
  userQuery: '',
  orgQuery: '',
  canManage: false,
  platform: false,
  pending: null,
  busy: false,
  loading: false,
  error: '',
  notice: '',
  loginRequired: false,
  directoryTruncated: null,
});
Page({
  data: initial(),
  onLoad() {
    this._alive = true;
    this._visible = true;
  },
  onShow() {
    this._visible = true;
    this.load();
  },
  onHide() {
    this._visible = false;
    ui.close(this);
    this._viewer = null;
    this._catalog = null;
    this.setData(initial());
  },
  onUnload() {
    this._alive = false;
    this.onHide();
  },
  onSessionReset() {
    this._viewer = null;
    this._catalog = null;
    this.setData({
      ...initial(),
      loginRequired: true,
      notice: '身份变化，已清空旧账号城市授权资料。',
    });
  },
  login() {
    ui.login(PATH);
  },
  async load() {
    if (!this._alive || !this._visible || this.data.busy) return;
    const t = ui.begin(this);
    this.setData({ loading: true, error: '', items: [] });
    const session = await ui.session(this, PATH);
    if (!session || !ui.live(this, t)) return;
    this._viewer = session.user.id;
    try {
      const platform = this.data.platform && !!session.platformOperator;
      const filters = [
        this.data.userQuery ? 'userQuery=' + encodeURIComponent(this.data.userQuery) : '',
        this.data.orgQuery ? 'orgQuery=' + encodeURIComponent(this.data.orgQuery) : '',
      ]
        .filter(Boolean)
        .join('&');
      const [raw, catalog] = await Promise.all([
        gov.request(
          api.getClient(),
          (platform ? '/v1/platform/city-operations' : '/v1/me/city-operations') +
            (filters ? '?' + filters : ''),
        ),
        regions.fetchCatalog(),
      ]);
      const value = gov.page(raw);
      if (!ui.live(this, t)) return;
      this._catalog = catalog;
      this.setData({
        ...value,
        items: value.items.map((i) => ({
          ...i,
          actionLabel: actionNames[actions.indexOf(i.action)] || i.action,
        })),
        regions: catalog.nodes,
        platform,
        canManage: !!session.platformOperator,
        pending: gov.readPending(this._viewer, 'CITY'),
        loading: false,
      });
    } catch (error) {
      if (ui.live(this, t)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  scope(e) {
    if (this.data.busy) return;
    this.setData({ platform: e.currentTarget.dataset.platform === 'true' });
    this.load();
  },
  field(e) {
    if (
      !this.data.busy &&
      ['reason', 'userQuery', 'orgQuery', 'date', 'time'].includes(e.currentTarget.dataset.field)
    )
      this.setData({ [e.currentTarget.dataset.field]: String(e.detail.value || '') });
  },
  picker(e) {
    const field = e.currentTarget.dataset.field;
    if (['orgIndex', 'userIndex', 'regionIndex', 'actionIndex'].includes(field))
      this.setData({ [field]: Number(e.detail.value) || 0 });
  },
  async create() {
    const org = this.data.organizations[this.data.orgIndex],
      person = this.data.people[this.data.userIndex],
      region = this.data.regions[this.data.regionIndex];
    if (!org || !person || !region || !this._catalog)
      return this.setData({ error: '请从当前有效目录选择机构、人员和地区。' });
    const date = new Date(this.data.date + 'T' + this.data.time + ':00');
    if (!Number.isFinite(date.getTime()))
      return this.setData({ error: '请选择有效的本机当地到期日期和时间。' });
    try {
      const result = await gov.perform(
        this,
        'CITY',
        '/v1/platform/city-operations/grants',
        {
          orgId: org.id,
          userId: person.id,
          region: { catalogVersion: this._catalog.version, regionId: region.id },
          action: actions[this.data.actionIndex],
          expiresAt: date.toISOString(),
          reason: this.data.reason,
        },
        {
          title: '授予有限城市操作权限',
          content: '仅包含指定机构、地区范围、操作和到期时间，不授予全城私有资料访问权。',
        },
      );
      if (result) await this.load();
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  async revoke(e) {
    const row = this.data.items.find((i) => i.id === e.currentTarget.dataset.id);
    if (!row) return;
    try {
      const r = await gov.perform(
        this,
        'CITY',
        '/v1/platform/city-operations/grants/' + row.id + '/revoke',
        { expectedVersion: row.version, reason: this.data.reason },
        {
          title: '永久撤销本项授权',
          content: '当前关联审核和工单权限立即重新核对，旧授权不会恢复。',
        },
      );
      if (r) await this.load();
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  async more() {
    if (!this.data.nextCursor || this.data.busy) return;
    const t = ui.hold(this);
    this.setData({ busy: true });
    try {
      const v = gov.page(
        await gov.request(
          api.getClient(),
          (this.data.platform ? '/v1/platform/city-operations' : '/v1/me/city-operations') +
            '?before=' +
            gov.id(this.data.nextCursor),
        ),
      );
      if (ui.held(this, t))
        this.setData({
          items: this.data.items.concat(
            v.items.map((i) => ({
              ...i,
              actionLabel: actionNames[actions.indexOf(i.action)] || i.action,
            })),
          ),
          nextCursor: v.nextCursor || null,
        });
    } catch (error) {
      if (ui.held(this, t)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async recover(e) {
    try {
      const r = await gov.recover(this, 'CITY', e.currentTarget.dataset.cancel === 'true');
      if (r) await this.load();
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  assigned() {
    wx.navigateTo({ url: '/pages/governance/index?mode=assigned' });
  },
});
