const ui = require('../../utils/ui');
const ls = require('../../utils/local-services');
const cities = require('../../utils/city-preference');
const d = require('../../utils/dispatch');
const fresh = () => ({
  formRegion: null,
  inviteRegions: [],
  kindIndex: 0,
  address: '',
  startDate: '',
  startTime: '09:00',
  endDate: '',
  endTime: '11:00',
  expiryDate: '',
  expiryTime: '20:00',
  serviceFee: '',
  travelFee: '',
  lodgingFee: '',
  totalBudget: '',
  allowCrossCity: false,
});
const freshQuote = () => ({
  quoteService: '',
  quoteTravel: '',
  quoteLodging: '',
  departureDate: '',
  departureTime: '06:00',
  arrivalDate: '',
  arrivalTime: '08:00',
  returnDate: '',
  returnTime: '18:00',
  travelMethod: '',
  travelEvidence: '',
  terms: '',
  slots: [],
  slotIndex: 0,
  evidenceChecked: false,
  chargeConsent: false,
});
Page({
  data: {
    dispatchView: 'requests',
    ...fresh(),
    ...freshQuote(),
    kinds: d.KINDS,
    selection: { label: '全国' },
    organizations: [],
    orgIndex: 0,
    requests: [],
    offers: [],
    detail: null,
    selectedOffer: null,
    preference: null,
    preferenceRegions: [],
    dailyLimit: '3',
    reason: '',
    loading: false,
    busy: false,
    error: '',
    message: '',
    pending: null,
    pendingError: '',
    loginRequired: false,
    capabilities: null,
  },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    this._visible = true;
    this.setData({ selection: cities.snapshot() });
    if (!this.data.busy) this.load();
  },
  onHide() {
    this._visible = false;
    ui.close(this);
    this.setData({ busy: false });
  },
  onUnload() {
    this._alive = false;
    this._visible = false;
    ui.close(this);
  },
  onSessionReset() {
    this._viewer = '';
    this.setData({
      ...fresh(),
      ...freshQuote(),
      organizations: [],
      orgIndex: 0,
      dispatchView: 'requests',
      capabilities: null,
      dailyLimit: '3',
      requests: [],
      offers: [],
      detail: null,
      selectedOffer: null,
      preference: null,
      preferenceRegions: [],
      reason: '',
      pending: null,
      pendingError: '',
      busy: false,
      loading: false,
      loginRequired: true,
      error: '登录身份已变化，请重新读取',
    });
  },
  login() {
    ui.login('/pages/dispatch/index');
  },
  async load() {
    if (this.data.busy) return;
    ui.begin(this);
    this.setData({
      loading: true,
      error: '',
      detail: null,
      selectedOffer: null,
      requests: [],
      offers: [],
      ...freshQuote(),
    });
    const session = await ui.session(this, '/pages/dispatch/index');
    if (!session || !this._alive) return;
    if (this._viewer && this._viewer !== session.user.id) this.onSessionReset();
    this._viewer = session.user.id;
    d.loadPending(this);
    const token = ui.begin(this);
    try {
      const workspace = await d.repository().workspace();
      if (ui.live(this, token)) {
        const organizations = session.organizations.filter((o) =>
          ['ORG_OWNER', 'ORG_ADMIN'].includes(o.role),
        );
        this.setData({
          ...workspace,
          loginRequired: false,
          error: '',
          organizations,
          orgIndex: Math.min(this.data.orgIndex, Math.max(0, organizations.length - 1)),
          loading: false,
          dailyLimit: String(workspace.preference?.dailyLimit || 3),
        });
      }
    } catch (e) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(e) });
    }
  },
  workspace(e) {
    if (this.data.busy || this.data.loading) return;
    const key = e.currentTarget.dataset.key;
    if (!['requests', 'offers', 'preference', 'create'].includes(key)) return;
    if (key === 'create' && !this.data.organizations.length) return;
    ui.begin(this);
    this.setData({
      dispatchView: key,
      detail: null,
      selectedOffer: null,
      reason: '',
      ...freshQuote(),
    });
  },
  closeDetail() {
    if (!this.data.busy && !this.data.loading) {
      ui.begin(this);
      this.setData({ detail: null, selectedOffer: null, reason: '', ...freshQuote() });
    }
  },
  input(e) {
    const key = e.currentTarget.dataset.field;
    if (
      !this.data.busy &&
      [
        'address',
        'startDate',
        'startTime',
        'endDate',
        'endTime',
        'expiryDate',
        'expiryTime',
        'serviceFee',
        'travelFee',
        'lodgingFee',
        'totalBudget',
        'reason',
        'dailyLimit',
        'quoteService',
        'quoteTravel',
        'quoteLodging',
        'departureDate',
        'departureTime',
        'arrivalDate',
        'arrivalTime',
        'returnDate',
        'returnTime',
        'travelMethod',
        'travelEvidence',
        'terms',
      ].includes(key)
    )
      this.setData({ [key]: e.detail.value });
  },
  pick(e) {
    const key = e.currentTarget.dataset.field;
    if (!this.data.busy && ['kindIndex', 'orgIndex', 'slotIndex'].includes(key))
      this.setData({ [key]: Number(e.detail.value) });
  },
  checks(e) {
    if (this.data.busy) return;
    const values = e.detail.value || [];
    this.setData({
      allowCrossCity: values.includes('crossCity'),
      evidenceChecked: values.includes('evidence'),
      chargeConsent: values.includes('charge'),
    });
  },
  chooseCity() {
    if (!this.data.busy) ui.open('city-select');
  },
  useRegion() {
    try {
      const selection = cities.snapshot();
      ls.selectedRegion(selection);
      this.setData({ formRegion: selection });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  addRegion(e) {
    try {
      const key = e.currentTarget.dataset.target;
      if (!['inviteRegions', 'preferenceRegions'].includes(key) || this.data.busy) return;
      const selection = cities.snapshot();
      ls.selectedRegion(selection);
      const old = this.data[key];
      if (old.length >= 20) throw new Error('最多20个地区');
      if (!old.some((r) => r.regionId === selection.regionId))
        this.setData({ [key]: [...old, selection] });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  removeRegion(e) {
    const key = e.currentTarget.dataset.target;
    if (!this.data.busy && ['inviteRegions', 'preferenceRegions'].includes(key))
      this.setData({
        [key]: this.data[key].filter((r) => r.regionId !== e.currentTarget.dataset.id),
      });
  },
  async execute(input) {
    const r = await d.write(this, input);
    if (r) await this.load();
    return r;
  },
  async create() {
    try {
      const o = this.data.organizations[this.data.orgIndex];
      if (!o) throw new Error('需要当前机构管理权限');
      if (!this.data.allowCrossCity) throw new Error('请明确勾选跨城邀请及费用上限');
      if (!this.data.inviteRegions.length) throw new Error('请选择允许邀请的人员常驻地区');
      const budget = {
        serviceMinor: d.fen(this.data.serviceFee),
        travelMinor: d.fen(this.data.travelFee),
        lodgingMinor: d.fen(this.data.lodgingFee),
        platformMinor: 0,
        totalMinor: d.fen(this.data.totalBudget),
      };
      await this.execute({
        path: '/v1/dispatch/requests',
        body: {
          orgId: o.id,
          kind: d.KINDS[this.data.kindIndex].value,
          people: 1,
          serviceRegion: ls.selectedRegion(this.data.formRegion),
          serviceAddress: ls.text(this.data.address, '服务地点', 4, 200),
          servicePoint: null,
          startsAt: ui.chinaStamp(this.data.startDate, this.data.startTime),
          endsAt: ui.chinaStamp(this.data.endDate, this.data.endTime),
          expiresAt: ui.chinaStamp(this.data.expiryDate, this.data.expiryTime),
          budget,
          inviteRegionIds: this.data.inviteRegions.map((r) => r.regionId),
          allowCrossCity: true,
        },
        label: '建立跨城人员需求',
        content:
          o.name +
          '，' +
          this.data.formRegion.label +
          '，' +
          this.data.address +
          '。' +
          d.money(budget).detailText +
          '，总额上限' +
          ui.money(budget.totalMinor) +
          '。每项岗位仅1人，最多3批、每批3人；保存后还需开始邀请。',
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async preferenceCommand(e) {
    try {
      const enabled =
        e.currentTarget.dataset.enabled === true || e.currentTarget.dataset.enabled === 'true';
      const ids = this.data.preferenceRegions.length
        ? this.data.preferenceRegions.map((r) => r.regionId)
        : this.data.preference?.regionIds;
      if (!ids?.length) throw new Error('请至少明确选择一个接单地区');
      await this.execute({
        path: '/v1/dispatch/preferences',
        body: {
          expectedVersion: this.data.preference?.version || 0,
          enabled,
          regionIds: ids,
          dailyLimit: Number(this.data.dailyLimit),
        },
        label: enabled ? '本人允许跨城邀请' : '本人停止跨城邀请',
        content:
          '范围仅可在已审核服务覆盖内。每日邀请上限 ' +
          this.data.dailyLimit +
          ' 次。关闭后新的报价和接单将停止，已有真实订单仍通过原预约处理。',
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async selectRequest(e) {
    if (this.data.busy) return;
    const token = ui.begin(this);
    this.setData({ detail: null, selectedOffer: null, reason: '', ...freshQuote() });
    try {
      const detail = await d.repository().detail(e.currentTarget.dataset.id);
      if (ui.live(this, token)) this.setData({ detail, dispatchView: 'requests' });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ error: ui.message(e) });
    }
  },
  async selectOffer(e) {
    if (this.data.busy) return;
    const token = ui.begin(this);
    this.setData({ detail: null, selectedOffer: null, reason: '', ...freshQuote() });
    try {
      const row = await d.repository().offer(e.currentTarget.dataset.id);
      let slots = [];
      if (row.canQuote)
        slots = (await d.repository().slots(row.listingId)).filter(
          (s) =>
            s.available && s.startsAt === row.request.startsAt && s.endsAt === row.request.endsAt,
        );
      if (row.quote)
        row.quote = {
          ...row.quote,
          serviceText: ui.money(row.quote.serviceMinor),
          travelText: ui.money(row.quote.travelMinor),
          lodgingText: ui.money(row.quote.lodgingMinor),
          platformText: ui.money(row.quote.platformMinor),
        };
      if (ui.live(this, token)) this.setData({ selectedOffer: row, slots, dispatchView: 'offers' });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ error: ui.message(e) });
    }
  },
  async requestCommand(e) {
    const row = this.data.detail?.request;
    if (!row) return;
    try {
      const type = e.currentTarget.dataset.type;
      const winner = this.data.detail.offers.find((o) => o.id === row.winnerOfferId);
      const body = {
        expectedVersion: row.version,
        type,
        reason: ls.text(this.data.reason, '操作说明', 4, 500),
      };
      if (type === 'CONFIRM_QUOTE') {
        if (!this.data.chargeConsent || !winner?.quote)
          throw new Error('请核对当前完整报价并明确同意');
        Object.assign(body, {
          quoteHash: winner.quoteHash,
          acceptedTermsId: winner.quoteHash,
          chargeConsent: true,
        });
      }
      await this.execute({
        path: '/v1/dispatch/requests/' + row.id + '/commands',
        body,
        label: {
          START: '开始分批邀请',
          RESUME: '恢复邀请',
          PAUSE: '暂停邀请',
          CANCEL: '取消需求',
          CONFIRM_QUOTE: '确认报价并转预约',
          REJECT_QUOTE: '拒绝本次报价',
        }[type],
        content:
          row.kindText +
          '，' +
          row.timeText +
          '，' +
          row.serviceAddress +
          '。' +
          (type === 'CONFIRM_QUOTE'
            ? winner.quote.detailText +
              '，总额 ' +
              winner.quote.totalText +
              '。' +
              winner.quote.terms +
              '。付款和履约继续在真实预约办理。'
            : '每次操作按当前版本处理；后续替补会再次要求双方确认。'),
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  submitOwnQuote() {
    if (this.data.busy || this.data.pending || this.data.pendingError) return;
    if (this.data.selectedOffer && this.data.selectedOffer.canQuote) {
      return this.offerCommand({ currentTarget: { dataset: { type: 'SUBMIT_QUOTE' } } });
    }
    const offer = (this.data.offers || [])[0];
    if (!offer) return;
    this.selectOffer({ currentTarget: { dataset: { id: offer.id } } });
  },
  async offerCommand(e) {
    const row = this.data.selectedOffer;
    if (!row) return;
    try {
      const type = e.currentTarget.dataset.type,
        body = {
          expectedVersion: row.version,
          type,
          reason: ls.text(this.data.reason, '操作说明', 4, 500),
        };
      if (['VERIFY_TRAVEL', 'ACCEPT'].includes(type)) body.quoteHash = row.quoteHash;
      if (type === 'VERIFY_TRAVEL') {
        if (!this.data.evidenceChecked) throw new Error('须独立核验真实路线和凭据');
        body.evidenceChecked = true;
      }
      if (type === 'SUBMIT_QUOTE') {
        const slot = this.data.slots[this.data.slotIndex];
        if (!slot) throw new Error('没有完全覆盖服务时间的有效档期，请先管理已审核服务的档期');
        const serviceMinor = d.fen(this.data.quoteService),
          travelMinor = d.fen(this.data.quoteTravel),
          lodgingMinor = d.fen(this.data.quoteLodging);
        body.quote = {
          slotId: slot.id,
          serviceMinor,
          travelMinor,
          lodgingMinor,
          platformMinor: 0,
          totalMinor: serviceMinor + travelMinor + lodgingMinor,
          departureAt: ui.chinaStamp(this.data.departureDate, this.data.departureTime),
          arrivalAt: ui.chinaStamp(this.data.arrivalDate, this.data.arrivalTime),
          returnAt: ui.chinaStamp(this.data.returnDate, this.data.returnTime),
          travelMethod: ls.text(this.data.travelMethod, '交通方式', 2, 100),
          travelEvidence: ls.text(this.data.travelEvidence, '核验证据', 10, 1000),
          terms: ls.text(this.data.terms, '服务约定', 10, 1000),
        };
      }
      await this.execute({
        path: '/v1/dispatch/offers/' + row.id + '/commands',
        body,
        label: {
          SUBMIT_QUOTE: '提交不可修改的完整报价',
          VERIFY_TRAVEL: '独立核验交通方案',
          ACCEPT: '本人接单并暂占差旅档期',
          DECLINE: '拒绝服务邀请',
          WITHDRAW: '撤回本次接单',
        }[type],
        content:
          row.request.kindText +
          '，' +
          row.request.timeText +
          '，' +
          row.request.serviceAddress +
          '。' +
          (body.quote
            ? d.money(body.quote).detailText +
              '，总额' +
              ui.money(body.quote.totalMinor) +
              '；交通方案还需独立核验。'
            : row.quote
              ? row.quote.detailText + '，总额' + row.quote.totalText + '。' + row.quote.routeText
              : '仅处理本次站内邀请。'),
      });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  async recover() {
    await d.recover(this);
  },
  async retry() {
    if (await d.retry(this)) await this.load();
  },
  source() {
    const id =
      this.data.detail?.request.sourceBookingId || this.data.selectedOffer?.sourceBookingId;
    if (id)
      wx.navigateTo({
        url: '/pages/trade-order/index?kind=LOCAL_BOOKING&sourceId=' + encodeURIComponent(id),
      });
  },
  bookings() {
    wx.navigateTo({ url: '/pages/local-bookings/index' });
  },
  manage() {
    wx.navigateTo({ url: '/pages/local-manage/index' });
  },
});
