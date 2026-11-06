const ui = require('../../utils/ui');
const sdk = require('../../utils/booking');
const model = require('../../utils/booking-orders');
function scheduleText(item) {
  if (item.status === 'CONDITIONAL') return '条件满足后补齐具体时间';
  const date = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(item.startText);
  if (!date || !item.endText || !item.reportText) return '';
  const day =
    date[1] === ui.today().slice(0, 4)
      ? Number(date[2]) + '月' + Number(date[3]) + '日'
      : date[1] + '年' + Number(date[2]) + '月' + Number(date[3]) + '日';
  const startDate = item.startText.slice(0, 10);
  const end = item.endText.startsWith(startDate + ' ') ? item.endText.slice(11) : item.endText;
  const report = item.reportText.startsWith(startDate + ' ')
    ? item.reportText.slice(11)
    : item.reportText;
  return day + ' ' + date[4] + '–' + end + ' · 报到' + report;
}
function compactDateTime(value) {
  const date = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(value || '');
  if (!date) return value || '时间待确认';
  return (
    (date[1] === ui.today().slice(0, 4) ? '' : date[1] + '年') +
    Number(date[2]) +
    '月' +
    Number(date[3]) +
    '日 ' +
    date[4]
  );
}
function serviceDisplay(item) {
  if (item.status === 'CONDITIONAL') return '满足条件后补齐';
  const start = compactDateTime(item.startText);
  const end =
    item.endText && item.startText && item.endText.slice(0, 10) === item.startText.slice(0, 10)
      ? item.endText.slice(11)
      : compactDateTime(item.endText);
  return start + '—' + end;
}
function progressView(item) {
  const terminal = ['DECLINED', 'CANCELLED', 'EXPIRED'].includes(item.status);
  const accepted = ['ACCEPTED', 'ARRIVED', 'COMPLETED', 'DISPUTED'].includes(item.status);
  const arrived =
    !!item.arrivedText ||
    !!item.completedText ||
    item.status === 'ARRIVED' ||
    item.status === 'COMPLETED';
  const completed = !!item.completedText || item.status === 'COMPLETED';
  return {
    acceptDone: accepted || arrived || completed,
    acceptLabel:
      accepted || arrived || completed
        ? '已接单'
        : item.status === 'CONDITIONAL'
          ? '待激活'
          : terminal
            ? item.statusText
            : item.statusText || '待接单',
    arriveDone: arrived || completed,
    arriveLabel: arrived || completed ? '已到场' : terminal ? '未办理' : '待到场',
    completeDone: completed,
    completeLabel: completed ? '已完成' : terminal ? '未办理' : '待办理',
  };
}
const SINGLE_STATE_BANNERS = {
  ACCEPTED: ['双方约定已确认', '时间地点以当前约定为准'],
  EXPIRED: ['本场请求已到期', '原20分钟待接单保留已释放'],
  DECLINED: ['球员已拒绝本场', '本项待接单档期已释放'],
  CANCELLED: ['本场合作已取消', '只处理本球员本场，其他项独立保留'],
  COMPLETED: ['服务记录已完成', '完成记录与资金状态分别展示'],
  DISPUTED: ['等待独立处理', '本场保留相关记录与约定'],
};
const PROBE_ID = '00000000-0000-4000-8000-000000000000';
Page({
  data: {
    orderId: '',
    order: null,
    expandedId: '',
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
    activeTab: 'arrangement',
    resolutionLabels: model.RESOLUTION_LABELS,
  },
  proposeChange() {
    const rows = (this.data.order && this.data.order.appearances) || [];
    const item = rows.find((row) =>
      (row.actions || []).some((action) => action.type === 'PROPOSE_CHANGE'),
    );
    if (!item || this.data.busy) return;
    this.chooseAction({ currentTarget: { dataset: { id: item.id, type: 'PROPOSE_CHANGE' } } });
  },
  openTrade() {
    const rows = (this.data.order && this.data.order.appearances) || [];
    const item = rows[0];
    if (!item || this.data.busy) return;
    this.trade({ currentTarget: { dataset: { id: item.id } } });
  },
  scrollSection(event) {
    const id = event.currentTarget.dataset.id;
    if (!['booking-arrangement', 'booking-progress', 'booking-finances'].includes(id)) return;
    if (typeof wx.pageScrollTo === 'function')
      wx.pageScrollTo({ selector: '#' + id, duration: 200 });
  },
  trade(e) {
    const id = e.currentTarget.dataset.id;
    if (
      !this.data.busy &&
      !this.data.loading &&
      this.data.order &&
      this.data.order.appearances.some((a) => a.id === id)
    )
      wx.navigateTo({
        url:
          '/pages/trade-order/index?kind=PLAYER_APPEARANCE&sourceId=' +
          encodeURIComponent(model.id(id)),
      });
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
    this.pendingReviewSnapshot = null;
    this.setData({
      order: null,
      expandedId: '',
      form: null,
      formFields: null,
      selected: null,
      pending: null,
      pendingAcknowledged: false,
      activeTab: 'arrangement',
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
  returnPath() {
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
    this.pendingReviewSnapshot = null;
    this.setData({
      order: null,
      expandedId: '',
      form: null,
      formFields: null,
      selected: null,
      pending: null,
      pendingAcknowledged: false,
      activeTab: 'arrangement',
      loading: true,
      error: '',
      message: '',
      loginRequired: false,
    });
    let token;
    try {
      const session = await ui.session(this, this.returnPath());
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
      order: (() => {
        const order = model.decorateOrder(this.raw, this.viewer, this.view, ui);
        const appearances = order.appearances.map((item) => ({
          ...item,
          scheduleText: scheduleText(item),
          reportDisplay:
            item.status === 'CONDITIONAL' ? '条件满足后补齐' : compactDateTime(item.reportText),
          serviceDisplay: serviceDisplay(item),
          progress: progressView(item),
        }));
        const banner =
          appearances.length === 1 ? SINGLE_STATE_BANNERS[appearances[0].status] : null;
        const changeAppearance = appearances.find((item) =>
          (item.actions || []).some((action) => action.type === 'PROPOSE_CHANGE'),
        );
        const primaryAppearance = changeAppearance || appearances[0] || null;
        const playerNames = Array.from(
          new Set(appearances.map((item) => item.playerName).filter(Boolean)),
        );
        return {
          ...order,
          canProposeChange: order.appearances.some((item) =>
            (item.actions || []).some((action) => action.type === 'PROPOSE_CHANGE'),
          ),
          canOpenTrade: order.appearances.length > 0,
          stateTitle: banner ? banner[0] : '',
          stateHint: banner ? banner[1] : '',
          appearances,
          playerSummary: playerNames.length === 1 ? playerNames[0] : playerNames.length + ' 位球员',
          primaryAppearanceId: primaryAppearance ? primaryAppearance.id : '',
          changeAppearanceId: changeAppearance ? changeAppearance.id : '',
        };
      })(),
      pending: model.getJournal().read(this.viewer, this.orderId),
    });
  },
  toggleAppearance(event) {
    if (
      this.data.busy ||
      this.data.pending ||
      this.data.form ||
      !this.raw ||
      !this.viewer ||
      !this.loadedToken ||
      !ui.live(this, this.loadedToken)
    )
      return;
    const id = event.currentTarget.dataset.id;
    if (!this.data.order || !this.data.order.appearances.some((item) => item.id === id)) return;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },
  changeTab(event) {
    if (this.data.busy || this.data.form || !this.data.order) return;
    const tab = event.currentTarget.dataset.tab;
    if (!['arrangement', 'fulfillment', 'fees'].includes(tab)) return;
    this.setData({ activeTab: tab }, () => {
      if (typeof wx !== 'undefined' && typeof wx.pageScrollTo === 'function')
        wx.pageScrollTo({ selector: '#detail-' + tab, duration: 160 });
    });
  },
  requestChange() {
    const id = this.data.order && this.data.order.changeAppearanceId;
    if (!id || this.data.busy || this.data.pending) return;
    this.setData({ activeTab: 'fulfillment' });
    return this.chooseAction({ currentTarget: { dataset: { id, type: 'PROPOSE_CHANGE' } } });
  },
  primaryTrade() {
    const id = this.data.order && this.data.order.primaryAppearanceId;
    if (!id || this.data.busy) return;
    return this.trade({ currentTarget: { dataset: { id } } });
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
      const session = await ui.session(this, this.returnPath());
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
      const session = await ui.session(this, this.returnPath());
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
  reviewPending(latest, token) {
    this.raw = latest;
    this.render(token);
    const snapshot = JSON.stringify({ order: latest, pending: this.data.pending });
    if (this.pendingReviewSnapshot === snapshot) return true;
    this.pendingReviewSnapshot = snapshot;
    this.setData({
      pendingAcknowledged: false,
      message: '最新场次记录已显示。请重新阅读，再勾选并点击移除本机标记；原操作编号仍保留。',
    });
    return false;
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
      const session = await ui.session(this, this.returnPath());
      if (!session || session.user.id !== actor || !this.active(token, visit)) return;
      const latest = await sdk.get(this.orderId);
      if (!this.active(token, visit)) return;
      // An acknowledgement of the old screen cannot discard an unknown command.
      // Present each new snapshot and require a separate, renewed user action.
      if (!this.reviewPending(latest, token)) return;
      if (
        !(await ui.confirm(
          '已核对当前场次记录？',
          '本操作只移除本机待核对标记，不取消服务端原请求，也不会自动执行新操作。仍不能确认结果时请保留原编号继续核对。',
        ))
      )
        return;
      if (!this.active(token, visit)) return;
      const confirmed = await sdk.get(this.orderId);
      if (!this.active(token, visit) || !this.reviewPending(confirmed, token)) return;
      const removed = model.getJournal().clear(actor, this.orderId);
      this.pendingReviewSnapshot = null;
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
  governance(e) {
    const id = e.currentTarget.dataset.id;
    if (
      this.data.busy ||
      !id ||
      !this.data.order ||
      !this.data.order.appearances.some((a) => a.id === id)
    )
      return;
    ui.open(e.currentTarget.dataset.kind === 'review' ? 'governance-reviews' : 'governance', {
      sourceKind: 'PLAYER_BOOKING',
      sourceId: model.id(id),
    });
  },
  login() {
    ui.login(this.returnPath());
  },
  list() {
    ui.open('bookings', { view: this.view });
  },
});
