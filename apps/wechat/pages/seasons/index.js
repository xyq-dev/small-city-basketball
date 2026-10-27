const api = require('../../utils/api');
const ui = require('../../utils/ui');
const model = require('../../utils/seasons');
const basePath = '/pages/seasons/index';
const grantsPath = '/pages/season-grants/index';

const emptyDraft = () => ({ name: '', startDate: '', endDate: '' });
// Private, account-bound state; cleared on every identity change, sign-out or unload.
const privateDefaults = () => ({
  seasons: [],
  season: null,
  edit: emptyDraft(),
  board: null,
  boardError: '',
  createPending: false,
  message: '',
});

Page({
  data: {
    orgId: '',
    seasonId: '',
    invalid: false,
    loginRequired: false,
    loading: false,
    busy: false,
    error: '',
    draft: emptyDraft(),
    ...privateDefaults(),
  },
  onLoad(query) {
    let orgId = '';
    let seasonId = '';
    try {
      orgId = model.uuid((query && query.orgId) || '');
      if (query && query.seasonId) seasonId = model.uuid(query.seasonId);
    } catch {
      this.setData({ invalid: true, error: '页面参数无效，请从账号页的机构入口重新进入。' });
      return;
    }
    this.setData({ orgId, seasonId });
  },
  onShow() {
    if (!this.data.invalid) this.load();
  },
  onUnload() {
    this._pendingCreate = null;
    ui.close(this);
  },
  onSessionReset() {
    // A pending creation belongs to the account that started it; never replay it for another.
    this._pendingCreate = null;
    if (this._closed || !this.setData) return;
    this.setData({
      ...privateDefaults(),
      draft: emptyDraft(),
      loginRequired: true,
      loading: false,
      busy: false,
      error: '登录身份已变化，请重新登录并读取当前资料。',
    });
  },
  returnPath() {
    return basePath + model.seasonsPath({ orgId: this.data.orgId, seasonId: this.data.seasonId });
  },
  root() {
    return '/v1/orgs/' + this.data.orgId + '/seasons';
  },
  login() {
    ui.login(this.returnPath());
  },
  async load() {
    if (this.data.busy || this.data.invalid) return;
    const token = ui.begin(this);
    this.setData({ loading: true, error: '' });
    const session = await ui.session(this, this.returnPath());
    if (!session || !ui.live(this, token)) return;
    const client = api.getClient();
    try {
      if (this.data.seasonId) {
        const season = (await client.request(this.root() + '/' + this.data.seasonId)).data;
        if (!ui.live(this, token)) return;
        this.setData({
          season: model.seasonView(season),
          edit: { name: season.name, startDate: season.startDate, endDate: season.endDate },
        });
        await this.loadBoard(token);
      } else {
        const seasons = (await client.request(this.root())).data;
        if (!ui.live(this, token)) return;
        this.setData({ seasons: seasons.map(model.seasonView) });
      }
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          error:
            error && error.status === 403
              ? '仅机构负责人/管理员可管理私有赛季；只管理某一届赛事不能查看赛季汇总。'
              : ui.message(error),
        });
    } finally {
      if (ui.live(this, token)) this.setData({ loading: false });
    }
  },
  async loadBoard(token) {
    try {
      const stats = (
        await api.getClient().request(this.root() + '/' + this.data.seasonId + '/player-statistics')
      ).data;
      if (!ui.live(this, token)) return;
      const summary = stats.summary;
      this.setData({
        boardError: '',
        board: {
          rows: summary.rows.map(model.playerRow),
          coverage: model.coverageRows(summary),
          note: model.rankingNote(summary),
          rankingComplete: summary.rankingComplete,
          sourceHash: summary.sourceHash,
          asOf: ui.localTime(summary.asOf, true),
          effectiveGrantCount: summary.effectiveGrantCount,
        },
      });
    } catch (error) {
      if (ui.live(this, token)) this.setData({ board: null, boardError: ui.message(error) });
    }
  },
  input(event) {
    const { section, field } = event.currentTarget.dataset;
    if (!['draft', 'edit'].includes(section) || !['name', 'startDate', 'endDate'].includes(field))
      return;
    if (section === 'draft' && this.data.createPending) return;
    this.setData({ [section + '.' + field]: String(event.detail.value || '') });
  },
  openSeason(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.busy) return;
    wx.navigateTo({ url: basePath + model.seasonsPath({ orgId: this.data.orgId, seasonId: id }) });
  },
  openGrants(event) {
    const eventId = event.currentTarget.dataset.id;
    if (this.data.busy) return;
    wx.navigateTo({ url: grantsPath + model.seasonsPath({ orgId: this.data.orgId, eventId }) });
  },
  /** A write confirmed for this session and page; reads are cancelled while it runs. */
  async write(title, content, send) {
    if (this.data.busy || this.data.loading) return null;
    const op = await ui.confirmOp(this, title, content);
    if (!op) return null;
    const token = ui.hold(this);
    this.setData({ busy: true, error: '', message: '' });
    try {
      if (!op.valid()) return null;
      const result = await send();
      if (!ui.held(this, token)) return null;
      return result;
    } catch (error) {
      if (!ui.held(this, token)) return null;
      throw error;
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async create() {
    if (this.data.busy || this.data.loading) return;
    const draft = this.data.draft;
    let input;
    try {
      const pending = this._pendingCreate;
      const id =
        pending && model.sameSeasonCreate(pending.draft, draft) ? pending.id : await ui.uuid();
      input = model.createInput(draft, id);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    let created;
    try {
      created = await this.write(
        '创建私有赛季',
        '创建后为草稿；赛事须由您逐一明确归入，不会按日期自动归属。',
        () => {
          // Persist the original id before sending: an unknown result is retried with it.
          this._pendingCreate = { id: input.clientRequestId, draft: { ...draft } };
          return api.getClient().request(this.root(), 'POST', input);
        },
      );
    } catch (error) {
      const unknown = !error || !error.status;
      if (!unknown) this._pendingCreate = null;
      this.setData({
        createPending: unknown && !!this._pendingCreate,
        error: unknown
          ? '创建结果未知。请点“核对并重试”，将沿用原请求编号，不会重复创建。'
          : ui.message(error),
      });
      return;
    }
    if (!created) return;
    this._pendingCreate = null;
    this.setData({ createPending: false, draft: emptyDraft(), message: '赛季已创建（草稿）。' });
    wx.navigateTo({
      url: basePath + model.seasonsPath({ orgId: this.data.orgId, seasonId: created.data.id }),
    });
    this.load();
  },
  async save() {
    const season = this.data.season;
    let body;
    try {
      body = model.updateInput(season, this.data.edit);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    await this.mutate('保存赛季资料', '修改名称或日期；日期须覆盖已归入的赛事。', () =>
      api.getClient().request(this.root() + '/' + season.id, 'PATCH', body),
    );
  },
  async command(event) {
    const { type, id } = event.currentTarget.dataset;
    let body;
    try {
      body = model.commandInput(this.data.season, type, id);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const texts = {
      ACTIVATE: ['激活赛季', '激活后赛季进入进行中；仍可归入或移出赛事。'],
      CLOSE: [
        '关闭赛季',
        '关闭后锁定名称、日期和赛事归属，且不能重新打开；球员撤销授权和赛果变化仍会在下一次读取时生效。',
      ],
      ATTACH_EVENT: ['归入赛事', '将这一届赛事明确归入本赛季；每届赛事首版只能属于一个赛季。'],
      DETACH_EVENT: ['移出赛事', '该赛事的数据将不再计入本赛季。'],
    };
    await this.mutate(texts[type][0], texts[type][1], () =>
      api.getClient().request(this.root() + '/' + this.data.season.id + '/commands', 'POST', body),
    );
  },
  async mutate(title, content, send) {
    let result;
    try {
      result = await this.write(title, content, send);
    } catch (error) {
      const conflict = error && error.code === 'VERSION_CONFLICT';
      const text = conflict
        ? '赛季已被其他操作更新，已重新读取，请核对后再操作。'
        : ui.message(error);
      // Re-read the current state first, then explain why nothing was changed.
      if (conflict || !error || !error.status) await this.load();
      if (!this._closed && !this.data.loginRequired) this.setData({ error: text });
      return;
    }
    if (!result) return;
    this.setData({ message: '已保存。' });
    this.load();
  },
});
