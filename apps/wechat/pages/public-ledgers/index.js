const api = require('../../utils/api');
const ui = require('../../utils/ui');
const gov = require('../../utils/governance');
const ledger = require('../../utils/public-ledger');
const PATH = '/pages/public-ledgers/index';
const initial = () => ({
  organizations: [],
  orgIndex: 0,
  teams: [{ id: null, name: '机构／公益线下账目' }],
  teamIndex: 0,
  teamQuery: '',
  items: [],
  nextCursor: null,
  selected: null,
  publicSnapshot: null,
  isPublic: false,
  title: '',
  description: '',
  authorizationConfirmed: false,
  entryKinds: ['收入记录', '支出记录', '冲销已审批记录'],
  kindIndex: 0,
  occurredOn: '',
  label: '',
  amount: '',
  reversalIndex: 0,
  reason: '',
  publicConsent: false,
  pending: null,
  busy: false,
  loading: false,
  error: '',
  notice: '',
  loginRequired: false,
});
Page({
  data: initial(),
  onLoad(q = {}) {
    this._alive = true;
    this._visible = true;
    try {
      if (q.publicKey) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(q.publicKey)) throw new Error('经费公示地址无效');
        this._publicKey = q.publicKey;
        this.setData({ isPublic: true });
      }
      if (q.orgId) this._orgId = gov.id(q.orgId);
      if (q.accountId) this._accountId = gov.id(q.accountId);
    } catch (error) {
      this._invalid = true;
      this.setData({ error: ui.message(error) });
    }
  },
  onShow() {
    this._visible = true;
    this.load();
    if (this._publicKey && !this._timer)
      this._timer = setInterval(() => {
        if (this._visible && !this.data.busy && !this.data.loading) this.load();
      }, 15000);
  },
  onHide() {
    this._visible = false;
    ui.close(this);
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._viewer = null;
    this.setData({ ...initial(), isPublic: !!this._publicKey });
  },
  onUnload() {
    this._alive = false;
    this.onHide();
  },
  onSessionReset() {
    this._viewer = null;
    this._accountId = null;
    this._orgId = null;
    this.setData({
      ...initial(),
      isPublic: !!this._publicKey,
      loginRequired: !this._publicKey,
      notice: '身份变化，已清空旧账号的账目与表单。',
    });
  },
  login() {
    ui.login(PATH);
  },
  base() {
    const org = this.data.organizations[this.data.orgIndex];
    if (!org) throw new Error('请选择当前授权机构');
    return '/v1/orgs/' + gov.id(org.id) + '/public-ledgers';
  },
  async load() {
    if (!this._alive || !this._visible || this._invalid || this.data.busy) return;
    const t = ui.begin(this);
    this.setData({ loading: true, error: '', items: [], selected: null, publicSnapshot: null });
    try {
      if (this._publicKey) {
        const response = await api
          .getClient()
          .requestPublic('/v1/public/ledgers/' + this._publicKey);
        if (ui.live(this, t))
          this.setData({ publicSnapshot: ledger.snapshot(response.data), loading: false });
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
      this.setData({ organizations, orgIndex, pending: gov.readPending(this._viewer, 'LEDGER') });
      if (!organizations.length) {
        this.setData({ loading: false, error: '当前没有授权的机构管理员账目权限。' });
        return;
      }
      const [raw, options] = await Promise.all([
        gov.request(api.getClient(), this.base()),
        gov.request(api.getClient(), this.base() + '/options'),
      ]);
      if (!ui.live(this, t)) return;
      const v = gov.page(raw);
      this.setData({
        ...v,
        items: v.items.map((i) => ({ ...i, netLabel: ledger.money(i.approvedNetFen) })),
        teams: [{ id: null, name: '机构／公益线下账目' }].concat(options.teams || []),
        loading: false,
      });
      if (this._accountId) await this.selectId(this._accountId);
    } catch (error) {
      if (ui.live(this, t)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  org(e) {
    if (this.data.busy) return;
    this._accountId = null;
    this._orgId = null;
    this.setData({ orgIndex: Number(e.detail.value) || 0 });
    this.load();
  },
  picker(e) {
    const f = e.currentTarget.dataset.field;
    if (['teamIndex', 'kindIndex', 'reversalIndex'].includes(f) && !this.data.busy)
      this.setData({ [f]: Number(e.detail.value) || 0 });
  },
  field(e) {
    const f = e.currentTarget.dataset.field;
    if (
      !this.data.busy &&
      ['teamQuery', 'title', 'description', 'occurredOn', 'label', 'amount', 'reason'].includes(f)
    )
      this.setData({ [f]: String(e.detail.value || '') });
  },
  consent(e) {
    const f = e.currentTarget.dataset.field;
    if (['authorizationConfirmed', 'publicConsent'].includes(f) && !this.data.busy)
      this.setData({ [f]: !!e.detail.value });
  },
  select(e) {
    return this.selectId(e.currentTarget.dataset.id);
  },
  async selectId(id) {
    if (this.data.busy || !this._visible) return;
    const t = ui.begin(this);
    this.setData({ loading: true, selected: null, error: '', publicConsent: false });
    try {
      const row = ledger.account(
        await gov.request(api.getClient(), this.base() + '/' + gov.id(id)),
      );
      if (ui.live(this, t)) {
        this._accountId = row.id;
        this.setData({ selected: row, loading: false, reversalIndex: 0 });
      }
    } catch (error) {
      if (ui.live(this, t)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  fresh() {
    if (this.data.busy) return;
    this._accountId = null;
    this.setData({
      selected: null,
      title: '',
      description: '',
      authorizationConfirmed: false,
      publicConsent: false,
    });
  },
  async searchTeams() {
    if (this.data.busy) return;
    const t = ui.hold(this);
    this.setData({ busy: true, error: '' });
    try {
      const r = await gov.request(
        api.getClient(),
        this.base() +
          '/options' +
          (this.data.teamQuery ? '?query=' + encodeURIComponent(this.data.teamQuery) : ''),
      );
      if (ui.held(this, t) && Array.isArray(r.teams))
        this.setData({
          teams: [{ id: null, name: '机构／公益线下账目' }].concat(r.teams),
          teamIndex: 0,
          notice: r.truncated ? '候选超过100项，请缩小球队名称。' : '已读取当前机构球队候选。',
        });
    } catch (error) {
      if (ui.held(this, t)) this.setData({ error: ui.message(error) });
    } finally {
      if (ui.held(this, t)) this.setData({ busy: false });
    }
  },
  async create() {
    if (!this.data.authorizationConfirmed) {
      this.setData({ error: '须确认本次仅记录已经获得授权的线下账目。' });
      return;
    }
    try {
      const team = this.data.teams[this.data.teamIndex];
      if (!team) throw new Error('请从当前授权机构选择账本范围');
      const r = await gov.perform(
        this,
        'LEDGER',
        this.base(),
        {
          teamId: team.id,
          title: this.data.title,
          description: this.data.description,
          authorizationConfirmed: true,
        },
        {
          title: '创建线下账目记录',
          content:
            '只记录已获授权的线下收支，不产生钱包、支付余额、募款或提现。另一名管理员独立审批和公示。',
        },
      );
      if (r) {
        this._accountId = r.id;
        this.setData({ title: '', description: '', authorizationConfirmed: false });
        await this.load();
      }
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  async add() {
    const account = this.data.selected;
    if (!account || account.status !== 'ACTIVE') return;
    try {
      const kind = ['INCOME', 'EXPENSE', 'REVERSAL'][this.data.kindIndex];
      const original = account.reversible[this.data.reversalIndex];
      if (kind === 'REVERSAL' && !original) throw new Error('请选择本账本尚未冲销的已审批原记录');
      const amountFen =
        kind === 'REVERSAL'
          ? -original.amountFen
          : ledger.fen(this.data.amount) * (kind === 'EXPENSE' ? -1 : 1);
      const r = await gov.perform(
        this,
        'LEDGER',
        this.base() + '/' + account.id + '/entries',
        {
          expectedVersion: account.version,
          occurredOn: this.data.occurredOn,
          label: this.data.label,
          kind,
          amountFen,
          ...(kind === 'REVERSAL' ? { reversesEntryId: original.id } : {}),
        },
        {
          title: '追加待审批账目',
          content:
            kind === 'REVERSAL'
              ? '原事实不会删除或改写；追加精确反向冲销，由另一名管理员审批。'
              : '该记录需另一名当前授权管理员独立核对后才进入公示快照。',
        },
      );
      if (r) {
        this.setData({ label: '', amount: '' });
        await this.selectId(account.id);
      }
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  async command(e) {
    const account = this.data.selected;
    if (!account) return;
    const type = e.currentTarget.dataset.type;
    const entry = account.entries.find((i) => i.id === e.currentTarget.dataset.id);
    if (['APPROVE_ENTRY', 'REJECT_ENTRY'].includes(type) && !entry) return;
    try {
      if (type === 'PUBLISH' && !this.data.publicConsent)
        throw new Error('请先核对公示内容并明确同意公开本次快照。');
      const r = await gov.perform(
        this,
        'LEDGER',
        this.base() + '/' + account.id + '/commands',
        {
          expectedVersion: account.version,
          type,
          reason: this.data.reason,
          ...(entry ? { entryId: entry.id, entryVersion: entry.version } : {}),
          ...(type === 'PUBLISH' ? { publicConsent: true } : {}),
        },
        {
          title:
            type === 'PUBLISH'
              ? '审批后公示当前快照'
              : type === 'CLOSE'
                ? '永久关闭账本'
                : '确认账目操作',
          content:
            type === 'PUBLISH'
              ? '仅公开审批通过的日期、摘要、金额和冲销关系。旧公示地址永久失效；账面差额不是支付余额。'
              : type === 'CLOSE'
                ? '当前公开地址将永久失效，不能继续追加或恢复本账本。'
                : '服务端重新核对当前机构权限、独立审批和版本；原账目不直接改写。',
        },
      );
      if (r) {
        this.setData({ reason: '', publicConsent: false });
        await this.selectId(account.id);
      }
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
        await gov.request(api.getClient(), this.base() + '?before=' + gov.id(this.data.nextCursor)),
      );
      if (ui.held(this, t))
        this.setData({
          items: this.data.items.concat(
            v.items.map((i) => ({ ...i, netLabel: ledger.money(i.approvedNetFen) })),
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
      const r = await gov.recover(this, 'LEDGER', e.currentTarget.dataset.cancel === 'true');
      if (r) {
        if (r.accountId || r.id) this._accountId = r.accountId || r.id;
        await this.load();
      }
    } catch (error) {
      if (this._visible) this.setData({ error: ui.message(error) });
    }
  },
  openPublic() {
    const key = this.data.selected?.publicKey;
    if (/^[A-Za-z0-9_-]{43}$/.test(key || '')) wx.navigateTo({ url: PATH + '?publicKey=' + key });
  },
  onShareAppMessage() {
    return this._publicKey
      ? { title: '授权线下账目公示', path: PATH + '?publicKey=' + this._publicKey }
      : { title: '线下账目记录', path: PATH };
  },
});
