const api = require('../../utils/api');
const ui = require('../../utils/ui');
const stream = require('../../utils/streaming');
const blank = {
  sessions: [],
  channels: [],
  session: null,
  capabilities: null,
  pushUrl: '',
  capturing: false,
  pending: false,
};
Page({
  data: {
    ...blank,
    loading: false,
    busy: false,
    error: '',
    notice: '',
    selected: [],
    minutes: '60',
    budgetFen: '10000',
    record: true,
    reason: '主办方显式操作',
    cameraReady: false,
    phoneState: '尚未采集',
  },
  onLoad(q = {}) {
    this._alive = true;
    this._visible = true;
    try {
      this.org = api.uuid(q.orgId);
      this.match = api.uuid(q.matchId);
      this.load();
    } catch (e) {
      this.setData({ error: ui.message(e) });
    }
  },
  onReady() {
    if (typeof wx.createLivePusherContext === 'function') {
      this._pusher = wx.createLivePusherContext('basketball-source', this);
      this.setData({ cameraReady: true });
    }
  },
  onShow() {
    this._visible = true;
    if (this.org && !this.data.loading) this.load();
  },
  onHide() {
    this._visible = false;
    this.backgroundPause();
  },
  onUnload() {
    this._visible = false;
    this.backgroundPause();
    this._alive = false;
    ui.close(this);
  },
  onSessionReset() {
    this.stopPhone();
    this._lease = null;
    this._pending = null;
    this._workspace = null;
    this.setData({
      ...blank,
      busy: false,
      loading: false,
      error: '登录身份已变化，请重新进入直播间',
    });
  },
  path() {
    return '/v1/orgs/' + this.org + '/matches/' + this.match + '/streaming';
  },
  scope() {
    return stream.scope(api.getClient(), this.org, this.match);
  },
  stopPhone() {
    clearInterval(this._heartbeat);
    this._heartbeat = null;
    this._lease = null;
    if (this._pusher) this._pusher.stop({});
    this.setData({ pushUrl: '', capturing: false, phoneState: '本机采集已停止' });
  },
  apply(v) {
    this._workspace = v;
    const sessions = v.sessions.map(stream.session),
      selected = sessions.find((s) => s.desired !== 'STOPPED') || sessions[0] || null;
    this.setData({
      sessions,
      channels: v.channels,
      capabilities: v.capabilities,
      session: selected,
    });
    if (
      !selected ||
      selected.desired !== 'RUNNING' ||
      !selected.leaseOwned ||
      (this._lease && this._lease.sourceEpoch !== selected.sourceEpoch)
    )
      this.stopPhone();
  },
  async load() {
    if (!this._alive || !this.org || this.data.loading || this.data.busy) return;
    const c = api.getClient(),
      token = ui.begin(this);
    this.setData({ loading: true, error: '' });
    try {
      if (!c.hasSession()) throw Error('请先登录后管理直播');
      this._pending = stream.pending(this.scope());
      this.setData({ pending: !!this._pending });
      const v = (await c.request(this.path())).data;
      if (!ui.live(this, token)) return;
      if (!v || !Array.isArray(v.sessions) || !Array.isArray(v.channels) || !v.capabilities)
        throw Error('直播资料无效');
      this.apply(v);
    } catch (e) {
      if (ui.live(this, token)) {
        this.stopPhone();
        this.setData({ error: ui.message(e) });
      }
    } finally {
      if (ui.live(this, token)) this.setData({ loading: false });
    }
  },
  input(e) {
    const f = e.currentTarget.dataset.field;
    if (['minutes', 'budgetFen', 'reason'].includes(f)) this.setData({ [f]: e.detail.value });
  },
  selectChannels(e) {
    this.setData({ selected: e.detail.value });
  },
  setRecord(e) {
    this.setData({ record: e.detail.value === true });
  },
  async create() {
    await this.send({
      type: 'CREATE',
      channelIds: this.data.selected,
      maximumSeconds: Number(this.data.minutes) * 60,
      budgetFen: Number(this.data.budgetFen),
      record: this.data.record,
    });
  },
  async action(e) {
    const type = e.currentTarget.dataset.type,
      s = this.data.session,
      guard = ui.guard(this);
    if (!s) return;
    if (['START', 'PAUSE', 'STOP', 'REVOKE'].includes(type)) {
      if (
        !(await ui.confirm(
          type === 'START' ? '开始本机采集' : '确认直播操作',
          type === 'START'
            ? '将使用摄像头和麦克风，并按主办方批准的频道转推。'
            : '将提交停流请求；须等云入口和各频道停止证据，未知时仍保留占用。',
        ))
      )
        return;
    }
    if (!ui.held(this, guard) || this.data.session?.id !== s.id) return;
    const body = { type, sessionId: s.id, expectedVersion: s.version };
    if (type === 'START') {
      if (!this.data.cameraReady) {
        this.setData({ error: '当前微信或账号未具备实时音视频采集能力' });
        return;
      }
      body.deviceId = await ui.uuid();
      if (!ui.held(this, guard)) return;
    }
    if (['PAUSE', 'STOP', 'REVOKE'].includes(type)) {
      this.stopPhone();
      body.reason = this.data.reason;
    }
    await this.send(body);
  },
  async target(e) {
    const s = this.data.session;
    if (!s) return;
    await this.send({
      type: e.currentTarget.dataset.type,
      sessionId: s.id,
      expectedVersion: s.version,
      channelId: e.currentTarget.dataset.id,
      reason: this.data.reason,
    });
  },
  async retry() {
    if (this._pending) await this.send(this._pending, true);
  },
  async send(input, retry = false) {
    if (this.data.busy || !this._alive) return;
    const c = api.getClient(),
      token = ui.hold(this);
    this.setData({ busy: true, error: '', notice: '' });
    let body, key;
    try {
      key = this.scope();
      body = retry ? input : { clientRequestId: await ui.uuid(), ...input };
      if (!ui.held(this, token)) return;
      stream.save(key, body);
      this._pending = body;
      this.setData({ pending: true });
      const v = (await c.request(this.path() + '/commands', 'POST', body)).data;
      if (!ui.held(this, token)) return;
      stream.clear(key, body.clientRequestId);
      this._pending = null;
      const s = stream.session(v.session);
      this.setData({ session: s, pending: false, notice: '操作已由服务器确认' });
      if (v.source && body.type === 'START') {
        if (
          !/^rtmps?:\/\/[A-Za-z0-9.-]+(?::443)?\/[^\s@#]+$/.test(v.source.pushUrl) ||
          !Number.isInteger(v.source.sourceEpoch)
        )
          throw Error('采集入口无效');
        this._lease = { ...v.source, deviceId: body.deviceId, sessionId: s.id };
        if (!this._visible || !this._pusher) {
          this._pauseAfter = true;
          return;
        }
        this.setData({ pushUrl: v.source.pushUrl, phoneState: '等待本机开始采集' });
        this._pusher.start({
          success: () => {
            if (this._visible && this._lease) {
              this.setData({ capturing: true, phoneState: '本机正在采集' });
              this.beat();
              this._heartbeat = setInterval(() => this.beat(), 10000);
            } else this._pusher.stop({});
          },
          fail: () => {
            this.backgroundPause();
            this.setData({ error: '本机采集失败，正在申请暂停' });
          },
        });
      } else if (s.desired !== 'RUNNING') this.stopPhone();
    } catch (e) {
      if (ui.held(this, token)) {
        this.setData({
          error: ui.message(e),
          notice: body ? '保留了原操作编号，请核对原操作结果后再继续。' : '未发送操作',
        });
      }
    } finally {
      if (ui.held(this, token)) {
        this.setData({ busy: false });
        if (this._pauseAfter) {
          this._pauseAfter = false;
          this.backgroundPause();
        } else if (this._pauseCommand) {
          const pause = this._pauseCommand;
          this._pauseCommand = null;
          void this.send(pause);
        } else if (!this._pending && this._visible) this.load();
      }
    }
  },
  async beat() {
    if (this._beating || !this._visible || !this._lease || !this.data.session) return;
    const c = api.getClient(),
      token = ui.guard(this),
      lease = this._lease;
    this._beating = true;
    try {
      const requestId = await ui.uuid();
      if (!ui.held(this, token) || this._lease !== lease || !this._visible) return;
      const v = (
        await c.request(this.path() + '/commands', 'POST', {
          clientRequestId: requestId,
          type: 'HEARTBEAT',
          sessionId: lease.sessionId,
          expectedVersion: this.data.session.version,
          deviceId: lease.deviceId,
          leaseToken: lease.leaseToken,
        })
      ).data;
      if (!ui.held(this, token) || this._lease !== lease) return;
      if (!v.source || v.session.sourceEpoch !== lease.sourceEpoch) throw Error('采集租约已失效');
      this.setData({ session: stream.session(v.session) });
    } catch (e) {
      if (ui.held(this, token)) {
        this.backgroundPause();
        this.setData({ error: '采集续租失败，已停止本机；请核对云端停流后显式恢复' });
      }
    } finally {
      this._beating = false;
    }
  },
  backgroundPause() {
    const s = this.data.session,
      owned = !!this._lease;
    this.stopPhone();
    if (!owned || !s || s.desired !== 'RUNNING' || this._pending) return;
    const body = {
      type: 'PAUSE',
      sessionId: s.id,
      expectedVersion: s.version,
      reason: '采集页进入后台或本机停止',
    };
    if (this.data.busy) {
      this._pauseCommand = body;
      return;
    }
    void this.send(body);
  },
  pusherState(e) {
    if (this._visible)
      this.setData({ phoneState: '本机采集状态码 ' + e.detail.code + '；外站直播状态须单独核对' });
  },
  pusherError() {
    this.backgroundPause();
    this.setData({ error: '摄像头或麦克风采集失败，已停止本机并申请云端暂停' });
  },
  media() {
    const s = this.data.session;
    if (s)
      wx.navigateTo({ url: '/pages/media-jobs/index?orgId=' + this.org + '&sessionId=' + s.id });
  },
});
