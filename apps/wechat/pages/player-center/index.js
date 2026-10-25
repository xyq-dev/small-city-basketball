const sdk = require('../../utils/booking');
const ui = require('../../utils/ui');
const api = require('../../utils/api');
const model = require('../../utils/player-center');

const returnPath = '/pages/player-center/index';
const fields = ['displayName', 'heightCm', 'city', 'bio', 'price', 'travel', 'accommodation'];
Page({
  data: {
    authorized: false,
    loginRequired: false,
    loading: false,
    busy: false,
    pending: false,
    pendingInFlight: false,
    error: '',
    message: '',
    profile: null,
    editing: false,
    editorSection: 'PROFILE',
    dirty: false,
    form: model.formFromProfile(null),
    positions: ['控球后卫 PG', '得分后卫 SG', '小前锋 SF', '大前锋 PF', '中锋 C'],
    positionIndex: 0,
    quote: null,
    feeText: '',
  },
  onShow() {
    this._hidden = false;
    this.load();
  },
  onHide() {
    this._hidden = true;
    this._life = (this._life || 0) + 1;
    ui.begin(this);
    this.setData({ loading: false, busy: false });
  },
  onUnload() {
    this._closed = true;
    this._life = (this._life || 0) + 1;
    ui.close(this);
  },
  active(token) {
    if (this._hidden || this._closed) return false;
    if (this._revision !== undefined && this._revision !== api.getClient().sessionRevision()) {
      this._actor = null;
      this._profile = null;
      this._pending = null;
      this.setData({
        authorized: false,
        profile: null,
        form: model.formFromProfile(null),
        dirty: false,
        pending: false,
        busy: false,
        quote: null,
      });
      return false;
    }
    return ui.live(this, token);
  },
  async load(force) {
    const life = (this._life = (this._life || 0) + 1);
    this.setData({ authorized: false, loading: true, error: '' });
    const session = await ui.session(this, returnPath);
    if (this._closed || this._hidden || life !== this._life) return;
    if (!session) {
      this._actor = null;
      this._profile = null;
      this._pending = null;
      this.setData({
        loading: false,
        profile: null,
        form: model.formFromProfile(null),
        dirty: false,
        pending: false,
        busy: false,
      });
      return;
    }
    const actor = session.user.id;
    const revision = api.getClient().sessionRevision();
    const changed =
      actor !== this._actor || (this._revision !== undefined && this._revision !== revision);
    this._revision = revision;
    if (changed) {
      this._actor = actor;
      this._profile = null;
      this._pending = null;
      this.setData({
        profile: null,
        form: model.formFromProfile(null),
        dirty: false,
        pending: false,
        busy: false,
        editing: false,
        message: '',
      });
    } else if (force !== true && (this.data.dirty || this._pending)) {
      this.setData({
        authorized: true,
        loginRequired: false,
        loading: false,
        pending: !!this._pending,
        pendingInFlight: !!(this._pending && this._pending.inFlight),
        busy: false,
      });
      return;
    }
    const token = ui.begin(this);
    try {
      const workspace = await sdk.workspace();
      if (!this.active(token)) return;
      if (workspace.viewerUserId !== actor) throw new Error('当前账号已变化，请重新读取本人资料');
      this._feeBps = workspace.settings.feeBps;
      this._profile = workspace.ownProfile;
      const profile = this.decorateProfile(workspace.ownProfile);
      const form = model.formFromProfile(workspace.ownProfile);
      this.setData({
        authorized: true,
        loginRequired: false,
        loading: false,
        profile,
        form,
        positionIndex: model.positions.indexOf(form.position),
        editing: !profile,
        dirty: false,
        pending: false,
        busy: false,
        feeText: String(workspace.settings.feeBps / 100) + '%',
      });
      this.updateQuote(form);
    } catch (error) {
      if (this.active(token)) {
        this._profile = null;
        this.setData({
          authorized: false,
          loading: false,
          profile: null,
          quote: null,
          error: ui.message(error),
          busy: false,
        });
      }
    }
  },
  decorateProfile(profile) {
    if (!profile) return null;
    return {
      ...profile,
      statusText: model.statusLabels[profile.status],
      positionText: ui.position(profile.position),
      priceText: ui.money(profile.priceFen),
      windowCount: profile.availability.length,
    };
  },
  login() {
    ui.login(returnPath);
  },
  async refresh() {
    if (this.data.busy || this._pending) return;
    if (
      this.data.dirty &&
      !(await ui.confirm(
        '放弃未保存的资料？',
        '刷新会重新读取本人资料，当前尚未提交的编辑会被放弃。',
      ))
    )
      return;
    this.setData({ dirty: false, editing: false });
    this.load(true);
  },
  edit(e) {
    if (!this.data.authorized || this.data.busy || this._pending) return;
    const form = model.formFromProfile(this._profile);
    this.setData({
      editing: true,
      editorSection:
        e && e.currentTarget && e.currentTarget.dataset.section === 'AVAILABILITY'
          ? 'AVAILABILITY'
          : 'PROFILE',
      dirty: false,
      form,
      positionIndex: model.positions.indexOf(form.position),
      error: '',
      message: '',
    });
    this.updateQuote(form);
  },
  editSection(e) {
    if (!this.data.authorized || !this.data.editing || this.data.busy || this._pending) return;
    const section = e.currentTarget.dataset.section;
    if (['PROFILE', 'FEES', 'AVAILABILITY'].includes(section))
      this.setData({ editorSection: section });
  },
  async cancelEdit() {
    if (this.data.busy || this._pending) return;
    if (
      this.data.dirty &&
      !(await ui.confirm('放弃当前编辑？', '已提交的服务资料与已有预约不会因此改变。'))
    )
      return;
    this.setData({
      dirty: false,
      editing: !this._profile,
      form: model.formFromProfile(this._profile),
      error: '',
    });
  },
  input(e) {
    if (this.data.busy || this._pending || !this.data.authorized) return;
    const field = e.currentTarget.dataset.field;
    if (!fields.includes(field)) return;
    const form = { ...this.data.form, [field]: String(e.detail.value), adultConfirmed: false };
    this.setData({ form, dirty: true, error: '' });
    this.updateQuote(form);
  },
  position(e) {
    if (this.data.busy || this._pending) return;
    const index = Number(e.detail.value);
    if (!Number.isInteger(index) || !model.positions[index]) return;
    const form = { ...this.data.form, position: model.positions[index], adultConfirmed: false };
    this.setData({ form, positionIndex: index, dirty: true });
  },
  consent(e) {
    if (this.data.busy || this._pending) return;
    const form = {
      ...this.data.form,
      adultConfirmed: Array.isArray(e.detail.value) && e.detail.value.includes('yes'),
    };
    this.setData({ form, dirty: true });
  },
  addWindow() {
    if (this.data.busy || this._pending || this.data.form.availability.length >= 60) return;
    const date = ui.today();
    const key = 'draft-' + (this._windowKey = (this._windowKey || 0) + 1);
    const availability = this.data.form.availability.concat({
      key,
      startDate: date,
      startTime: '18:00',
      endDate: date,
      endTime: '22:00',
    });
    this.setData({ form: { ...this.data.form, availability, adultConfirmed: false }, dirty: true });
  },
  removeWindow(e) {
    if (this.data.busy || this._pending) return;
    const index = Number(e.currentTarget.dataset.index);
    const availability = this.data.form.availability.filter((_, i) => i !== index);
    this.setData({ form: { ...this.data.form, availability, adultConfirmed: false }, dirty: true });
  },
  windowInput(e) {
    if (this.data.busy || this._pending) return;
    const { field, index: rawIndex } = e.currentTarget.dataset;
    const index = Number(rawIndex);
    if (
      !['startDate', 'startTime', 'endDate', 'endTime'].includes(field) ||
      !this.data.form.availability[index]
    )
      return;
    const availability = this.data.form.availability.map((w, i) =>
      i === index ? { ...w, [field]: e.detail.value } : w,
    );
    this.setData({ form: { ...this.data.form, availability, adultConfirmed: false }, dirty: true });
  },
  updateQuote(form) {
    const q = model.quote(form, this._feeBps || 0);
    this.setData({
      quote: q
        ? {
            service: ui.money(q.service),
            travel: ui.money(q.travel),
            accommodation: ui.money(q.accommodation),
            platform: ui.money(q.platform),
            total: ui.money(q.total),
          }
        : null,
    });
  },
  async save() {
    if (this.data.busy || !this.data.authorized || (this._pending && this._pending.inFlight))
      return;
    const actor = this._actor,
      token = ui.begin(this);
    let pending = this._pending;
    this.setData({ busy: true, error: '', message: '' });
    try {
      if (!pending) {
        model.profileInput(this.data.form, this._profile ? this._profile.version : 0, 'validation');
        const id = await ui.uuid();
        if (!this.active(token) || this._actor !== actor) return;
        pending = {
          actor,
          payload: model.profileInput(
            this.data.form,
            this._profile ? this._profile.version : 0,
            id,
          ),
          inFlight: false,
        };
        this._pending = pending;
      }
      if (pending.actor !== actor) throw new Error('不能重放其他账号的资料提交');
      pending.inFlight = true;
      this.setData({ pending: true, pendingInFlight: true });
      const saved = await sdk.saveProfile(pending.payload);
      if (!this.active(token) || this._actor !== actor) return;
      if (saved.userId !== actor) throw new Error('返回的本人资料不一致，请重新登录');
      this._profile = saved;
      this._pending = null;
      const form = model.formFromProfile(saved);
      this.setData({
        profile: this.decorateProfile(saved),
        form,
        positionIndex: model.positions.indexOf(form.position),
        editing: false,
        dirty: false,
        pending: false,
        pendingInFlight: false,
        message: '本人资料已保存。公开状态以当前审核结果为准。',
      });
      this.updateQuote(form);
    } catch (error) {
      if (this.active(token) && this._actor === actor) {
        if (Number(error.status) >= 400 && Number(error.status) < 500) this._pending = null;
        this.setData({
          error: ui.message(error),
          pending: !!this._pending,
          pendingInFlight: false,
          message: this._pending
            ? '原提交结果待核对；请用原操作继续核对，不会另换编号重复提交。'
            : '',
        });
      }
    } finally {
      if (pending) pending.inFlight = false;
      if (
        pending &&
        this._pending === pending &&
        !this._hidden &&
        !this._closed &&
        this._actor === actor &&
        this._revision === api.getClient().sessionRevision()
      )
        this.setData({ busy: false, pendingInFlight: false });
      if (this.active(token) && this._actor === actor)
        this.setData({ busy: false, pendingInFlight: false });
    }
  },
  account() {
    ui.open('account');
  },
  received() {
    ui.open('bookings', { view: 'received' });
  },
  performance() {
    ui.open('performance', { own: '1' });
  },
});
