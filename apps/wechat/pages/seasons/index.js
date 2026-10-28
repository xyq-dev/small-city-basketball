const api = require('../../utils/api');
const ui = require('../../utils/ui');
const model = require('../../utils/seasons');
const recovery = require('../../utils/season-recovery');
const basePath = '/pages/seasons/index';
const grantsPath = '/pages/season-grants/index';

const emptyDraft = () => ({ name: '', startDate: '', endDate: '' });
// Private, account-bound state; cleared on every identity change, sign-out or unload.
const privateDefaults = () => ({
  seasons: [],
  nextCursor: null,
  loadingMore: false,
  moreError: '',
  season: null,
  edit: emptyDraft(),
  board: null,
  boardError: '',
  candidateLoadingMore: false,
  candidateMoreError: '',
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
    this.setData({
      loading: true,
      loadingMore: false,
      moreError: '',
      candidateLoadingMore: false,
      candidateMoreError: '',
      error: '',
    });
    const session = await ui.session(this, this.returnPath());
    if (!session || !ui.live(this, token)) return;
    const client = api.getClient();
    try {
      if (!this.data.seasonId) {
        this._pendingCreate = recovery.read(client.viewerId(), 'CREATE', this.data.orgId);
        if (this._pendingCreate) {
          const { name, startDate, endDate } = this._pendingCreate;
          this.setData({ draft: { name, startDate, endDate }, createPending: true });
        }
      }
      if (this.data.seasonId) {
        const season = (await client.request(this.root() + '/' + this.data.seasonId)).data;
        if (!ui.live(this, token)) return;
        this.setData({
          season: model.seasonView(season),
          edit: { name: season.name, startDate: season.startDate, endDate: season.endDate },
        });
        await this.loadBoard(token);
      } else {
        const response = await client.request(this.root());
        if (!ui.live(this, token)) return;
        this.setData({
          seasons: response.data.map(model.seasonView),
          nextCursor: response.meta.nextCursor || null,
        });
      }
    } catch (error) {
      if (ui.live(this, token))
        this.setData({
          season: null,
          seasons: [],
          board: null,
          error:
            error && error.status === 403
              ? '仅机构负责人/管理员可管理私有赛季；只管理某一届赛事不能查看赛季汇总。'
              : ui.message(error),
        });
    } finally {
      if (ui.live(this, token)) this.setData({ loading: false });
    }
  },
  async loadMore() {
    if (
      this.data.seasonId ||
      this.data.busy ||
      this.data.loading ||
      this.data.loadingMore ||
      !this.data.nextCursor ||
      this._closed
    )
      return;
    const token = ui.guard(this);
    const generation = this._requestRevision;
    const valid = () => ui.held(this, token) && generation === this._requestRevision;
    this.setData({ loadingMore: true, moreError: '' });
    try {
      const response = await api
        .getClient()
        .request(this.root() + '?cursor=' + encodeURIComponent(this.data.nextCursor));
      if (!valid()) return;
      const ids = new Set(this.data.seasons.map((s) => s.id));
      this.setData({
        seasons: this.data.seasons.concat(
          response.data.filter((s) => !ids.has(s.id)).map(model.seasonView),
        ),
        nextCursor: response.meta.nextCursor || null,
      });
    } catch (error) {
      if (valid()) this.setData({ moreError: ui.message(error) });
    } finally {
      if (valid()) this.setData({ loadingMore: false });
    }
  },
  async loadMoreCandidates() {
    const season = this.data.season;
    if (
      !season ||
      !season.candidateNextCursor ||
      this.data.busy ||
      this.data.loading ||
      this.data.candidateLoadingMore ||
      this._closed
    )
      return;
    const token = ui.guard(this);
    const generation = this._requestRevision;
    const valid = () => ui.held(this, token) && generation === this._requestRevision;
    this.setData({ candidateLoadingMore: true, candidateMoreError: '' });
    try {
      const result = (
        await api
          .getClient()
          .request(
            this.root() +
              '/' +
              season.id +
              '?candidateCursor=' +
              encodeURIComponent(season.candidateNextCursor),
          )
      ).data;
      if (!valid()) return;
      if (!this.data.season || result.version !== this.data.season.version)
        throw new Error('赛季资料已更新，请刷新后再选择赛事');
      const ids = new Set(this.data.season.candidates.map((e) => e.eventId));
      this.setData({
        'season.candidates': this.data.season.candidates.concat(
          result.candidates.filter((e) => !ids.has(e.eventId)),
        ),
        'season.candidateNextCursor': result.candidateNextCursor || null,
      });
    } catch (error) {
      if (valid()) this.setData({ candidateMoreError: ui.message(error) });
    } finally {
      if (valid()) this.setData({ candidateLoadingMore: false });
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
  /** Keep the original confirmation alive through preparation and the actual send. */
  async write(title, content, send, unchanged = () => true) {
    if (this.data.busy || this.data.loading || this._closed) return null;
    const op = await ui.confirmOp(this, title, content);
    if (!op) return null;
    const current = () => {
      if (!op.valid()) return false;
      if (!unchanged()) {
        this.setData({ error: '资料或操作目标已更新，请重新核对后再确认。' });
        return false;
      }
      return true;
    };
    if (!current()) return null;
    const token = ui.hold(this);
    const valid = () => ui.held(this, token) && current();
    this.setData({ busy: true, error: '', message: '' });
    try {
      if (!valid()) return null;
      const result = await send(valid);
      return ui.held(this, token) ? result : null;
    } catch (error) {
      if (!ui.held(this, token)) return null;
      throw error;
    } finally {
      if (ui.held(this, token)) this.setData({ busy: false });
    }
  },
  async create() {
    if (this.data.busy || this.data.loading || this._closed) return;
    const draft = { ...this.data.draft };
    const actor = api.getClient().viewerId();
    const orgId = this.data.orgId;
    let created;
    try {
      model.seasonDraft(draft);
      const before = JSON.stringify(draft);
      created = await this.write(
        '创建私有赛季',
        '创建后为草稿；赛事须由您逐一明确归入，不会按日期自动归属。',
        async (valid) => {
          const input = this._pendingCreate || model.createInput(draft, await ui.uuid());
          if (!valid()) return null;
          recovery.save(actor, 'CREATE', orgId, input);
          this._pendingCreate = input;
          if (!valid()) return null;
          return api.getClient().request('/v1/orgs/' + orgId + '/seasons', 'POST', input);
        },
        () => this.data.orgId === orgId && JSON.stringify(this.data.draft) === before,
      );
    } catch (error) {
      if (this._closed || api.getClient().viewerId() !== actor) return;
      const unknown = recovery.unknown(error);
      if (!unknown && this._pendingCreate) {
        recovery.clear(actor, 'CREATE', orgId, this._pendingCreate);
        this._pendingCreate = null;
      }
      this.setData({
        createPending: unknown && !!this._pendingCreate,
        error:
          unknown && this._pendingCreate
            ? '创建结果未知。请点“核对并重试”，将沿用原请求编号，不会重复创建。'
            : ui.message(error),
      });
      return;
    }
    if (!created) return;
    recovery.clear(actor, 'CREATE', orgId, this._pendingCreate);
    this._pendingCreate = null;
    this.setData({ createPending: false, draft: emptyDraft(), message: '赛季已创建（草稿）。' });
    wx.navigateTo({
      url: basePath + model.seasonsPath({ orgId, seasonId: created.data.id }),
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
    const snapshot = JSON.stringify({ season, edit: this.data.edit });
    await this.mutate(
      '保存赛季资料',
      '修改名称或日期；日期须覆盖已归入的赛事。',
      () => api.getClient().request(this.root() + '/' + season.id, 'PATCH', body),
      () => snapshot === JSON.stringify({ season: this.data.season, edit: this.data.edit }),
    );
  },
  async command(event) {
    const { type, id } = event.currentTarget.dataset;
    const season = this.data.season;
    const snapshot = JSON.stringify(season);
    let body;
    try {
      body = model.commandInput(season, type, id);
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
    await this.mutate(
      texts[type][0],
      texts[type][1],
      () => api.getClient().request(this.root() + '/' + season.id + '/commands', 'POST', body),
      () => snapshot === JSON.stringify(this.data.season),
    );
  },
  async mutate(title, content, send, unchanged) {
    let result;
    try {
      result = await this.write(title, content, send, unchanged);
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
