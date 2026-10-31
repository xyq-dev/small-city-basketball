const api = require('../../utils/api');
const ui = require('../../utils/ui');
const root = '/v1/account-closure';
const statuses = {
  PENDING: '等待注销检查',
  BLOCKED: '有事项需要先处理',
  CANCELLED: '已取消申请',
  EXPIRED_AUTH: '账号安全信息已变化，请重新申请',
  CLOSED: '账号已注销',
};
const reasons = {
  OWNER_TRANSFER_REQUIRED: '请先移交仍在运营的机构负责人权限',
  SOFTWARE_MONEY_UNRESOLVED: '平台套餐付款或退款尚未处理完成',
  PLAYER_SERVICE_UNRESOLVED: '球员预约或履约尚未结束',
  LOCAL_SERVICE_UNRESOLVED: '球场或人员服务尚未结束',
  TEAM_MATCHUP_UNRESOLVED: '球队约赛尚未结束',
  DISPUTE_UNRESOLVED: '争议或申诉尚未处理完成',
};
const pendingKey = (actor) => 'scb-account-closure-v1:' + actor;
function clearPending(actor, commandId) {
  const key = pendingKey(actor);
  const old = wx.getStorageSync(key);
  if (old && old.clientRequestId === commandId) wx.removeStorageSync(key);
}
Page({
  data: {
    loading: false,
    busy: false,
    loginRequired: false,
    enabled: false,
    password: '',
    confirmed: false,
    coolingOffDays: 0,
    dayOptions: ['立即检查', '1天', '2天', '3天', '4天', '5天', '6天', '7天'],
    request: null,
    pending: false,
    error: '',
    message: '',
  },
  onShow() {
    this._closed = false;
    this.setData({ busy: false, password: '', confirmed: false });
    this.load();
  },
  onHide() {
    ui.close(this);
    this.setData({ password: '', confirmed: false });
  },
  onUnload() {
    this.onHide();
  },
  onSessionReset() {
    this._actor = null;
    this.setData({
      password: '',
      confirmed: false,
      request: null,
      pending: false,
      enabled: false,
      busy: false,
      loginRequired: true,
      message: '当前会话已失效。如曾提交注销，请先核对结果，不要重复操作。',
    });
  },
  input(e) {
    if (this.data.busy) return;
    if (e.currentTarget.dataset.field === 'password') this.setData({ password: e.detail.value });
  },
  chooseDays(e) {
    if (!this.data.busy && !this.data.pending) {
      const days = Number(e.detail.value);
      if (Number.isInteger(days) && days >= 0 && days <= 7) this.setData({ coolingOffDays: days });
    }
  },
  confirmTerms(e) {
    if (!this.data.busy) this.setData({ confirmed: e.detail.value.includes('close') });
  },
  async load() {
    if (this.data.busy) return;
    const t = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      const session = await ui.session(this, '/pages/account-closure/index');
      if (!session || !ui.live(this, t)) return;
      this._actor = session.user.id;
      const result = (await api.getClient().request(root + '/me')).data;
      if (!ui.live(this, t)) return;
      this.apply(result);
      this.setData({ pending: !!wx.getStorageSync(pendingKey(this._actor)) });
    } catch (e) {
      if (ui.live(this, t)) this.setData({ error: ui.message(e) });
    } finally {
      if (ui.live(this, t)) this.setData({ loading: false });
    }
  },
  apply(result) {
    const r = result.request;
    this.setData({
      enabled: result.enabled === true,
      request: r
        ? {
            ...r,
            label: statuses[r.status] || '请重新读取状态',
            canCancel: ['PENDING', 'BLOCKED'].includes(r.status),
            executeText: ui.localTime(r.executeAfter, true),
            blockers: (r.blockers || []).map(
              (v) => reasons[v] || '相关事项尚未处理完成（' + v + '）',
            ),
          }
        : null,
    });
  },
  requestClosure() {
    return this.write('REQUEST');
  },
  cancelClosure() {
    return this.write('CANCEL');
  },
  retry() {
    if (!this._actor) return;
    const p = wx.getStorageSync(pendingKey(this._actor));
    if (p) return this.write(p.operation, p);
  },
  async write(operation, original) {
    if (this.data.busy || this.data.loading || !this._actor || this._closed) return;
    if (!original && this.data.pending) return;
    if (operation === 'REQUEST' && (!this.data.enabled || !this.data.confirmed)) {
      this.setData({ error: '请确认注销影响及当前检查能力。' });
      return;
    }
    if (!this.data.password) {
      this.setData({ error: '请填写当前密码以核验本人。' });
      return;
    }
    const t = ui.hold(this);
    const actor = this._actor;
    this.setData({ busy: true, error: '', message: '' });
    let command;
    try {
      const confirmed = await ui.confirm(
        '确认账号操作',
        operation === 'REQUEST'
          ? '检查通过后账号将不可恢复。比赛及必要财务历史会按保留规则保存。'
          : '取消后不会再执行本次注销。',
      );
      if (!confirmed || !ui.held(this, t) || actor !== this._actor) return;
      const id = original ? original.clientRequestId : await ui.uuid();
      if (!ui.held(this, t) || actor !== this._actor) return;
      command = original || {
        operation,
        clientRequestId: id,
        ...(operation === 'REQUEST'
          ? { coolingOffDays: this.data.coolingOffDays }
          : { requestId: this.data.request.id, expectedVersion: this.data.request.version }),
      };
      // Only operation metadata is durable. Password and session cookie never enter this journal.
      wx.setStorageSync(pendingKey(actor), command);
      this.setData({ pending: true });
      const { operation: _, ...payload } = command;
      const result = (
        await api
          .getClient()
          .request(root + (operation === 'REQUEST' ? '/requests' : '/cancel'), 'POST', {
            ...payload,
            password: this.data.password,
          })
      ).data;
      clearPending(actor, id);
      if (!ui.held(this, t) || actor !== this._actor) return;
      this.apply({ enabled: this.data.enabled, request: result });
      this.setData({
        pending: false,
        password: '',
        confirmed: false,
        message:
          operation === 'REQUEST'
            ? '申请已受理，尚不代表账号已注销。请刷新查看检查结果。'
            : '原申请已取消或已结束。',
      });
    } catch (e) {
      if (command && e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status))
        clearPending(actor, command.clientRequestId);
      if (ui.held(this, t) && actor === this._actor)
        this.setData({
          pending: !!wx.getStorageSync(pendingKey(actor)),
          password: '',
          error: ui.message(e),
        });
    } finally {
      if (ui.held(this, t) && actor === this._actor) this.setData({ busy: false });
    }
  },
  login() {
    ui.login('/pages/account-closure/index');
  },
});
