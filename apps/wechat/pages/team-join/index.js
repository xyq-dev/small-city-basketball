const ui = require('../../utils/ui');
const tm = require('../../utils/team-membership');
const PATH = '/pages/team-join/index';
const claimView = (c) => ({
  ...c,
  stateText: tm.claimState(c.status),
  expires: ui.localTime(c.expiresAt, true),
});
// Player entry: join a team with a leader's join code, and accept or decline a directed
// historical-member claim. A join creates a new long-term member bound to this account only;
// repeating it returns the original binding without using the code again.
Page({
  data: {
    code: '',
    displayName: '',
    joined: null,
    claims: [],
    loading: false,
    busy: false,
    uncertain: false,
    error: '',
    message: '',
    loginRequired: false,
  },
  onLoad() {
    this._alive = true;
  },
  onShow() {
    if (!this.data.busy) this.load();
  },
  onHide() {
    // The code is a shared secret of the team; it is not kept once the page is left.
    if (!this.data.busy) this.setData({ code: '' });
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  login() {
    ui.login('');
  },
  async load() {
    if (this.data.busy) return;
    this.setData({ loading: true, error: '', claims: [] });
    ui.begin(this);
    const session = await ui.session(this, PATH);
    if (!this._alive) return;
    if (!session) {
      this.setData({ loading: false });
      return;
    }
    if (this._viewer !== session.user.id) this.setData({ joined: null, code: '', displayName: '' });
    this._viewer = session.user.id;
    if (!this.data.displayName) this.setData({ displayName: session.user.displayName || '' });
    const token = ui.begin(this);
    try {
      const claims = await tm.createRepository().myClaims();
      if (ui.live(this, token)) this.setData({ loading: false, claims: claims.map(claimView) });
    } catch (error) {
      if (ui.live(this, token)) this.setData({ loading: false, error: ui.message(error) });
    }
  },
  input(e) {
    if (this.data.busy) return;
    const field = e.currentTarget.dataset.field;
    if (field === 'code' || field === 'displayName') this.setData({ [field]: e.detail.value });
  },
  async join() {
    let code, displayName;
    try {
      code = tm.normalizeJoinCode(this.data.code);
      displayName = tm.text(this.data.displayName, '队内显示名', 1, 80);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    await tm.confirmedWrite(this, ui, {
      title: this.data.uncertain ? '核对上次加入' : '加入球队',
      content:
        '以当前账号加入加入码对应的球队，并以“' +
        displayName +
        '”出现在长期名单中。领队只能看到你的显示名与绑定状态。重复提交只会返回原成员关系。',
      path: PATH,
      still: () =>
        this.data.code.replace(/[\s-]/g, '').toUpperCase() === code &&
        this.data.displayName.trim() === displayName,
      send: () => tm.createRepository().join(code, displayName),
      done: async (membership) =>
        this.setData({
          joined: membership,
          code: '',
          uncertain: false,
          message: '已是“' + membership.teamName + '”成员：' + membership.memberName + '。',
        }),
    });
    if (this.data.uncertain)
      this.setData({
        message: '加入结果未知。请保持加入码不变再次提交核对，不会重复加入或多扣次数。',
      });
  },
  async decide(e) {
    const decision = e.currentTarget.dataset.decision;
    const claim = this.data.claims.find((c) => c.claimId === e.currentTarget.dataset.id);
    if (!claim || claim.status !== 'PENDING' || !['accept', 'decline'].includes(decision)) return;
    await tm.confirmedWrite(this, ui, {
      title: decision === 'accept' ? '确认认领历史成员' : '拒绝认领',
      content:
        decision === 'accept'
          ? '请确认你本人就是“' +
            claim.teamName +
            '”长期名单中的“' +
            claim.memberName +
            '”。接受后该成员与当前账号绑定。'
          : '拒绝后该认领失效，领队可另行处理。',
      path: PATH,
      still: () =>
        this.data.claims.some(
          (c) =>
            c.claimId === claim.claimId &&
            c.status === 'PENDING' &&
            c.memberName === claim.memberName &&
            c.teamName === claim.teamName,
        ),
      send: () => tm.createRepository().decideClaim(claim.claimId, decision),
      done: async (result) =>
        this.setData({
          claims: this.data.claims.map((c) =>
            c.claimId === claim.claimId ? claimView(result.claim) : c,
          ),
          joined: result.membership || this.data.joined,
          uncertain: false,
          message: decision === 'accept' ? '已接受认领。' : '已拒绝认领。',
        }),
    });
  },
  openMemberships() {
    if (!this.data.busy) tm.go('memberships');
  },
});
