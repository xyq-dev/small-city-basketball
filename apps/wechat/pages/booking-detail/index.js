const ui = require('../../utils/ui');
const sdk = require('../../utils/booking');
const model = require('../../utils/booking-orders');
const PROBE_ID = '00000000-0000-4000-8000-000000000000';
Page({
  data: {
    orderId: '',
    order: null,
    loading: false,
    busy: false,
    loginRequired: false,
    error: '',
    message: '',
    form: null,
    formFields: null,
    formConfirmed: false,
    canSubmit: false,
    validation: '',
    selected: null,
    pending: null,
    pendingAcknowledged: false,
    resolutionLabels: model.RESOLUTION_LABELS,
  },
  onLoad(query) {
    try {
      this.orderId = model.id(query && (query.id || query.orderId));
      this.setData({ orderId: this.orderId });
      this.view = query && query.view === 'received' ? 'received' : 'sent';
    } catch (error) {
      this.setData({ error: ui.message(error) });
    }
  },
  onShow() {
    this.hidden = false;
    this.visit = (this.visit || 0) + 1;
    this.setData({ busy: false });
    if (this.orderId) this.load();
  },
  onHide() {
    this.hidden = true;
    this.visit = (this.visit || 0) + 1;
    this.clearPrivate();
  },
  onUnload() {
    this.hidden = true;
    this.clearPrivate();
    ui.close(this);
  },
  active(token, visit) {
    return !this.hidden && this.visit === visit && ui.live(this, token);
  },
  clearPrivate() {
    this.raw = null;
    this.viewer = null;
    this.loadedToken = null;
    this.setData({
      order: null,
      form: null,
      formFields: null,
      selected: null,
      pending: null,
      pendingAcknowledged: false,
      busy: false,
      loading: false,
      message: '',
    });
  },
  failure(error, actor) {
    if ([401, 403, 404].includes(error.status) || error.code === 'SESSION_CHANGED')
      this.clearPrivate();
    else if (actor) this.setData({ pending: model.getJournal().read(actor, this.orderId) });
    this.setData({ error: ui.message(error) });
  },
  finish(token, visit) {
    if (this.hidden || this.visit !== visit) return;
    if (!ui.live(this, token)) {
      this.clearPrivate();
      this.setData({ error: '账号已变化，请重新读取本单。' });
    } else this.setData({ busy: false });
  },
  route() {
    return '/pages/booking-detail/index?id=' + this.orderId + '&view=' + this.view;
  },
  async load() {
    if (this.data.busy) return;
    if (
      this.data.form &&
      !(await ui.confirm(
        '放弃未提交的编辑？',
        '刷新会重新读取当前场次；尚未提交的原因和安排会清空。',
      ))
    )
      return;
    const visit = this.visit;
    const request = (this.request = (this.request || 0) + 1);
    this.raw = null;
    this.viewer = null;
    this.setData({
      order: null,
      form: null,
      formFields: null,
      selected: null,
      pending: null,
      pendingAcknowledged: false,
      loading: true,
      error: '',
      message: '',
      loginRequired: false,
    });
    let token;
    try {
      const session = await ui.session(this, this.route());
      if (!session || this.hidden || this.visit !== visit || this.request !== request) return;
      token = ui.begin(this);
      const order = await sdk.get(this.orderId);
      if (!this.active(token, visit) || this.request !== request) return;
      this.viewer = session.user.id;
      this.raw = order;
      this.render(token);
    } catch (error) {
      if (
        !this.hidden &&
        this.visit === visit &&
        this.request === request &&
        (!token || ui.live(this, token))
      )
        this.setData({ order: null, error: ui.message(error) });
    } finally {
      if (
        !this.hidden &&
        this.visit === visit &&
        this.request === request &&
        (!token || ui.live(this, token))
      )
        this.setData({ loading: false });
    }
  },
  render(token) {
    if (token) this.loadedToken = token;
    if (!this.raw || !this.viewer || !this.loadedToken || !ui.live(this, this.loadedToken)) return;
    this.setData({
      order: model.decorateOrder(this.raw, this.viewer, this.view, ui),
      pending: model.getJournal().read(this.viewer, this.orderId),
    });
  },
  async chooseAction(event) {
    if (
      this.data.busy ||
      this.data.pending ||
      !this.raw ||
      !this.viewer ||
      !this.loadedToken ||
      !ui.live(this, this.loadedToken)
    )
      return;
    const visit = this.visit;
    if (this.data.form && !(await ui.confirm('更换当前操作？', '尚未提交的编辑会清空。'))) return;
    if (this.hidden || this.visit !== visit) return;
    try {
      const item = model.appearance(
        this.raw,
        event.currentTarget.dataset.id,
        this.viewer,
        this.view,
      );
      const type = event.currentTarget.dataset.type;
      if (!model.allowed(item, type)) throw new Error('当前身份或状态不允许此操作，请刷新');
      const form = model.form(type, item, ui);
      this.formVersion = item.version;
      this.selectedId = item.id;
      this.setData(
        {
          form,
          formFields: form.fields,
          selected: model.decorateAppearance(item, ui),
          formConfirmed: false,
          canSubmit: false,
          validation: '',
          error: '',
          message: '',
        },
        () => {
          if (!this.hidden && this.visit === visit && typeof wx.pageScrollTo === 'function')
            wx.pageScrollTo({ selector: '#command-form', duration: 160 });
        },
      );
    } catch (error) {
      this.setData({ error: ui.message(error) });
    }
  },
  input(event) {
    if (this.data.busy || !this.data.form) return;
    const field = event.currentTarget.dataset.field;
    if (!model.INPUT_FIELDS.includes(field)) return;
    this.setData({
      formFields: { ...this.data.formFields, [field]: String(event.detail.value || '') },
    });
    this.validate();
  },
  resolution(event) {
    if (this.data.busy || !this.data.form || !this.data.form.needsResolution) return;
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || !model.RESOLUTIONS[index]) return;
    this.setData({
      formFields: { ...this.data.formFields, resolution: model.RESOLUTIONS[index] },
      form: { ...this.data.form, resolutionLabel: model.RESOLUTION_LABELS[index] },
    });
    this.validate();
  },
  confirm(event) {
    if (this.data.busy || !this.data.form) return;
    this.setData({
      formConfirmed: Array.isArray(event.detail.value) && event.detail.value.includes('yes'),
    });
    this.validate();
  },
  validate() {
    try {
      const item = model.appearance(this.raw, this.selectedId, this.viewer, this.view);
      model.command(
        this.data.form.type,
        item,
        this.data.formFields,
        PROBE_ID,
        this.data.formConfirmed,
      );
      this.setData({ canSubmit: true, validation: '' });
    } catch (error) {
      this.setData({
        canSubmit: false,
        validation: this.data.formConfirmed ? ui.message(error) : '',
      });
    }
  },
  async closeForm() {
    if (this.data.busy) return;
    if (
      this.data.form &&
      !(await ui.confirm('放弃未提交的操作？', '本次编辑尚未提交，不会改变原约定。'))
    )
      return;
    this.setData({
      form: null,
      formFields: null,
      selected: null,
      formConfirmed: false,
      canSubmit: false,
      validation: '',
    });
  },
  async submit() {
    if (
      this.data.busy ||
      !this.data.canSubmit ||
      !this.data.form ||
      this.data.pending ||
      !this.raw ||
      !this.viewer
    )
      return;
    const visit = this.visit,
      actor = this.viewer,
      type = this.data.form.type,
      itemId = this.selectedId,
      version = this.formVersion;
    const fields = JSON.parse(JSON.stringify(this.data.formFields));
    const confirmed = this.data.formConfirmed;
    this.setData({ busy: true, error: '', message: '' });
    const token = ui.begin(this);
    try {
      const session = await ui.session(this, this.route());
      if (!session || session.user.id !== actor || !this.active(token, visit)) return;
      const latest = await sdk.get(this.orderId);
      if (!this.active(token, visit)) return;
      const item = model.appearance(latest, itemId, actor, this.view);
      if (item.version !== version || !model.allowed(item, type)) {
        this.raw = latest;
        this.render(token);
        this.setData({ form: null, formFields: null, selected: null });
        throw new Error('场次状态或权限已变化，请重新核对后选择操作');
      }
      this.raw = latest;
      this.render(token);
      const commandId = await ui.uuid();
      if (!this.active(token, visit)) return;
      const payload = model.command(type, item, fields, commandId, confirmed);
      if (
        !(await ui.confirm(
          model.action(type).label,
          '只处理本球员本场。请核对当前约定、原因与资金未开放状态。',
        ))
      )
        return;
      if (!this.active(token, visit)) return;
      model.getJournal().start(actor, this.orderId, payload);
      this.setData({
        form: null,
        formFields: null,
        selected: null,
        pendingAcknowledged: false,
        pending: model.getJournal().read(actor, this.orderId),
      });
      await this.sendOriginal(actor, token, visit);
    } catch (error) {
      if (this.active(token, visit)) {
        this.failure(error, actor);
      }
    } finally {
      this.finish(token, visit);
    }
  },
  async sendOriginal(actor, token, visit) {
    const journal = model.getJournal();
    const result = await journal.run(actor, this.orderId, (payload) =>
      sdk.command(this.orderId, payload),
    );
    if (!this.active(token, visit)) return;
    this.raw = result;
    const removed = journal.clear(actor, this.orderId);
    this.render(token);
    this.setData({
      message: removed
        ? '本场操作已保存，已读取最新记录。'
        : '操作已保存，但本机恢复标记未能移除；请继续核对原记录。',
      pendingAcknowledged: false,
    });
  },
  async recover() {
    if (
      this.data.busy ||
      !this.viewer ||
      !this.data.pending ||
      this.data.pending.kind !== 'PENDING'
    )
      return;
    const actor = this.viewer,
      visit = this.visit,
      token = ui.begin(this);
    this.setData({ busy: true, error: '', message: '' });
    try {
      const session = await ui.session(this, this.route());
      if (!session || session.user.id !== actor || !this.active(token, visit)) return;
      const latest = await sdk.get(this.orderId);
      if (!this.active(token, visit)) return;
      this.raw = latest;
      this.render(token);
      if (
        !(await ui.confirm(
          '核对原操作结果',
          '只用原编号和原内容重试；不会生成新操作编号或按当前表单改写原请求。',
        ))
      )
        return;
      if (!this.active(token, visit)) return;
      await this.sendOriginal(actor, token, visit);
    } catch (error) {
      if (this.active(token, visit)) this.failure(error, actor);
    } finally {
      this.finish(token, visit);
    }
  },
  pendingConsent(event) {
    if (this.data.busy) return;
    this.setData({
      pendingAcknowledged: Array.isArray(event.detail.value) && event.detail.value.includes('yes'),
    });
  },
  async clearPending() {
    if (
      this.data.busy ||
      !this.data.pendingAcknowledged ||
      !this.viewer ||
      !this.data.pending ||
      this.data.pending.inFlight
    )
      return;
    const actor = this.viewer,
      visit = this.visit,
      token = ui.begin(this);
    this.setData({ busy: true, error: '' });
    try {
      const session = await ui.session(this, this.route());
      if (!session || session.user.id !== actor || !this.active(token, visit)) return;
      const latest = await sdk.get(this.orderId);
      if (!this.active(token, visit)) return;
      this.raw = latest;
      if (
        !(await ui.confirm(
          '已核对当前场次记录？',
          '本操作只移除本机待核对标记，不取消服务端原请求，也不会自动执行新操作。仍不能确认结果时请保留原编号继续核对。',
        ))
      )
        return;
      if (!this.active(token, visit)) return;
      const removed = model.getJournal().clear(actor, this.orderId);
      this.render(token);
      this.setData({
        pendingAcknowledged: false,
        message: removed
          ? '已移除本机核对标记。下一次操作仍须重新核对当前状态。'
          : '未能移除恢复标记，请保留并继续核对。',
      });
    } catch (error) {
      if (this.active(token, visit)) this.failure(error, actor);
    } finally {
      this.finish(token, visit);
    }
  },
  login() {
    ui.login(this.route());
  },
  list() {
    ui.open('bookings', { view: this.view });
  },
});
