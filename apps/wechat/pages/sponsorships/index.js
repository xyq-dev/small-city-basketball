const api = require('../../utils/api');
const ui = require('../../utils/ui');
const gov = require('../../utils/governance');
const regions = require('../../utils/regions');
const PATH = '/pages/sponsorships/index';
const initial = () => ({
  mode: 'manage',
  organizations: [],
  orgIndex: 0,
  regions: [],
  regionIndex: 0,
  events: [{ id: null, name: '不限赛事，仅按地区投放' }],
  eventIndex: 0,
  eventQuery: '',
  items: [],
  publicItems: [],
  nextCursor: null,
  selected: null,
  publicCard: null,
  brand: '',
  title: '',
  body: '',
  startDate: '',
  startTime: '00:00',
  endDate: '',
  endTime: '23:59',
  reason: '',
  pending: null,
  busy: false,
  loading: false,
  error: '',
  notice: '',
  loginRequired: false,
  measurementNotice:
    '展示数仅为客户端按发布批次和操作编号去重的上报数，不代表独立人数、真实观看或结算凭证。',
});
function publicCard(v) {
  if (
    !v ||
    typeof v !== 'object' ||
    !/^[A-Za-z0-9_-]{43}$/.test(v.publicKey || '') ||
    v.label !== '广告／赞助' ||
    v.measurement !== 'CLIENT_REPORTED_DEDUPLICATED'
  )
    throw new Error('赞助资料无效');
  return v;
}
function localParts(v) {
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) throw new Error('时段资料无效');
  const z = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()),
    z(d.getHours()) + ':' + z(d.getMinutes()),
  ];
}
Page({
  data: initial(),
  onLoad(q = {}) {
    this._alive = true;
    this._visible = true;
    this._viewReports = new Map();
    try {
      if (q.publicKey) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(q.publicKey)) throw new Error('公开赞助地址无效');
        this._publicKey = q.publicKey;
        this.setData({ mode: 'public' });
      }
      if (q.orgId) this._orgId = gov.id(q.orgId);
      if (q.mode === 'review' || q.mode === 'public') this.setData({ mode: q.mode });
      if (q.eventPublicId) this._eventPublicId = api.publicId(q.eventPublicId);
    } catch (error) {
      this._invalid = true;
      this.setData({ error: ui.message(error) });
    }
  },
  onShow() {
    this._visible = true;
    this.load();
  },
  onHide() {
    this._visible = false;
    ui.close(this);
    this.stopObserver();
    this._viewer = null;
    this._catalog = null;
    const mode = this.data.mode;
    this.setData({ ...initial(), mode });
  },
  onUnload() {
    this._alive = false;
    this.onHide();
  },
  onSessionReset() {
    this.stopObserver();
    this._viewer = null;
    this.setData({
      ...initial(),
      mode: this.data.mode,
      loginRequired: this.data.mode !== 'public',
      notice: '身份变化，已清空旧账号投放资料。',
    });
  },
  login() {
    ui.login(PATH);
  },
  base() {
    const org = this.data.organizations[this.data.orgIndex];
    if (!org) throw new Error('请先选择当前机构');
    return '/v1/orgs/' + gov.id(org.id) + '/sponsorships';
  },
  async load() {
    if (!this._alive || !this._visible || this._invalid || this.data.busy) return;
    const t = ui.begin(this);
    this.stopObserver();
    this.setData({
      loading: true,
      error: '',
      items: [],
      selected: null,
      publicCard: null,
      publicItems: [],
    });
    try {
      if (this.data.mode === 'public') {
        if (this._publicKey) {
          const r = await api
            .getClient()
            .requestPublic('/v1/public/sponsorships/' + this._publicKey);
          if (ui.live(this, t))
            this.setData({ publicCard: publicCard(r.data), loading: false }, () => this.observe());
          return;
        }
        const catalog = await regions.fetchCatalog();
        if (ui.live(this, t)) {
          this._catalog = catalog;
          this.setData({ regions: catalog.nodes, loading: false });
        }
        return;
      }
      const session = await ui.session(this, PATH);
      if (!session || !ui.live(this, t)) return;
      this._viewer = session.user.id;
      const organizations = (session.organizations || []).filter((o) =>
        ['ORG_OWNER', 'ORG_ADMIN'].includes(o.role),
      );
      const orgIndex = this._orgId
        ? Math.max(
            0,
            organizations.findIndex((o) => o.id === this._orgId),
          )
        : Math.min(this.data.orgIndex, Math.max(0, organizations.length - 1));
      this.setData({ organizations, orgIndex, pending: gov.readPending(this._viewer, 'SPONSOR') });
      if (this.data.mode === 'review') {
        const v = gov.page(await gov.request(api.getClient(), '/v1/me/sponsorships/review-queue'));
        if (ui.live(this, t)) this.setData({ ...v, loading: false });
        return;
      }
      if (!organizations.length) {
        this.setData({ loading: false, error: '当前没有可维护投放的机构管理员权限。' });
        return;
      }
      const [raw, options, catalog] = await Promise.all([
        gov.request(api.getClient(), this.base()),
        gov.request(api.getClient(), this.base() + '/options'),
        regions.fetchCatalog(),
      ]);
      if (!ui.live(this, t)) return;
      this._catalog = catalog;
      this.setData({
        ...gov.page(raw),
        events: [{ id: null, name: '不限赛事，仅按地区投放' }].concat(options.events || []),
        regions: catalog.nodes,
        loading: false,
      });
    } catch (error) {
      if (ui.live(this, t)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  mode(e) {
    if (this.data.busy) return;
    this.stopObserver();
    this._publicKey = null;
    this.setData({ mode: e.currentTarget.dataset.mode, selected: null });
    this.load();
  },
  org(e) {
    if (this.data.busy) return;
    this._orgId = null;
    this.setData({ orgIndex: Number(e.detail.value) || 0 });
    this.load();
  },
  picker(e) {
    const f = e.currentTarget.dataset.field;
    if (['regionIndex', 'eventIndex'].includes(f))
      this.setData({ [f]: Number(e.detail.value) || 0 });
  },
  field(e) {
    const f = e.currentTarget.dataset.field;
    if (
      !this.data.busy &&
      [
        'brand',
        'title',
        'body',
        'startDate',
        'startTime',
        'endDate',
        'endTime',
        'reason',
        'eventQuery',
      ].includes(f)
    )
      this.setData({ [f]: String(e.detail.value || '') });
  },
  edit(e) {
    if (this.data.busy) return;
    const row = this.data.items.find((i) => i.id === e.currentTarget.dataset.id);
    if (!row) return;
    let fields = { selected: row };
    if (this.data.mode === 'manage') {
      if (row.eventId && !this.data.events.some((event) => event.id === row.eventId))
        this.setData({
          events: this.data.events.concat({ id: row.eventId, name: '保持当前已关联赛事' }),
        });
      const [startDate, startTime] = localParts(row.startsAt),
        [endDate, endTime] = localParts(row.endsAt);
      fields = {
        ...fields,
        brand: row.brand,
        title: row.title,
        body: row.body,
        startDate,
        startTime,
        endDate,
        endTime,
        regionIndex:
          this._catalog?.version === row.region.catalogVersion
            ? this.data.regions.findIndex((r) => r.id === row.region.regionId)
            : -1,
        eventIndex: Math.max(
          0,
          this.data.events.findIndex((r) => r.id === row.eventId),
        ),
      };
    }
    this.setData(fields);
  },
  fresh() {
    if (this.data.busy) return;
    this.setData({ selected: null, brand: '', title: '', body: '', reason: '' });
  },
  async searchEvents() {
    if (this.data.busy) return;
    const token = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      const raw = await gov.request(
        api.getClient(),
        this.base() +
          '/options' +
          (this.data.eventQuery ? '?query=' + encodeURIComponent(this.data.eventQuery) : ''),
      );
      if (ui.held(this, token)) {
        if (!Array.isArray(raw.events) || raw.events.length > 100) throw new Error('赛事目录无效');
        this.setData({
          events: [{ id: null, name: '不限赛事，仅按地区投放' }].concat(raw.events),
          eventIndex: -1,
          notice: '已更新赛事候选，请明确选择投放目标；每次最多100项。',
        });
      }
    } catch (error) {
      if (ui.held(this, token)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async save() {
    try {
      const selected = this.data.selected;
      if (selected && !['DRAFT', 'REJECTED'].includes(selected.status))
        throw new Error('提交审核后投放条件不可编辑，请创建新投放。');
      const node = this.data.regions[this.data.regionIndex],
        event = this.data.events[this.data.eventIndex];
      if (!node || !event || !this._catalog) throw new Error('请从当前目录选择地区与赛事');
      const start = new Date(this.data.startDate + 'T' + this.data.startTime + ':00'),
        end = new Date(this.data.endDate + 'T' + this.data.endTime + ':00');
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
        throw new Error('请选择有效的本机当地起止日期时间');
      const body = {
        region: { catalogVersion: this._catalog.version, regionId: node.id },
        eventId: event.id,
        brand: this.data.brand,
        title: this.data.title,
        body: this.data.body,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        ...(selected ? { expectedVersion: selected.version } : {}),
      };
      const r = await gov.perform(
        this,
        'SPONSOR',
        this.base() + (selected ? '/' + selected.id : ''),
        body,
        {
          method: selected ? 'PUT' : 'POST',
          title: '保存广告草稿',
          content: '投放地区、赛事和时间按当前内容提交；审核前不会公开。',
        },
      );
      if (r) {
        this.fresh();
        await this.load();
      }
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  async command(e) {
    const row = this.data.selected;
    if (!row) return;
    const type = e.currentTarget.dataset.type;
    try {
      const reviewing = this.data.mode === 'review';
      const r = await gov.perform(
        this,
        'SPONSOR',
        reviewing
          ? '/v1/me/sponsorships/' + row.id + '/commands'
          : this.base() + '/' + row.id + '/commands',
        {
          expectedVersion: row.version,
          type,
          reason: this.data.reason,
          ...(reviewing ? { orgId: row.orgId } : {}),
        },
        {
          title: '确认投放操作',
          content:
            type === 'PUBLISH'
              ? '仅在审核通过、机构有效、定向赛事仍公开及有效投放时间内展示。'
              : type === 'REVOKE_PUBLICATION' || type === 'WITHDRAW'
                ? '当前公开地址将永久失效，重新发布会创建新地址。'
                : '提交后服务端重新核对独立审核权限与当前版本。',
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
          (this.data.mode === 'review' ? '/v1/me/sponsorships/review-queue' : this.base()) +
            '?before=' +
            gov.id(this.data.nextCursor),
        ),
      );
      if (ui.held(this, t))
        this.setData({ items: this.data.items.concat(v.items), nextCursor: v.nextCursor || null });
    } catch (error) {
      if (ui.held(this, t)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async discover() {
    if (this.data.busy) return;
    const t = ui.hold(this);
    this.setData({ busy: true, error: '', publicCard: null, publicItems: [] });
    this.stopObserver();
    try {
      const node = this.data.regions[this.data.regionIndex];
      if (!node || !this._catalog) throw new Error('请从目录选择地区');
      const path =
        '/v1/public/sponsorships?regionId=' +
        node.id +
        '&catalogVersion=' +
        encodeURIComponent(this._catalog.version) +
        (this._eventPublicId ? '&eventPublicId=' + this._eventPublicId : '');
      const r = await api.getClient().requestPublic(path);
      if (!r.data || !Array.isArray(r.data.items) || r.data.items.length > 100)
        throw new Error('赞助列表无效');
      const items = r.data.items.map(publicCard);
      if (ui.held(this, t))
        this.setData({
          publicItems: items,
          notice: r.data.truncated
            ? '仅显示有界结果，请缩小投放范围或稍后查询。'
            : items.length
              ? '已读取当前地区可展示投放。'
              : '当前地区和时段没有可展示投放。',
        });
    } catch (error) {
      if (ui.held(this, t)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  openPublic(e) {
    const key = e.currentTarget.dataset.key || this.data.selected?.publicKey;
    if (/^[A-Za-z0-9_-]{43}$/.test(key || '')) wx.navigateTo({ url: PATH + '?publicKey=' + key });
  },
  observe() {
    this.stopObserver();
    if (
      !this._visible ||
      !this.data.publicCard ||
      typeof wx.createIntersectionObserver !== 'function'
    )
      return;
    const key = this.data.publicCard.publicKey,
      token = ui.guard(this);
    const observer = wx.createIntersectionObserver(this, { thresholds: [0.5] });
    this._observer = observer;
    observer.relativeToViewport().observe('#sponsor-public-card', (r) => {
      if (
        r.intersectionRatio >= 0.5 &&
        this._visible &&
        ui.held(this, token) &&
        this.data.publicCard?.publicKey === key
      ) {
        observer.disconnect();
        this.report(key, token).catch(() => {});
      }
    });
  },
  stopObserver() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  },
  async report(key, token) {
    let record = this._viewReports.get(key);
    if (record?.sent || record?.inflight) return;
    if (!record) {
      record = { commandId: null, sent: false };
      this._viewReports.set(key, record);
    }
    record.inflight = true;
    try {
      if (!record.commandId) {
        const commandId = await ui.uuid();
        if (!this._visible || !ui.held(this, token)) return;
        record.commandId = commandId;
      }
      await api
        .getClient()
        .request(
          '/v1/public/sponsorships/' + key + '/impressions',
          'POST',
          { commandId: record.commandId },
          true,
        );
      record.sent = true;
    } catch {
    } finally {
      record.inflight = false;
    }
  },
  async recover(e) {
    try {
      const r = await gov.recover(this, 'SPONSOR', e.currentTarget.dataset.cancel === 'true');
      if (r) await this.load();
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  onShareAppMessage() {
    const key = this._publicKey;
    return key
      ? {
          title: '广告／赞助 · ' + (this.data.publicCard?.brand || ''),
          path: PATH + '?publicKey=' + key,
        }
      : { title: '赛事广告与赞助', path: PATH + '?mode=public' };
  },
});
