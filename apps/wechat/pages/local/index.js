const trade = require('../trade-order/client');
const api = require('../../utils/api');
const ui = require('../../utils/ui');
const cities = require('../../utils/city-preference');
const ls = require('../../utils/local-services');
Page({
  data: {
    selection: { label: '全国' },
    kinds: ls.KINDS,
    kind: 'COURT',
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
    filtersOpen: false,
    mapVisible: false,
    mapCenter: null,
    mapScale: 13,
    viewportEnabled: false,
    viewportDirty: false,
    viewportBusy: false,
    viewportMode: false,
    mapError: '',
    mapScopeLabel: '',
    acrossRegions: false,
    canRestoreArea: false,
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
  toggleFilters() {
    if (!this.data.busy && !this.data.pending && !this.data.pendingError)
      this.setData({ filtersOpen: !this.data.filtersOpen });
  },
  onLoad(query) {
    this._alive = true;
    this._generation = 0;
    this._viewEpoch = 0;
    this._viewportRead = 0;
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
    this.resetViewport();
    this._generation++;
    this._locating = (this._locating || 0) + 1;
    this._places = (this._places || 0) + 1;
    this._detail = (this._detail || 0) + 1;
    this._point = null;
    this._detectedPoint = null;
    this.setData({
      hasOrigin: false,
      feeRead: false,
      feePreview: null,
      chargeConsent: false,
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
    this.resetViewport();
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
    this.resetViewport();
    this._point = null;
    this._detectedPoint = null;
    this._locating = (this._locating || 0) + 1;
    this._places = (this._places || 0) + 1;
    this.setData({
      busy: false,
      pending: null,
      pendingError: '',
      accepted: false,
      feeRead: false,
      feePreview: null,
      chargeConsent: false,
      serviceAddress: '',
      servicePlace: null,
      loginRequired: false,
      items: [],
      nextCursor: null,
      markers: [],
      mapCenter: null,
      mapVisible: false,
      loaded: false,
      hasOrigin: false,
      originLabel: '未选择距离起点',
    });
  },
  input(e) {
    const key = e.currentTarget.dataset.field;
    if (['q', 'placeQuery', 'serviceAddress'].includes(key) && !this.data.busy) {
      if (key === 'q') this.resetViewport();
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
  async load(more = false, areaQuery = null) {
    if (
      this._hidden ||
      this._alive === false ||
      (more &&
        (!this.data.nextCursor ||
          this.data.viewportDirty ||
          this.data.viewportBusy ||
          this.data.loadingMore))
    )
      return;
    const viewportQuery = areaQuery || (more && this._viewportQuery);
    if (!more && !viewportQuery) this.resetViewport();
    const generation = ++this._generation;
    const viewEpoch = this._viewEpoch;
    this.setData({
      loading: !more && !viewportQuery,
      loadingMore: more,
      error: '',
      viewportBusy: !!viewportQuery && !more,
      mapError: '',
      ...(more || viewportQuery ? {} : { items: [], nextCursor: null, loaded: false }),
    });
    let query = viewportQuery ? { ...viewportQuery } : this.searchFilters();
    if (!viewportQuery && this._point) {
      query.point = this._point;
      query.radiusMeters = this.data.radii[this.data.radiusIndex].value;
    }
    if (more) query.cursor = this.data.nextCursor;
    try {
      const result = await ls.repository().search(query);
      if (!this.current(generation) || (viewportQuery && viewEpoch !== this._viewEpoch)) return;
      const existing = more ? this.data.items : [],
        seen = new Set(existing.map((v) => v.id));
      this.setData({
        items: existing.concat(result.items.filter((v) => !seen.has(v.id))),
        nextCursor: result.nextCursor,
        locationEnabled: result.locationEnabled,
        viewportEnabled: result.viewportEnabled,
        viewportBusy: false,
        loading: false,
        loadingMore: false,
        loaded: true,
        ...(viewportQuery
          ? {
              viewportMode: true,
              viewportDirty: false,
              mapScopeLabel:
                result.searchArea.scopeLabel === 'SELECTED_REGION'
                  ? this.data.selection.label + ' · 当前地图范围'
                  : '临时地图范围 · 未改变所选城市',
              canRestoreArea: true,
            }
          : {}),
      });
      if (viewportQuery) {
        this._viewportQuery = { ...query };
        delete this._viewportQuery.cursor;
        this._committedMap = {
          center: result.searchArea.center,
          scale: this._mapScale || this.data.mapScale,
        };
      }
      this.refreshMap(!more && !viewportQuery);
    } catch (e) {
      if (this.current(generation) && (!viewportQuery || viewEpoch === this._viewEpoch))
        this.setData({
          loading: false,
          loadingMore: false,
          viewportBusy: false,
          ...(viewportQuery
            ? {
                mapError: ui.message(e),
                viewportDirty: !more,
                ...(e.code === 'CURSOR_SCOPE_MISMATCH'
                  ? { nextCursor: null, viewportDirty: true }
                  : {}),
              }
            : { error: ui.message(e) }),
        });
    }
  },
  searchFilters() {
    const query = { limit: 20 },
      s = this.data.selection;
    if (s.mode === 'REGION')
      Object.assign(query, { regionId: s.regionId, catalogVersion: s.catalogVersion });
    if (this.data.kind) query.kind = this.data.kind;
    if (this.data.q.trim()) query.q = this.data.q.trim();
    return query;
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
    this.resetViewport();
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
      feeRead: false,
      feePreview: null,
      chargeConsent: false,
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
    this.invalidateView(false);
    this.setData({ mapVisible: !this.data.mapVisible });
    this.refreshMap();
  },
  invalidateView(dirty) {
    this._viewEpoch = (this._viewEpoch || 0) + 1;
    this._viewportRead = (this._viewportRead || 0) + 1;
    this.setData({
      viewportBusy: false,
      ...(this._viewportQuery ? { loadingMore: false } : {}),
      ...(dirty ? { viewportDirty: true } : {}),
    });
  },
  resetViewport() {
    this.invalidateView(false);
    this._generation = (this._generation || 0) + 1;
    this._viewportQuery = null;
    this._committedMap = null;
    this._programmaticView = null;
    this._mapMoving = false;
    this.setData({
      loading: false,
      loadingMore: false,
      viewportDirty: false,
      viewportBusy: false,
      viewportMode: false,
      canRestoreArea: false,
      acrossRegions: false,
      mapScopeLabel: '',
      mapError: '',
      nextCursor: null,
    });
  },
  setMapView(center, scale = 13) {
    this.invalidateView(false);
    this._programmaticView = { epoch: this._viewEpoch, until: Date.now() + 1500 };
    this._mapScale = scale;
    this.setData({ mapCenter: center, mapScale: scale });
  },
  regionChanged(e) {
    const detail = e.detail || {},
      phase = detail.type || e.type,
      cause = detail.causedBy || e.causedBy;
    const gesture = cause === 'drag' || cause === 'scale';
    const ownUpdate =
      !gesture &&
      cause === 'update' &&
      this._programmaticView &&
      this._programmaticView.epoch === this._viewEpoch &&
      Date.now() <= this._programmaticView.until;
    if (ownUpdate) {
      if (phase === 'end') this._programmaticView = null;
      return;
    }
    this._programmaticView = null;
    // Even an unknown/update cause invalidates pending responses. Cause only controls the prompt.
    if (phase === 'begin') {
      this._mapMoving = true;
      this.invalidateView(gesture || !!this._viewportQuery);
    } else if (phase === 'end') {
      this._mapMoving = false;
      this.invalidateView(gesture || !!this._viewportQuery);
      if (Number.isFinite(detail.scale)) this._mapScale = detail.scale;
    }
  },
  async searchThisArea() {
    if (
      !this.data.viewportEnabled ||
      !this.data.mapVisible ||
      !this.data.mapCenter ||
      this.data.viewportBusy ||
      this._mapMoving ||
      this._hidden ||
      !this._alive
    )
      return;
    const epoch = this._viewEpoch,
      read = ++this._viewportRead,
      query = this.searchFilters();
    if (this.data.acrossRegions) {
      delete query.regionId;
      delete query.catalogVersion;
    }
    this.setData({ viewportBusy: true, mapError: '' });
    try {
      const snapshot = await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('地图范围读取超时，请停止拖动后重试。')),
          5000,
        );
        const done = (fn) => (value) => {
          clearTimeout(timer);
          fn(value);
        };
        try {
          const context = wx.createMapContext('local-map', this);
          context.getRegion({
            success: (bounds) => {
              if (typeof context.getScale !== 'function')
                return done(resolve)({ bounds, scale: this._mapScale });
              context.getScale({
                success: done((value) => resolve({ bounds, scale: value.scale })),
                fail: done(() => reject(new Error('无法读取地图缩放，请停止拖动后重试。'))),
              });
            },
            fail: done(() => reject(new Error('无法读取地图范围，请重试或返回城市列表。'))),
          });
        } catch (e) {
          clearTimeout(timer);
          reject(new Error('地图组件暂不可用，可返回城市列表继续查找。'));
        }
      });
      if (!this._alive || this._hidden || epoch !== this._viewEpoch || read !== this._viewportRead)
        return;
      const viewport = ls.viewport({
        southwest: snapshot.bounds.southwest,
        northeast: snapshot.bounds.northeast,
        coordinateSystem: 'GCJ02',
      });
      if (Number.isFinite(snapshot.scale)) this._mapScale = snapshot.scale;
      await this.load(false, { ...query, viewport, searchVersion: 2 });
    } catch (e) {
      if (this._alive && !this._hidden && epoch === this._viewEpoch && read === this._viewportRead)
        this.setData({ viewportBusy: false, viewportDirty: true, mapError: ui.message(e) });
    }
  },
  async expandMapScope() {
    const epoch = this._viewEpoch;
    const yes = await ui.confirm(
      '临时搜索地图范围',
      '当前默认只查所选地区与地图的交集。确认后本次按地图范围跨城查找，不修改所选城市、机构或预约地址。',
    );
    if (!yes || !this._alive || this._hidden || epoch !== this._viewEpoch) return;
    this.invalidateView(true);
    this.setData({ acrossRegions: true });
    await this.searchThisArea();
  },
  keepCityScope() {
    this.invalidateView(true);
    this.setData({ acrossRegions: false });
    this.searchThisArea();
  },
  restoreArea() {
    if (!this._committedMap) return;
    this.setMapView(this._committedMap.center, this._committedMap.scale);
    this.setData({
      viewportDirty: false,
      mapError: '',
      acrossRegions: !this._viewportQuery.regionId,
    });
  },
  mapFailed() {
    this.invalidateView(true);
    this.setData({ mapError: '地图暂不可用，已保留上次结果。可返回城市列表继续查找。' });
  },
  cityList() {
    this.setData({ mapVisible: false });
    this.load();
  },
  refreshMap(reset = false) {
    const located = this.data.items.filter((v) => v.point),
      center = this._point || (located[0] && located[0].point) || null;
    this.setData({
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
    if (reset || !this.data.mapCenter) this.setMapView(center);
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
  expansion(e) {
    const key = e.currentTarget.dataset.page;
    if (!this.data.busy && ['matching', 'dispatch', 'training'].includes(key)) ui.open(key);
  },
  players() {
    if (!this.data.busy) ui.open('players');
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
