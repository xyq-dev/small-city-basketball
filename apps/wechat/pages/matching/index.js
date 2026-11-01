const ui = require('../../utils/ui');
const api = require('../../utils/api');
const cities = require('../../utils/city-preference');
const matching = require('../../utils/matching');
const local = require('../../utils/local-services');
const freshWindow = () => {
  const date = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
  return { date, endDate: date, report: '18:00', start: '18:15', end: '20:00' };
};
Page({
  data: {
    workspaceTab: 'needs',
    detailTab: 'candidates',
    formStep: 'details',
    types: matching.TYPES,
    kindIndex: 0,
    roles: matching.ROLES.ADULT_PLAYER,
    roleIndex: 0,
    enabled: false,
    conversionEnabled: false,
    needs: [],
    inbox: [],
    sources: [],
    preferences: [],
    teams: [],
    organizations: [],
    teamIndex: 0,
    orgIndex: 0,
    sourceIndex: 0,
    selection: { label: '请选具体地区' },
    formRegion: null,
    scope: [],
    windows: [freshWindow()],
    form: {
      title: '',
      address: '',
      quantity: '1',
      unitBudget: '300',
      totalBudget: '300',
      travelMinutes: '120',
    },
    adult: false,
    discovery: false,
    contact: false,
    creating: false,
    supplyOpen: false,
    selected: null,
    seatIndex: 0,
    conversion: null,
    preview: null,
    chargeConsent: false,
    eligibility: false,
    courts: [],
    courtIndex: 0,
    terms: '',
    loading: false,
    busy: false,
    error: '',
    message: '',
    pending: null,
    pendingError: '',
    loginRequired: false,
  },
  onLoad(options) {
    this._alive = true;
    this._openId = options?.needId || '';
  },
  onShow() {
    this._visible = true;
    this.setData({ selection: cities.snapshot() });
    this.load();
  },
  onHide() {
    this._visible = false;
    this.setData({
      conversion: null,
      preview: null,
      chargeConsent: false,
      eligibility: false,
      busy: false,
    });
    ui.close(this);
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  onSessionReset() {
    this._viewer = '';
    this._openId = '';
    this.setData({
      needs: [],
      inbox: [],
      sources: [],
      preferences: [],
      teams: [],
      organizations: [],
      creating: false,
      supplyOpen: false,
      formStep: 'details',
      workspaceTab: 'needs',
      detailTab: 'candidates',
      adult: false,
      discovery: false,
      contact: false,
      selected: null,
      conversion: null,
      pending: null,
      pendingError: '',
      loading: false,
      busy: false,
      loginRequired: true,
      error: '登录身份已变化，请重新读取。',
    });
  },
  login() {
    ui.login('/pages/matching/index');
  },
  async load() {
    if (this.data.busy || !this._alive) return;
    const selectedId = this._openId || this.data.selected?.id;
    this.setData({ loading: true, error: '', selected: null, conversion: null });
    const session = await ui.session(this, '/pages/matching/index');
    if (!this._alive || !this._visible || !session) return;
    this._viewer = session.user.id;
    const token = ui.begin(this);
    try {
      const pending = matching.readPending(wx, this._viewer);
      const w = await matching.repository().workspace();
      if (!ui.live(this, token)) return;
      const teams = w.sources.filter((x) => x.kind === 'TEAM_MATCHUP');
      this.setData({
        ...w,
        pending,
        pendingError: '',
        teams,
        organizations: session.organizations.filter((o) =>
          ['ORG_OWNER', 'ORG_ADMIN'].includes(o.role),
        ),
        teamIndex: Math.min(this.data.teamIndex, Math.max(0, teams.length - 1)),
        sourceIndex: Math.min(this.data.sourceIndex, Math.max(0, w.sources.length - 1)),
        loading: false,
      });
      if (selectedId) {
        const selected = await matching.repository().detail(selectedId);
        if (ui.live(this, token)) {
          this._openId = '';
          this.setData({
            selected,
            seatIndex: 0,
            detailTab: selected.canManage ? 'candidates' : 'intents',
          });
        }
      }
    } catch (e) {
      if (ui.live(this, token))
        this.setData({
          loading: false,
          error: ui.message(e),
          pendingError: ui.message(e).includes('待核对') ? ui.message(e) : '',
        });
    }
  },
  async select(e) {
    if (this.data.busy) return;
    const token = ui.begin(this);
    this.setData({ loading: true, selected: null, conversion: null, error: '' });
    try {
      const selected = await matching.repository().detail(e.currentTarget.dataset.id);
      if (ui.live(this, token))
        this.setData({
          selected,
          detailTab: selected.canManage ? 'candidates' : 'intents',
          seatIndex: 0,
          loading: false,
          creating: false,
          supplyOpen: false,
        });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(e) });
    }
  },
  toggleCreate() {
    if (!this.data.busy)
      this.setData({
        creating: !this.data.creating,
        supplyOpen: false,
        selected: null,
        conversion: null,
        formStep: 'details',
      });
  },
  toggleSupply() {
    if (!this.data.busy) {
      this.setData({
        supplyOpen: !this.data.supplyOpen,
        creating: false,
        selected: null,
        conversion: null,
      });
      this.chooseSource({ detail: { value: this.data.sourceIndex } });
    }
  },
  workspaceTab(e) {
    if (this.data.busy || this.data.loading) return;
    const key = e.currentTarget.dataset.key;
    if (['needs', 'inbox'].includes(key)) this.setData({ workspaceTab: key });
  },
  detailTab(e) {
    if (this.data.busy || this.data.loading || this.data.conversion) return;
    const key = e.currentTarget.dataset.key;
    if (['candidates', 'intents'].includes(key)) this.setData({ detailTab: key });
  },
  overview() {
    if (this.data.busy || this.data.loading) return;
    this._openId = '';
    this.setData({
      selected: null,
      conversion: null,
      preview: null,
      creating: false,
      supplyOpen: false,
      chargeConsent: false,
      eligibility: false,
      formStep: 'details',
    });
  },
  reviewNeed() {
    if (this.data.busy || this.data.pending || this.data.pendingError) return;
    if (!this.data.form.title.trim() || !this.data.form.address.trim())
      return this.setData({ error: '请先填写需求名称与明确场馆地址。' });
    this.setData({ formStep: 'review', error: '' });
  },
  editNeed() {
    if (!this.data.busy) this.setData({ formStep: 'details' });
  },
  closeConversion() {
    if (!this.data.busy && !this.data.loading)
      this.setData({ conversion: null, preview: null, chargeConsent: false, eligibility: false });
  },
  input(e) {
    if (this.data.busy) return;
    const field = e.currentTarget.dataset.field;
    if (
      ['title', 'address', 'quantity', 'unitBudget', 'totalBudget', 'travelMinutes'].includes(field)
    )
      this.setData({ ['form.' + field]: e.detail.value });
    else if (field === 'terms') this.setData({ terms: e.detail.value });
  },
  choice(e) {
    if (this.data.busy) return;
    const field = e.currentTarget.dataset.field;
    if (['teamIndex', 'orgIndex', 'roleIndex', 'seatIndex', 'courtIndex'].includes(field))
      this.setData({ [field]: Number(e.detail.value) });
  },
  changeKind(e) {
    if (this.data.busy) return;
    const index = Number(e.detail.value),
      kind = matching.TYPES[index]?.value;
    if (!kind) return;
    this.setData({
      kindIndex: index,
      roles: matching.ROLES[kind],
      roleIndex: 0,
      windows: kind === 'ADULT_PLAYER' ? this.data.windows : [this.data.windows[0]],
      ...(kind === 'TEAM_MATCHUP'
        ? { 'form.quantity': '1', 'form.unitBudget': '0', 'form.totalBudget': '0' }
        : {}),
    });
  },
  check(e) {
    const field = e.currentTarget.dataset.field;
    if (
      !this.data.busy &&
      ['adult', 'discovery', 'contact', 'chargeConsent', 'eligibility'].includes(field)
    )
      this.setData({ [field]: e.detail.value.includes('yes') });
  },
  changeWindow(e) {
    if (this.data.busy) return;
    const { index, field } = e.currentTarget.dataset;
    if (
      ['date', 'endDate', 'report', 'start', 'end'].includes(field) &&
      this.data.windows[Number(index)]
    )
      this.setData({ ['windows[' + Number(index) + '].' + field]: e.detail.value });
  },
  addWindow() {
    if (!this.data.busy && this.data.windows.length < 64)
      this.setData({ windows: [...this.data.windows, freshWindow()] });
  },
  removeWindow(e) {
    if (!this.data.busy && this.data.windows.length > 1)
      this.setData({
        windows: this.data.windows.filter((_, i) => i !== Number(e.currentTarget.dataset.index)),
      });
  },
  useRegion() {
    try {
      const r = cities.snapshot();
      local.selectedRegion(r);
      this.setData({ formRegion: r, error: '' });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  pickRegion() {
    if (!this.data.busy) wx.navigateTo({ url: '/pages/city-select/index' });
  },
  addRegion() {
    try {
      const r = cities.snapshot();
      local.selectedRegion(r);
      if (this.data.scope.some((x) => x.regionId === r.regionId)) return;
      if (this.data.scope.length >= 20) throw new Error('最多选择20个地区');
      if (this.data.scope.some((x) => x.catalogVersion !== r.catalogVersion))
        throw new Error('地区目录已更新，请重新选择范围');
      this.setData({ scope: [...this.data.scope, r], selection: r, error: '' });
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  removeRegion(e) {
    if (!this.data.busy)
      this.setData({
        scope: this.data.scope.filter((_, i) => i !== Number(e.currentTarget.dataset.index)),
      });
  },
  async create() {
    try {
      if (!this.data.adult) throw new Error('请确认本需求仅面向成人');
      const kind = matching.TYPES[this.data.kindIndex].value,
        region = local.selectedRegion(this.data.formRegion || this.data.selection),
        team = this.data.teams[this.data.teamIndex],
        org = this.data.organizations[this.data.orgIndex];
      if (kind !== 'STAFF_SERVICE' && !team)
        throw new Error('需要有效的球队管理授权，请先在球队管理中确认授权');
      if (kind === 'STAFF_SERVICE' && !org) throw new Error('需要当前机构管理员身份');
      const windows = matching.windows(this.data.windows);
      const body = {
        kind,
        orgId: kind === 'STAFF_SERVICE' ? org.id : team.orgId,
        ...(kind === 'STAFF_SERVICE' ? {} : { teamId: team.id }),
        title: this.data.form.title.trim(),
        address: this.data.form.address.trim(),
        ...region,
        allowedRegionIds: (this.data.scope.length
          ? this.data.scope
          : [this.data.formRegion || this.data.selection]
        ).map((x) => x.regionId),
        role: this.data.roles[this.data.roleIndex].value,
        quantity: Number(this.data.form.quantity),
        windows,
        unitBudgetFen: matching.fen(this.data.form.unitBudget),
        totalBudgetFen: matching.fen(this.data.form.totalBudget),
        maxTravelMinutes: Number(this.data.form.travelMinutes),
        expiresAt: new Date(
          Math.min(...windows.map((w) => Date.parse(w.reportAt))) - 3600000,
        ).toISOString(),
        adultConfirmed: true,
      };
      await this.write(
        '/v1/matching/needs',
        body,
        '发布撮合需求',
        '需求将在最早报到前1小时截止；候选只是意向推荐，原预约成功后才占席位。',
      );
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  chooseSource(e) {
    const sourceIndex = Number(e.detail.value),
      source = this.data.sources[sourceIndex],
      pref =
        source &&
        this.data.preferences.find((p) => p.kind === source.kind && p.sourceId === source.id);
    this.setData({
      sourceIndex,
      discovery: !!pref?.discoveryEnabled,
      contact: !!pref?.contactEnabled,
      adult: false,
    });
  },
  async savePreference() {
    try {
      const source = this.data.sources[this.data.sourceIndex];
      if (!source) throw new Error('暂无已审核的本人球员、服务资料或可管理球队');
      if (!this.data.adult) throw new Error('请确认本供给仅面向成人');
      const region = local.selectedRegion(this.data.formRegion || this.data.selection),
        pref = this.data.preferences.find(
          (p) => p.kind === source.kind && p.sourceId === source.id,
        );
      const body = {
        kind: source.kind,
        sourceId: source.id,
        expectedVersion: pref?.version ?? 0,
        ...region,
        allowedRegionIds: (this.data.scope.length
          ? this.data.scope
          : [this.data.formRegion || this.data.selection]
        ).map((x) => x.regionId),
        discoveryEnabled: this.data.discovery,
        contactEnabled: this.data.contact,
        adultConfirmed: true,
        availability: source.kind === 'TEAM_MATCHUP' ? matching.windows(this.data.windows) : [],
      };
      await this.write(
        '/v1/matching/preferences',
        body,
        '更新撮合授权',
        '授权按本资料及所选范围生效。关闭发现或联系许可后，新的邀请与转换将被阻止。球员和工作人员沿用原资料档期。',
      );
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  run() {
    const n = this.data.selected;
    if (n?.canManage)
      this.write(
        '/v1/matching/needs/' + n.id + '/runs',
        { expectedVersion: n.version },
        '重新匹配',
        '按当前角色、确定时段、报价和双方地区许可重新筛选。未核验交通耗时不会作为承诺。',
      );
  },
  send(e) {
    const n = this.data.selected,
      slot = n?.slots[this.data.seatIndex],
      candidate = n?.candidates.find((x) => x.id === e.currentTarget.dataset.id);
    if (!slot || slot.status !== 'OPEN' || !candidate) {
      this.setData({ error: '请选择一个待补位席位' });
      return;
    }
    this.write(
      '/v1/matching/needs/' + n.id + '/intents',
      { expectedVersion: n.version, slotId: slot.id, candidateId: candidate.id },
      '发送合作意向',
      '将需求名称、场馆地址、时段与预算提供给这位候选。对方同意后仍需转为原预约，意向本身不占档。',
    );
  },
  needCommand(e) {
    const n = this.data.selected;
    if (!n) return;
    const type = e.currentTarget.dataset.type;
    this.write(
      '/v1/matching/needs/' + n.id + '/commands',
      {
        type,
        expectedVersion: n.version,
        ...(type === 'REOPEN_SLOT' ? { slotId: e.currentTarget.dataset.id } : {}),
      },
      type === 'REOPEN_SLOT' ? '检查并重开席位' : '更新需求',
      type === 'REOPEN_SLOT'
        ? '只有原预约取消、拒绝或过期，且财务事项已处理完，才能重开；已发生费用仍占总预算。'
        : '变更后尚未转单的意向需重新确认；既有原预约仍按原流程处理。',
    );
  },
  intentCommand(e) {
    const i = this.data.selected?.intents.find((x) => x.id === e.currentTarget.dataset.id);
    if (i)
      this.write(
        '/v1/matching/intents/' + i.id + '/commands',
        { type: e.currentTarget.dataset.type, expectedVersion: i.version },
        '确认意向操作',
        '意向不是正式接单。正式履约、付款和取消继续遵循原预约流程。',
      );
  },
  async reviewConversion(e) {
    if (this.data.busy) return;
    const n = this.data.selected,
      i = n?.intents.find((x) => x.id === e.currentTarget.dataset.id);
    if (!i?.canConvert || !i.candidate) return;
    const token = ui.begin(this);
    this.setData({
      loading: true,
      error: '',
      conversion: null,
      chargeConsent: false,
      eligibility: false,
      terms: '',
      courtIndex: 0,
    });
    try {
      const preview = await matching.repository().preview(n, i.candidate);
      const courts =
        n.kind === 'TEAM_MATCHUP'
          ? (await local.repository().bookings()).filter(
              (b) =>
                b.kind === 'COURT' &&
                b.canActAs === 'BUYER' &&
                b.status === 'CONFIRMED' &&
                Date.parse(b.startsAt) === Date.parse(n.windows[0].reportAt) &&
                Date.parse(b.endsAt) === Date.parse(n.windows[0].endAt),
            )
          : [];
      if (ui.live(this, token)) this.setData({ conversion: i, preview, courts, loading: false });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(e) });
    }
  },
  async convert() {
    try {
      const n = this.data.selected,
        i = this.data.conversion,
        p = this.data.preview;
      if (!i || !p) throw new Error('请先核对最新预约条款');
      if (n.kind !== 'TEAM_MATCHUP' && !p.enabled)
        throw new Error('收费准备尚未完成，暂不可转预约，请稍后重新核对');
      if (!this.data.eligibility) throw new Error('请确认已核对成人资格、场地与时间约定');
      if (p.enabled && !this.data.chargeConsent) throw new Error('请阅读并同意本次收费条款');
      let sourceInput;
      if (n.kind === 'ADULT_PLAYER')
        sourceInput = {
          eligibilityConfirmed: true,
          reviewedSettingsVersion: i.candidate.settingsVersion,
        };
      else if (n.kind === 'STAFF_SERVICE') sourceInput = { acceptedTerms: true };
      else {
        const court = this.data.courts[this.data.courtIndex];
        if (!court) throw new Error('需要本人已确认且时段完全一致的球场预约');
        sourceInput = { courtBookingId: court.id, terms: this.data.terms.trim() };
      }
      if (p.enabled)
        sourceInput = { ...sourceInput, acceptedTermsId: p.acceptedTermsId, chargeConsent: true };
      await this.write(
        '/v1/matching/intents/' + i.id + '/commands',
        { expectedVersion: i.version, type: 'CONVERT', sourceInput },
        '转为正式预约申请',
        '将同事务创建原业务单并占一个需求席位；仍需对方按原流程正式接单或确认。这里只创建预约申请，不会自动付款。',
      );
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  openSource(e) {
    const i = this.data.selected?.intents.find((x) => x.id === e.currentTarget.dataset.id);
    if (!i?.sourceId) return;
    const url =
      i.sourceKind === 'PLAYER_ORDER'
        ? '/pages/booking-detail/index?id=' + i.sourceId
        : i.sourceKind === 'TEAM_MATCHUP'
          ? '/pages/local-matchups/index'
          : '/pages/local-bookings/index';
    wx.navigateTo({ url });
  },
  async write(path, body, title, description) {
    if (this.data.busy || this.data.pending || this.data.pendingError || !this.data.enabled) return;
    const actor = this._viewer;
    const confirmation = await ui.confirmOp(this, title, description);
    if (!confirmation) return;
    this.setData({ busy: true, error: '', message: '' });
    const token = ui.hold(this);
    try {
      const commandId = await ui.uuid();
      if (!confirmation.valid() || !ui.held(this, token) || actor !== this._viewer) return;
      const pending = matching.savePending(wx, actor, path, { ...body, commandId });
      this.setData({ pending });
      const result = await matching.repository().write(path, pending.body);
      if (!ui.held(this, token) || actor !== this._viewer) return;
      matching.clearPending(wx, actor, commandId);
      this._openId =
        result.needId ||
        (result.resourceType === 'MATCHING_NEED'
          ? result.resourceId
          : this.data.selected?.id || '');
      this.setData({
        pending: null,
        busy: false,
        message: '操作已保存；预约与意向状态请以下方最新资料为准。',
        conversion: null,
        creating: false,
      });
      await this.load();
    } catch (e) {
      if (ui.held(this, token) && actor === this._viewer) {
        if (e?.status >= 400 && e.status < 500 && e.code !== 'MATCHING_COMMAND_CONFLICT') {
          try {
            const p = matching.readPending(wx, actor);
            if (p) matching.clearPending(wx, actor, p.body.commandId);
            this.setData({ pending: null });
          } catch (_) {
            /* retain unknown operation */
          }
        }
        this.setData({ busy: false, error: ui.message(e) });
      }
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async recover() {
    if (this.data.busy || !this.data.pending) return;
    const actor = this._viewer,
      token = ui.hold(this),
      p = this.data.pending;
    this.setData({ busy: true, error: '' });
    try {
      const r = await matching.repository().receipt(p.body.commandId);
      if (!ui.held(this, token) || actor !== this._viewer) return;
      if (!r.found) {
        this.setData({ message: '尚未查到回执；可以用原编号重试，请勿新建重复操作。' });
        return;
      }
      matching.clearPending(wx, actor, p.body.commandId);
      this._openId =
        r.result.needId || (r.result.resourceType === 'MATCHING_NEED' ? r.result.resourceId : '');
      this.setData({ pending: null, busy: false, message: '已找到原操作回执。' });
      await this.load();
    } catch (e) {
      if (ui.held(this, token)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async retry() {
    if (this.data.busy || !this.data.pending) return;
    const p = this.data.pending,
      actor = this._viewer;
    const op = await ui.confirmOp(
      this,
      '重试原操作',
      '使用同一操作编号和原内容，服务器将核对现有回执。',
    );
    if (!op) return;
    const token = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      if (!op.valid()) return;
      const r = await matching.repository().write(p.path, p.body);
      if (!ui.held(this, token) || actor !== this._viewer) return;
      matching.clearPending(wx, actor, p.body.commandId);
      this._openId = r.needId || (r.resourceType === 'MATCHING_NEED' ? r.resourceId : '');
      this.setData({ pending: null, busy: false });
      await this.load();
    } catch (e) {
      if (ui.held(this, token)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
});
