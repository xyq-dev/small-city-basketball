const trade = require('../trade-order/client');
const api = require('../../utils/api');
const ui = require('../../utils/ui');
const cities = require('../../utils/city-preference');
const ls = require('../../utils/local-services');
Page({
  data: {
    selection: { label: '全国' },
    kinds: ls.KINDS,
    kind: '',
    q: '',
    items: [],
    nextCursor: null,
    loading: false,
    loadingMore: false,
    loaded: false,
    error: '',
    message: '',
    locationError: '',
    locationBusy: false,
    locationEnabled: false,
    locatedRegions: [],
    originLabel: '未选择距离起点',
    hasOrigin: false,
    radii: [
      { value: 1000, label: '1公里' },
      { value: 3000, label: '3公里' },
      { value: 5000, label: '5公里' },
      { value: 10000, label: '10公里' },
    ],
    radiusIndex: 2,
    mapVisible: false,
    mapCenter: null,
    markers: [],
    placeQuery: '',
    places: [],
    placesBusy: false,
    detail: null,
    detailLoading: false,
    selectedSlot: '',
    accepted: false,
    serviceAddress: '',
    servicePlace: null,
    busy: false,
    pending: null,
    pendingError: '',
    loginRequired: false,
  },
  onLoad(query) {
    this._alive = true;
    this._generation = 0;
    try {
      this._detailId = query && query.listing ? ls.id(query.listing) : '';
    } catch (e) {
      this.setData({ error: ui.message(e) });
      this._detailId = '';
    }
  },
  onShow() {
    this._hidden = false;
    const selection = cities.snapshot();
    const changed = JSON.stringify(selection) !== JSON.stringify(this.data.selection);
    if (changed) {
      this._point = null;
      this.setData({ hasOrigin: false, originLabel: '未选择距离起点', servicePlace: null });
    }
    this.setData({ selection });
    this.load();
    if (this._detailId) this.showDetail(this._detailId);
  },
  onHide() {
    this._hidden = true;
    this._generation++;
    this._locating = (this._locating || 0) + 1;
    this._places = (this._places || 0) + 1;
    this._detail = (this._detail || 0) + 1;
    this._point = null;
    this._detectedPoint = null;
    this.setData({
      hasOrigin: false,
      originLabel: '未选择距离起点',
      locationBusy: false,
      placesBusy: false,
      locatedRegions: [],
      places: [],
      servicePlace: null,
      mapVisible: false,
      mapCenter: null,
      markers: [],
    });
  },
  onUnload() {
    this._alive = false;
    this._point = null;
    this._detectedPoint = null;
    this._generation++;
    this._locating = (this._locating || 0) + 1;
    this._places = (this._places || 0) + 1;
    this._detail = (this._detail || 0) + 1;
    ui.close(this);
  },
  onSessionReset() {
    this._viewer = '';
    this.setData({
      busy: false,
      pending: null,
      pendingError: '',
      accepted: false,
      serviceAddress: '',
      servicePlace: null,
      loginRequired: false,
    });
  },
  input(e) {
    const key = e.currentTarget.dataset.field;
    if (['q', 'placeQuery', 'serviceAddress'].includes(key) && !this.data.busy) {
      this.setData({
        [key]: e.detail.value,
        ...(key === 'serviceAddress' ? { servicePlace: null } : {}),
      });
    }
  },
  chooseCity() {
    ui.open('city-select');
  },
  nationwide() {
    cities.choose('');
    this._point = null;
    this.setData({ selection: cities.snapshot(), hasOrigin: false, originLabel: '未选择距离起点' });
    this.load();
  },
  kind(e) {
    if (this.data.loading) return;
    const kind = e.currentTarget.dataset.value;
    if (ls.KINDS.some((k) => k.value === kind)) {
      this.setData({ kind });
      this.load();
    }
  },
  radius(e) {
    this.setData({ radiusIndex: Number(e.detail.value) });
    if (this._point) this.load();
  },
  async load(more = false) {
    if (this._hidden || this._alive === false || (more && !this.data.nextCursor)) return;
    const generation = ++this._generation;
    this.setData({
      loading: !more,
      loadingMore: more,
      error: '',
      ...(more ? {} : { items: [], nextCursor: null, loaded: false }),
    });
    let query = { limit: 20 };
    const s = this.data.selection;
    if (s.mode === 'REGION')
      query = { ...query, regionId: s.regionId, catalogVersion: s.catalogVersion };
    if (this.data.kind) query.kind = this.data.kind;
    if (this.data.q.trim()) query.q = this.data.q.trim();
    if (this._point) {
      query.point = this._point;
      query.radiusMeters = this.data.radii[this.data.radiusIndex].value;
    }
    if (more) query.cursor = this.data.nextCursor;
    try {
      const result = await ls.repository().search(query);
      if (!this.current(generation)) return;
      const existing = more ? this.data.items : [],
        seen = new Set(existing.map((v) => v.id));
      this.setData({
        items: existing.concat(result.items.filter((v) => !seen.has(v.id))),
        nextCursor: result.nextCursor,
        locationEnabled: result.locationEnabled,
        loading: false,
        loadingMore: false,
        loaded: true,
      });
      this.refreshMap();
    } catch (e) {
      if (this.current(generation))
        this.setData({ loading: false, loadingMore: false, error: ui.message(e) });
    }
  },
  current(g) {
    return this._alive !== false && !this._hidden && g === this._generation;
  },
  search() {
    this.load();
  },
  more() {
    this.load(true);
  },
  async locate() {
    if (this.data.locationBusy) return;
    const n = (this._locating = (this._locating || 0) + 1);
    this.setData({ locationBusy: true, locationError: '', locatedRegions: [] });
    try {
      const manual = this.data.selection.mode === 'REGION';
      if (!manual && !this.data.locationEnabled)
        throw new Error('地图地区解析尚未开放，请先手动选择城市；选择后可按需定位查距离。');
      const p = await ls.locateOnce(wx);
      if (!this._alive || this._hidden || n !== this._locating) return;
      if (!manual) {
        const candidates = await ls.repository().locate({ type: 'REVERSE', point: p });
        if (!this._alive || this._hidden || n !== this._locating) return;
        const locatedRegions = candidates.filter((v) => v.region);
        this._detectedPoint = locatedRegions.length ? p : null;
        this.setData({
          locatedRegions,
          locationBusy: false,
          locationError: locatedRegions.length ? '' : '无法匹配当前地区目录，请手动选城。',
        });
        return;
      }
      this._point = p;
      this.setData({
        hasOrigin: true,
        originLabel: '本次设备位置（仅作搜索起点，不改变城市）',
        locationBusy: false,
      });
      await this.load();
    } catch (e) {
      if (this._alive && !this._hidden && n === this._locating)
        this.setData({ locationBusy: false, locationError: ui.message(e) });
    }
  },
  async confirmLocatedRegion(e) {
    const candidate = this.data.locatedRegions[Number(e.currentTarget.dataset.index)],
      n = this._locating,
      point = this._detectedPoint;
    if (!candidate || !point || this._hidden || !this._alive) return;
    const yes = await ui.confirm(
      '确认定位建议地区',
      candidate.regionLabel +
        '，' +
        candidate.address +
        '。确认后按该地区及下辖地区查找供给，本次位置仅作为距离起点。',
    );
    if (!yes || !this._alive || this._hidden || n !== this._locating) return;
    try {
      const selection = cities.chooseSelection({
        mode: 'REGION',
        ...candidate.region,
        label: candidate.regionLabel,
        level: candidate.regionLevel,
      });
      this._point = point;
      this._detectedPoint = null;
      this.setData({
        selection,
        locatedRegions: [],
        hasOrigin: true,
        originLabel: '本次设备位置（地区经本人确认）',
        locationError: '',
      });
      await this.load();
    } catch (e) {
      this.setData({ locationError: ui.message(e) });
    }
  },
  clearOrigin() {
    this._point = null;
    this._locating = (this._locating || 0) + 1;
    this.setData({
      hasOrigin: false,
      originLabel: '未选择距离起点',
      locationBusy: false,
      locationError: '',
      locatedRegions: [],
    });
    this._detectedPoint = null;
    this.load();
  },
  async searchPlaces() {
    if (this.data.placesBusy) return;
    const n = (this._places = (this._places || 0) + 1);
    try {
      const r = ls.selectedRegion(this.data.selection),
        keyword = ls.text(this.data.placeQuery, '地点关键词', 1, 100);
      this.setData({ placesBusy: true, places: [], locationError: '' });
      const places = await ls.repository().locate({ type: 'SEARCH', region: r, keyword });
      if (this._alive && !this._hidden && n === this._places)
        this.setData({
          places,
          placesBusy: false,
          locationError: places.length ? '' : '该地区没有可确认的地图候选，可直接输入地址。',
        });
    } catch (e) {
      if (this._alive && !this._hidden && n === this._places)
        this.setData({ placesBusy: false, locationError: ui.message(e) });
    }
  },
  async usePlace(e) {
    const p = this.data.places[Number(e.currentTarget.dataset.index)];
    if (!p || this.data.busy) return;
    const purpose = e.currentTarget.dataset.purpose;
    if (purpose === 'service') {
      this.setData({ servicePlace: p, serviceAddress: p.address });
      return;
    }
    const n = this._places,
      yes = await ui.confirm(
        '使用此搜索起点',
        p.title + '，' + p.address + '。仅用作当前所选地区内的距离起点；地图地点不是可预约库存。',
      );
    if (!yes || this._hidden || !this._alive || n !== this._places) return;
    this._point = p.point;
    this.setData({ hasOrigin: true, originLabel: p.title + '（手选起点）', places: [] });
    this.load();
  },
  toggleMap() {
    this.setData({ mapVisible: !this.data.mapVisible });
    this.refreshMap();
  },
  refreshMap() {
    const located = this.data.items.filter((v) => v.point),
      center = this._point || (located[0] && located[0].point) || null;
    this.setData({
      mapCenter: center,
      markers: located.map((v, i) => ({
        id: i + 1,
        latitude: v.point.latitude,
        longitude: v.point.longitude,
        title: v.title,
        width: 26,
        height: 32,
        callout: { content: v.title, display: 'BYCLICK' },
      })),
    });
    this._mapItems = located;
  },
  marker(e) {
    const row = (this._mapItems || [])[Number(e.detail.markerId) - 1];
    if (row) this.showDetail(row.id);
  },
  detail(e) {
    this.showDetail(e.currentTarget.dataset.id);
  },
  async showDetail(id) {
    const n = (this._detail = (this._detail || 0) + 1);
    try {
      this._detailId = ls.id(id);
      this.setData({
        detail: null,
        feeRead: false,
        feePreview: null,
        chargeConsent: false,
        detailLoading: true,
        error: '',
        accepted: false,
        selectedSlot: '',
        serviceAddress: '',
        servicePlace: null,
      });
      const detail = await ls.repository().detail(id);
      if (this._alive && !this._hidden && n === this._detail)
        this.setData({ detail, detailLoading: false });
    } catch (e) {
      if (this._alive && !this._hidden && n === this._detail)
        this.setData({ detailLoading: false, error: ui.message(e) });
    }
  },
  closeDetail() {
    this._detail++;
    this._detailId = '';
    this.setData({ detail: null, selectedSlot: '', accepted: false });
  },
  slot(e) {
    if (!this.data.busy) this.setData({ selectedSlot: e.currentTarget.dataset.id });
  },
  accept(e) {
    if (!this.data.busy) this.setData({ accepted: (e.detail.value || []).includes('yes') });
  },
  navigate() {
    const d = this.data.detail;
    if (d) ls.navigate(d.listing.point, d.listing.address, d.listing.title);
  },
  async previewCharge() {
    if (this.data.busy || !this.data.detail) return;
    const listingId = this.data.detail.listing.id,
      token = ui.begin(this);
    this.setData({ busy: true, error: '', feeRead: false, feePreview: null, chargeConsent: false });
    try {
      const session = await ui.session(this, '/pages/local/index');
      if (!session || !ui.live(this, token)) return;
      const preview = await trade.post('/preview', { kind: 'LOCAL_BOOKING', sourceId: listingId });
      if (ui.live(this, token) && this.data.detail && this.data.detail.listing.id === listingId)
        this.setData({
          feeRead: true,
          feePreview: {
            ...preview,
            ...(preview.enabled ? { totalText: trade.money(preview.totalFen) } : {}),
          },
        });
    } catch (e) {
      if (ui.live(this, token)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.live(this, token)) this.setData({ busy: false });
    }
  },
  chargeConsent(e) {
    if (!this.data.busy) this.setData({ chargeConsent: (e.detail.value || []).includes('yes') });
  },
  async book() {
    if (this.data.busy || !this.data.detail) return;
    try {
      const d = this.data.detail,
        row = d.listing,
        s = d.slots.find((v) => v.id === this.data.selectedSlot && v.available);
      if (!s) throw new Error('请选择当前可预约档期。');
      if (!this.data.accepted) throw new Error('请先阅读并勾选合作约定。');
      if (!this.data.feeRead) throw Error('请先读取服务端收费条款');
      if (this.data.feePreview.enabled && !this.data.chargeConsent)
        throw Error('请明确确认实际收款方、金额及收费条款');
      const serviceRegion =
        row.kind === 'COURT' ? row.region : ls.selectedRegion(this.data.selection);
      const body = { listingId: row.id, slotId: s.id, serviceRegion, acceptedTerms: true };
      if (this.data.feePreview.enabled) {
        body.acceptedTermsId = this.data.feePreview.termsId;
        body.chargeConsent = true;
      }
      if (row.kind !== 'COURT') {
        body.serviceAddress = ls.text(this.data.serviceAddress, '实际服务地址', 1, 200);
        if (this.data.servicePlace) body.servicePoint = this.data.servicePlace.point;
      }
      const session = await ui.session(this, '/pages/local/index');
      if (!this._alive || this._hidden || !session) return;
      this._viewer = session.user.id;
      ls.loadPending(this);
      if (this.data.pending || this.data.pendingError) return;
      const result = await ls.write(this, {
        path: '/v1/local-bookings',
        body,
        label: '提交预约',
        content:
          row.title +
          '，' +
          s.timeText +
          '，' +
          (body.serviceAddress || row.address) +
          '。球场锁位后在期限内付款，人员接单后付款；收费以已确认服务端条款为准。',
      });
      if (result) ls.open('local-bookings');
    } catch (e) {
      if (this._alive && !this._hidden) this.setData({ error: ui.message(e) });
    }
  },
  recover() {
    return ls.recover(this);
  },
  retry() {
    return ls.retry(this);
  },
  manage() {
    ls.open('local-manage');
  },
  bookings() {
    ls.open('local-bookings');
  },
  matchups() {
    ls.open('local-matchups');
  },
});
