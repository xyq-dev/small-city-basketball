const api = require('../../utils/api');
const ui = require('../../utils/ui');
const cities = require('../../utils/city-preference');
const ls = require('../../utils/local-services');
const fresh = () => ({
  title: '',
  description: '',
  address: '',
  qualificationNote: '',
  terms: '',
  kindIndex: 0,
  providerIndex: 0,
  courtIndex: 0,
  formRegion: null,
  coverage: [],
  businessPoint: null,
  editing: false,
});
Page({
  data: {
    organizations: [],
    orgIndex: 0,
    orgId: '',
    canCreate: false,
    providers: [],
    courts: [],
    kinds: Array.isArray(ls.KINDS) ? ls.KINDS.slice(1) : [],
    listings: [],
    selected: null,
    selection: { label: '全国' },
    ...fresh(),
    reason: '',
    qualificationChecked: false,
    scopeChecked: false,
    qualifiedDate: '',
    qualifiedTime: '23:59',
    startDate: '',
    startTime: '09:00',
    endDate: '',
    endTime: '11:00',
    placeQuery: '',
    places: [],
    placesBusy: false,
    loading: false,
    busy: false,
    error: '',
    message: '',
    pending: null,
    pendingError: '',
    loginRequired: false,
  },
  onLoad(query) {
    this._alive = true;
    try {
      this._routeOrg = query && query.orgId ? ls.id(query.orgId) : '';
      this._routeListing = query && query.listing ? ls.id(query.listing) : '';
    } catch (e) {
      this._routeOrg = '';
      this._routeListing = '';
      this.setData({ error: ui.message(e) });
    }
  },
  onShow() {
    this._hidden = false;
    this.setData({ selection: cities.snapshot() });
    if (!this.data.busy) this.load();
  },
  onHide() {
    this._hidden = true;
    this._places = (this._places || 0) + 1;
    this.setData({ places: [], placesBusy: false });
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  onSessionReset() {
    this._viewer = '';
    this._session = null;
    this.setData({
      organizations: [],
      orgId: '',
      canCreate: false,
      providers: [],
      courts: [],
      listings: [],
      selected: null,
      ...fresh(),
      reason: '',
      qualifiedDate: '',
      qualificationChecked: false,
      scopeChecked: false,
      pending: null,
      pendingError: '',
      busy: false,
      loading: false,
      loginRequired: true,
      error: '登录身份已变化，请重新读取。',
    });
  },
  login() {
    ui.login('/pages/local-manage/index');
  },
  async load() {
    if (this.data.busy) return;
    ui.begin(this);
    this.setData({
      loading: true,
      error: '',
      listings: [],
      selected: null,
      providers: [],
      courts: [],
    });
    const session = await ui.session(this, '/pages/local-manage/index');
    if (!this._alive || !session) return;
    this._viewer = session.user.id;
    this._session = session;
    const token = ui.begin(this);
    const organizations = [
      { id: '', name: '我提供的服务', role: 'PROVIDER' },
      ...session.organizations.map((o) => ({ id: o.id, name: o.name, role: o.role })),
    ];
    let index = organizations.findIndex((o) => o.id === (this._routeOrg || this.data.orgId));
    if (index < 0) index = 0;
    this._routeOrg = '';
    const selected = organizations[index],
      canCreate = ['ORG_OWNER', 'ORG_ADMIN'].includes(selected.role);
    this.setData({ organizations, orgIndex: index, orgId: selected.id, canCreate });
    ls.loadPending(this);
    try {
      const repo = ls.repository();
      const [listings, options] = await Promise.all([
        repo.workspace(selected.id || undefined),
        canCreate ? repo.options(selected.id) : Promise.resolve({ providers: [], courts: [] }),
      ]);
      if (!ui.live(this, token)) return;
      this.setData({
        listings,
        providers: options.providers,
        courts: options.courts,
        loading: false,
      });
      if (this._routeListing) {
        const listing = this._routeListing;
        this._routeListing = '';
        await this.selectId(listing);
      }
    } catch (e) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(e) });
    }
  },
  org(e) {
    if (this.data.busy || this.data.pending) return;
    const i = Number(e.detail.value),
      org = this.data.organizations[i];
    if (!org) return;
    this.setData({ orgId: org.id, ...fresh() });
    this.load();
  },
  input(e) {
    if (this.data.busy) return;
    const f = e.currentTarget.dataset.field;
    if (
      [
        'title',
        'description',
        'address',
        'qualificationNote',
        'terms',
        'reason',
        'qualifiedDate',
        'qualifiedTime',
        'startDate',
        'startTime',
        'endDate',
        'endTime',
        'placeQuery',
      ].includes(f)
    )
      this.setData({ [f]: e.detail.value, ...(f === 'address' ? { businessPoint: null } : {}) });
  },
  pick(e) {
    if (this.data.busy) return;
    const f = e.currentTarget.dataset.field;
    if (['kindIndex', 'providerIndex', 'courtIndex'].includes(f))
      this.setData({ [f]: Number(e.detail.value) });
  },
  checks(e) {
    const values = e.detail.value || [];
    this.setData({
      qualificationChecked: values.includes('qualification'),
      scopeChecked: values.includes('scope'),
    });
  },
  chooseCity() {
    ui.open('city-select');
  },
  useRegion() {
    try {
      const selection = cities.snapshot();
      ls.selectedRegion(selection);
      if (this.data.editing) throw new Error('修订资料不能更换原经营地区。');
      this.setData({ formRegion: selection, coverage: [selection], businessPoint: null });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  addCoverage() {
    try {
      const s = cities.snapshot();
      ls.selectedRegion(s);
      if (!this.data.formRegion) throw new Error('请先确认经营地区。');
      if (s.catalogVersion !== this.data.formRegion.catalogVersion)
        throw new Error('地区目录已变化，请重新创建供给。');
      if (this.data.coverage.length >= 20) throw new Error('最多选择20个覆盖地区。');
      if (!this.data.coverage.some((v) => v.regionId === s.regionId))
        this.setData({ coverage: this.data.coverage.concat(s) });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  removeCoverage(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    this.setData({ coverage: this.data.coverage.filter((v) => v.regionId !== id) });
  },
  async select(e) {
    await this.selectId(e.currentTarget.dataset.id);
  },
  async selectId(id) {
    if (this.data.busy) return;
    const token = ui.begin(this);
    this.setData({
      selected: null,
      error: '',
      qualificationChecked: false,
      scopeChecked: false,
      qualifiedDate: '',
      reason: '',
      editing: false,
    });
    try {
      const selected = await ls.repository().privateDetail(id);
      if (ui.live(this, token)) this.setData({ selected });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ error: ui.message(e) });
    }
  },
  edit() {
    const d = this.data.selected;
    if (!d || !d.capabilities.canManage || !['DRAFT', 'REJECTED'].includes(d.listing.status))
      return;
    const r = d.listing;
    this.setData({
      editing: true,
      title: r.title,
      description: r.description,
      address: r.address,
      qualificationNote: r.qualificationNote,
      terms: d.terms,
      kindIndex: this.data.kinds.findIndex((k) => k.value === r.kind),
      businessPoint: r.point,
      formRegion: { mode: 'REGION', ...r.region, label: '原经营地区', level: 'COUNTY' },
      coverage: r.coverageRegionIds.map((id) => ({
        mode: 'REGION',
        catalogVersion: r.region.catalogVersion,
        regionId: id,
        label: id === r.region.regionId ? '原经营地区' : '原覆盖地区',
      })),
    });
  },
  resetForm() {
    if (!this.data.busy) this.setData(fresh());
  },
  async searchPlaces() {
    const n = (this._places = (this._places || 0) + 1);
    try {
      if (!this.data.formRegion) throw new Error('请先确认经营地区。');
      this.setData({ placesBusy: true, error: '', places: [] });
      const places = await ls.repository().locate({
        type: 'SEARCH',
        region: ls.selectedRegion(this.data.formRegion),
        keyword: ls.text(this.data.placeQuery, '地点关键词', 1, 100),
      });
      if (this._alive && !this._hidden && n === this._places)
        this.setData({ places, placesBusy: false });
    } catch (e) {
      if (this._alive && !this._hidden && n === this._places)
        this.setData({ placesBusy: false, error: ui.message(e) });
    }
  },
  usePlace(e) {
    const p = this.data.places[Number(e.currentTarget.dataset.index)];
    if (p && !this.data.busy)
      this.setData({ address: p.address, businessPoint: p.point, places: [] });
  },
  async execute(config) {
    try {
      const result = await ls.write(this, config);
      if (result) {
        this._routeListing = result.resourceType === 'LISTING' ? result.resourceId : '';
        await this.load();
      }
      return result;
    } catch (e) {
      if (this._alive) this.setData({ error: ui.message(e) });
      return false;
    }
  },
  async save() {
    try {
      const old = this.data.editing && this.data.selected ? this.data.selected.listing : null;
      if (!old && !this.data.canCreate) throw new Error('请先选择可管理机构。');
      const region = old ? old.region : ls.selectedRegion(this.data.formRegion);
      const kind = old ? old.kind : this.data.kinds[this.data.kindIndex].value;
      const provider = old
        ? old.providerUserId
        : this.data.providers[this.data.providerIndex] &&
          this.data.providers[this.data.providerIndex].id;
      const court =
        kind === 'COURT'
          ? old
            ? old.courtId
            : this.data.courts[this.data.courtIndex] && this.data.courts[this.data.courtIndex].id
          : null;
      const payload = {
        kind,
        title: ls.text(this.data.title, '供给名称', 1, 100),
        description: ls.text(this.data.description, '服务说明', 1, 1000),
        address: ls.text(this.data.address, '实际地址', 1, 200),
        region,
        coverageRegionIds:
          kind === 'COURT' ? [region.regionId] : this.data.coverage.map((s) => s.regionId),
        point: this.data.businessPoint,
        providerUserId: ls.id(provider),
        courtId: court ? ls.id(court) : null,
        qualificationNote: ls.text(this.data.qualificationNote, '资质核验清单', 4, 1000),
        terms: ls.text(this.data.terms, '合作约定', 4, 1000),
      };
      if (!payload.coverageRegionIds.length) throw new Error('请加入至少一个服务覆盖地区。');
      if (kind === 'COURT' && !court) throw new Error('请先在排程管理建立实际球场，再选择绑定。');
      const result = await this.execute({
        path: old
          ? '/v1/local-services/listings/' + old.id
          : '/v1/orgs/' + this.data.orgId + '/local-services/listings',
        method: old ? 'PUT' : 'POST',
        body: old ? { expectedVersion: old.version, payload } : payload,
        label: old ? '保存供给修订' : '创建待审供给',
        content:
          '实际提供者必须本人确认，独立审核人核对资质和服务地区后才能发布；医务项目需核实实际执业资质，选项目不会自动认证。',
      });
      if (result) this.setData(fresh());
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async command(e) {
    const d = this.data.selected;
    if (!d) return;
    try {
      const type = e.currentTarget.dataset.type;
      const body = {
        expectedVersion: d.listing.version,
        type,
        reason: ls.text(this.data.reason, '操作说明', 4, 500),
      };
      if (type === 'APPROVE') {
        if (!this.data.qualificationChecked || !this.data.scopeChecked)
          throw new Error('审核需分别确认主体/资质和经营覆盖范围。');
        body.qualificationChecked = true;
        body.scopeChecked = true;
        body.qualifiedUntil = ui.chinaStamp(this.data.qualifiedDate, this.data.qualifiedTime);
      }
      await this.execute({
        path: '/v1/local-services/listings/' + d.listing.id + '/commands',
        body,
        label: {
          CONFIRM_PROVIDER: '本人确认服务',
          SUBMIT: '提交独立审核',
          APPROVE: '确认审核通过',
          REJECT: '退回供给',
          PUBLISH: '公开发布',
          UNPUBLISH: '取消公开',
          SUSPEND: '暂停供给',
        }[type],
        content:
          '请核对供给主体、实际地址、覆盖地区及本次操作说明。已产生的订单保留履约记录，支付未开放。',
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async addSlot() {
    const d = this.data.selected;
    if (!d) return;
    try {
      const startsAt = ui.chinaStamp(this.data.startDate, this.data.startTime),
        endsAt = ui.chinaStamp(this.data.endDate, this.data.endTime);
      if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('结束时间须晚于开始时间。');
      await this.execute({
        path: '/v1/local-services/listings/' + d.listing.id + '/slots',
        body: { expectedVersion: d.listing.version, startsAt, endsAt },
        label: '发布开放档期',
        content:
          ui.localTime(startsAt, true) +
          ' 至 ' +
          ui.localTime(endsAt, true) +
          '。档期还会检查供给资质有效期，实际预约将跨球场、人员、球队排程检查冲突。',
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async closeSlot(e) {
    const d = this.data.selected,
      s = d && d.slots.find((s) => s.id === e.currentTarget.dataset.id);
    if (!s) return;
    try {
      await this.execute({
        path: '/v1/local-services/listings/' + d.listing.id + '/slots/' + s.id + '/close',
        body: {
          expectedVersion: s.version,
          reason: ls.text(this.data.reason, '天气或关闭说明', 4, 500),
        },
        label: '关闭档期并更新预约',
        content:
          s.timeText +
          '。天气等原因关闭后，未到场预约与关联约赛会同步取消；已经履约的订单需先处理争议。此操作不能重新开启旧档期。',
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  recover() {
    return ls.recover(this);
  },
  retry() {
    return ls.retry(this);
  },
  bookings() {
    ls.open('local-bookings');
  },
});
