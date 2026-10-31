const api = require('../../utils/api');
const ui = require('../../utils/ui');
const gov = require('../../utils/governance');
const PATH = '/pages/governance-reviews/index';
const initial = () => ({
  items: [],
  nextCursor: null,
  mode: 'mine',
  isOperator: false,
  sourceReady: false,
  isPublic: false,
  score: 5,
  scores: ['1分', '2分', '3分', '4分', '5分'],
  body: '',
  reason: '',
  publicConsent: false,
  pending: null,
  busy: false,
  loading: false,
  error: '',
  notice: '',
  loginRequired: false,
  publicReview: null,
});
Page({
  data: initial(),
  onLoad(q = {}) {
    this._alive = true;
    this._visible = true;
    try {
      if (q.publicKey) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(q.publicKey)) throw new Error('公开评价地址无效');
        this._publicKey = q.publicKey;
        this.setData({ isPublic: true });
      } else if (['PLAYER_BOOKING', 'LOCAL_BOOKING'].includes(q.sourceKind) && q.sourceId) {
        this._source = { sourceKind: q.sourceKind, sourceId: gov.id(q.sourceId) };
        this.setData({ sourceReady: true });
      }
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
    this._viewer = null;
    this.setData({ ...initial(), sourceReady: !!this._source, isPublic: !!this._publicKey });
  },
  onUnload() {
    this._alive = false;
    this.onHide();
  },
  onSessionReset() {
    this._viewer = null;
    this.setData({
      ...initial(),
      loginRequired: true,
      sourceReady: !!this._source,
      notice: '身份变化，已清空旧账号评价资料。',
    });
  },
  login() {
    ui.login(PATH);
  },
  async load() {
    if (!this._alive || this._invalid || this.data.busy) return;
    const t = ui.begin(this);
    this.setData({ loading: true, error: '', items: [], publicReview: null });
    try {
      if (this._publicKey) {
        const r = await api
          .getClient()
          .requestPublic('/v1/public/governance/reviews/' + this._publicKey);
        if (ui.live(this, t)) this.setData({ publicReview: gov.result(r.data), loading: false });
        return;
      }
      const session = await ui.session(this, PATH);
      if (!session || !ui.live(this, t)) return;
      this._viewer = session.user.id;
      const mode = this.data.mode === 'platform' && session.platformOperator ? 'platform' : 'mine';
      const value = gov.page(
        await gov.request(
          api.getClient(),
          mode === 'platform' ? '/v1/platform/governance/reviews' : '/v1/me/governance/reviews',
        ),
      );
      if (ui.live(this, t))
        this.setData({
          items: value.items,
          nextCursor: value.nextCursor || null,
          mode,
          isOperator: !!session.platformOperator,
          pending: gov.readPending(this._viewer, 'REVIEW'),
          loading: false,
          sourceReady: !!this._source,
        });
    } catch (error) {
      if (ui.live(this, t)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  mode(e) {
    if (this.data.busy) return;
    this.setData({ mode: e.currentTarget.dataset.mode });
    this.load();
  },
  field(e) {
    if (!this.data.busy && ['body', 'reason'].includes(e.currentTarget.dataset.field))
      this.setData({ [e.currentTarget.dataset.field]: String(e.detail.value || '') });
  },
  score(e) {
    this.setData({ score: Number(e.detail.value) + 1 });
  },
  consent(e) {
    this.setData({ publicConsent: !!e.detail.value });
  },
  async create() {
    if (!this._source || !this.data.publicConsent) {
      this.setData({ error: '请从已完成订单进入，并明确同意公开评价内容。' });
      return;
    }
    try {
      const r = await gov.perform(
        this,
        'REVIEW',
        '/v1/me/governance/reviews',
        { ...this._source, score: this.data.score, body: this.data.body, publicConsent: true },
        {
          title: '提交真实服务评价',
          content: '服务端核对真实完成记录，审核后公开内容；不会公开账号或订单编号。',
        },
      );
      if (r) {
        this.setData({ body: '', publicConsent: false });
        await this.load();
      }
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  async command(e) {
    const row = this.data.items.find((i) => i.id === e.currentTarget.dataset.id);
    if (!row) return;
    try {
      const r = await gov.perform(
        this,
        'REVIEW',
        '/v1/me/governance/reviews/' + row.id + '/commands',
        {
          expectedVersion: row.version,
          type: e.currentTarget.dataset.type,
          reason: this.data.reason,
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
      const value = gov.page(
        await gov.request(
          api.getClient(),
          (this.data.mode === 'platform'
            ? '/v1/platform/governance/reviews'
            : '/v1/me/governance/reviews') +
            '?before=' +
            gov.id(this.data.nextCursor),
        ),
      );
      if (ui.held(this, t))
        this.setData({
          items: this.data.items.concat(value.items),
          nextCursor: value.nextCursor || null,
        });
    } catch (error) {
      if (ui.held(this, t)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async recover(e) {
    try {
      const r = await gov.recover(this, 'REVIEW', e.currentTarget.dataset.cancel === 'true');
      if (r) await this.load();
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  publicLink(e) {
    const row = this.data.items.find((i) => i.id === e.currentTarget.dataset.id);
    if (row?.status === 'PUBLISHED' && /^[A-Za-z0-9_-]{43}$/.test(row.publicKey))
      wx.navigateTo({ url: PATH + '?publicKey=' + row.publicKey });
  },
  onShareAppMessage() {
    return this._publicKey
      ? { title: '真实服务参与评价', path: PATH + '?publicKey=' + this._publicKey }
      : { title: '服务评价', path: PATH };
  },
});
