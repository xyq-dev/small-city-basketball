const sdk = require('../../utils/booking');
const ui = require('../../utils/ui');
const api = require('../../utils/api');
const model = require('../../utils/performance-links');
const basePath = '/pages/performance/index';

Page({
  data: {
    authorized: false,
    loginRequired: false,
    loading: false,
    pageLoading: false,
    sourceLoading: false,
    busy: false,
    checking: false,
    error: '',
    pageError: '',
    message: '',
    ownOnly: false,
    ownProfileId: null,
    filter: 'ALL',
    links: [],
    linksHasMore: false,
    nextCursor: null,
    disclosureNotice: '',
    manageableEvents: [],
    profiles: [],
    teams: [],
    members: [],
    eventIndex: -1,
    teamIndex: -1,
    memberIndex: -1,
    profileIndex: -1,
    selectedEvent: '',
    selectedTeam: '',
    selectedMember: '',
    selectedProfile: '',
    draft: model.emptyDraft(),
    dirty: false,
    pending: null,
    pendingUnknown: false,
    nominationUnknown: false,
  },
  onLoad(query) {
    this.setData({ ownOnly: query && query.own === '1' });
  },
  onShow() {
    this._hidden = false;
    this.load();
  },
  onHide() {
    this._hidden = true;
    this._life = (this._life || 0) + 1;
    ui.begin(this);
    this.setData({
      loading: false,
      pageLoading: false,
      sourceLoading: false,
      checking: false,
      busy: false,
    });
  },
  onUnload() {
    this._closed = true;
    this._life = (this._life || 0) + 1;
    ui.close(this);
  },
  returnPath() {
    return basePath + (this.data.ownOnly ? '?own=1' : '');
  },
  active(token) {
    if (this._closed || this._hidden) return false;
    if (this._revision !== undefined && this._revision !== api.getClient().sessionRevision()) {
      this.clearPrivate();
      return false;
    }
    return ui.live(this, token);
  },
  clearPrivate() {
    this._actor = null;
    this._links = [];
    this._sources = null;
    this._pendingNomination = null;
    this._pendingCommand = null;
    this.setData({
      authorized: false,
      ownProfileId: null,
      links: [],
      linksHasMore: false,
      nextCursor: null,
      manageableEvents: [],
      profiles: [],
      teams: [],
      members: [],
      draft: model.emptyDraft(),
      dirty: false,
      eventIndex: -1,
      teamIndex: -1,
      memberIndex: -1,
      profileIndex: -1,
      selectedEvent: '',
      selectedTeam: '',
      selectedMember: '',
      selectedProfile: '',
      pending: null,
      pendingUnknown: false,
      nominationUnknown: false,
      busy: false,
      checking: false,
      sourceLoading: false,
      pageLoading: false,
      loading: false,
      disclosureNotice: '',
      message: '',
    });
  },
  blocked() {
    return (
      this.data.loading ||
      this.data.pageLoading ||
      this.data.sourceLoading ||
      this.data.checking ||
      this.data.busy ||
      this.data.dirty ||
      !!this.data.pending ||
      !!this._pendingNomination
    );
  },
  login() {
    ui.login(this.returnPath());
  },
  center() {
    ui.open('player-center');
  },
  async load(force) {
    if (this.data.loading) return;
    const life = (this._life = (this._life || 0) + 1);
    this.setData({ authorized: false, loading: true, error: '', pageError: '' });
    const session = await ui.session(this, this.returnPath());
    if (this._closed || this._hidden || life !== this._life) return;
    if (!session) {
      this.clearPrivate();
      return;
    }
    const actor = session.user.id;
    const revision = api.getClient().sessionRevision();
    if (this._actor !== actor || (this._revision !== undefined && this._revision !== revision))
      this.clearPrivate();
    this._revision = revision;
    this._actor = actor;
    if (force !== true && (this.data.dirty || this._pendingCommand || this._pendingNomination)) {
      this.setData({
        authorized: true,
        loginRequired: false,
        loading: false,
        busy: !!(
          (this._pendingCommand && this._pendingCommand.inFlight) ||
          (this._pendingNomination && this._pendingNomination.inFlight)
        ),
        pendingUnknown: !!(this._pendingCommand && this._pendingCommand.payload),
        nominationUnknown: !!this._pendingNomination,
      });
      return;
    }
    this._links = [];
    this.setData({
      links: [],
      pending: null,
      ownProfileId: null,
      nextCursor: null,
      linksHasMore: false,
      manageableEvents: [],
      profiles: [],
      teams: [],
      members: [],
      sourceLoading: false,
      checking: false,
    });
    const token = ui.begin(this);
    try {
      const values = await Promise.all([sdk.performanceWorkspace(), sdk.workspace()]);
      if (!this.active(token)) return;
      const workspace = values[0],
        booking = values[1];
      if (workspace.viewerUserId !== actor || booking.viewerUserId !== actor)
        throw new Error('账号已变化，请重新读取授权资料');
      const cursor = model.cursorAfter(workspace);
      this._links = workspace.links;
      this._sources = null;
      this.setData({
        authorized: true,
        loginRequired: false,
        loading: false,
        ownProfileId: workspace.ownProfileId,
        manageableEvents: workspace.manageableEvents,
        profiles: booking.players.filter((p) => p.status === 'APPROVED'),
        linksHasMore: workspace.linksHasMore,
        nextCursor: cursor,
        disclosureNotice: workspace.disclosureNotice,
        draft: model.emptyDraft(),
        dirty: false,
        pending: null,
        busy: false,
        nominationUnknown: false,
        selectedEvent: '',
        selectedTeam: '',
        selectedMember: '',
        selectedProfile: '',
        eventIndex: -1,
        teamIndex: -1,
        memberIndex: -1,
        profileIndex: -1,
      });
      this.updateLinks();
    } catch (error) {
      if (this.active(token)) {
        this.clearPrivate();
        this.setData({ error: ui.message(error), loading: false });
      }
    }
  },
  refresh() {
    if (this.blocked()) {
      this.setData({ message: '请先完成或关闭当前草稿/确认操作，再刷新或加载历史。' });
      return;
    }
    this.load(true);
  },
  updateLinks() {
    const links = model
      .visibleLinks(this._links || [], this.data.ownOnly, this.data.ownProfileId, this.data.filter)
      .map((l) => ({
        ...l,
        statusText: model.labels[l.status],
        createdText: ui.localTime(l.createdAt, true),
        sourceText: l.sourceCurrentlyAvailable ? '来源当前有效' : '来源已失效或暂不可用',
        revokeText: l.status === 'PENDING' ? '拒绝本次公开' : '撤销公开授权',
      }));
    this.setData({ links });
  },
  filter(e) {
    if (this.blocked()) return;
    const filter = e.currentTarget.dataset.filter;
    if (!['ALL', 'PENDING', 'APPROVED', 'REVOKED'].includes(filter)) return;
    this.setData({ filter });
    this.updateLinks();
  },
  async more() {
    if (!this.data.authorized || this.blocked() || !this.data.linksHasMore || !this.data.nextCursor)
      return;
    const cursor = this.data.nextCursor,
      actor = this._actor,
      token = ui.begin(this);
    this.setData({ pageLoading: true, pageError: '' });
    try {
      const response = await sdk.performanceWorkspace(cursor);
      if (!this.active(token) || this._actor !== actor) return;
      if (response.viewerUserId !== actor) throw new Error('授权分页账号不一致，请重新读取');
      const next = model.cursorAfter(response, cursor);
      this._links = model.mergeLinks(this._links, response.links);
      this.setData({ nextCursor: next, linksHasMore: response.linksHasMore, pageLoading: false });
      this.updateLinks();
    } catch (error) {
      if (this.active(token) && this._actor === actor) {
        if (Number(error.status) === 401 || Number(error.status) === 403) {
          this.clearPrivate();
          this.setData({ error: ui.message(error) });
        } else
          this.setData({
            pageLoading: false,
            pageError: ui.message(error) + '，当前游标未推进，可重试同一页。',
          });
      }
    }
  },
  async chooseEvent(e) {
    if (
      !this.data.authorized ||
      this.data.busy ||
      this.data.pending ||
      this._pendingNomination ||
      this.data.pageLoading
    )
      return;
    const index = Number(e.detail.value),
      event = this.data.manageableEvents[index];
    if (!event) return;
    const draft = {
      ...this.data.draft,
      eventId: event.id,
      orgId: event.orgId,
      teamId: '',
      memberId: '',
      publisherConsent: false,
    };
    this._sources = null;
    this.setData({
      draft,
      dirty: true,
      eventIndex: index,
      teamIndex: -1,
      memberIndex: -1,
      selectedEvent: event.name,
      selectedTeam: '',
      selectedMember: '',
      teams: [],
      members: [],
      sourceLoading: true,
      error: '',
      message: '',
    });
    const token = ui.begin(this),
      actor = this._actor;
    try {
      const sources = await sdk.sources(event.orgId, event.id);
      if (!this.active(token) || actor !== this._actor || this.data.draft.eventId !== event.id)
        return;
      if (sources.event.id !== event.id || sources.event.orgId !== event.orgId)
        throw new Error('名单来源与所选赛事不一致');
      this._sources = sources;
      this.setData({ teams: sources.teams, sourceLoading: false });
    } catch (error) {
      if (this.active(token))
        this.setData({ teams: [], members: [], sourceLoading: false, error: ui.message(error) });
    }
  },
  retrySources() {
    if (this.data.eventIndex >= 0)
      this.chooseEvent({ detail: { value: String(this.data.eventIndex) } });
  },
  chooseTeam(e) {
    if (this.data.busy || this.data.sourceLoading || this.data.pending || this._pendingNomination)
      return;
    const index = Number(e.detail.value),
      team = this.data.teams[index];
    if (!team) return;
    const members = team.members.map((m) => ({
      ...m,
      label: m.name + ' · #' + m.jerseyNo + ' · ' + m.id.slice(0, 8),
    }));
    this.setData({
      teamIndex: index,
      memberIndex: -1,
      selectedTeam: team.name,
      selectedMember: '',
      members,
      draft: { ...this.data.draft, teamId: team.id, memberId: '', publisherConsent: false },
      dirty: true,
    });
  },
  chooseMember(e) {
    if (this.data.busy || this.data.sourceLoading || this.data.pending || this._pendingNomination)
      return;
    const index = Number(e.detail.value),
      member = this.data.members[index];
    if (!member) return;
    this.setData({
      memberIndex: index,
      selectedMember: member.label,
      draft: { ...this.data.draft, memberId: member.id, publisherConsent: false },
      dirty: true,
    });
  },
  chooseProfile(e) {
    if (this.data.busy || this.data.pending || this._pendingNomination) return;
    const index = Number(e.detail.value),
      profile = this.data.profiles[index];
    if (!profile || profile.status !== 'APPROVED') return;
    this.setData({
      profileIndex: index,
      selectedProfile: profile.displayName + ' · ' + profile.id.slice(0, 8),
      draft: { ...this.data.draft, profileId: profile.id, publisherConsent: false },
      dirty: true,
    });
  },
  draftReason(e) {
    if (this.data.busy || this.data.pending || this._pendingNomination) return;
    const draft = { ...this.data.draft, reason: String(e.detail.value), publisherConsent: false };
    this.setData({ draft, dirty: model.draftDirty(draft) });
  },
  publisherConsent(e) {
    if (this.data.busy || this.data.pending || this._pendingNomination) return;
    const draft = {
      ...this.data.draft,
      publisherConsent: Array.isArray(e.detail.value) && e.detail.value.includes('yes'),
    };
    this.setData({ draft, dirty: model.draftDirty(draft) });
  },
  async discardDraft() {
    if (this.data.busy || this.data.sourceLoading || this._pendingNomination) return;
    if (
      this.data.dirty &&
      !(await ui.confirm('放弃未提交的提名？', '当前选择和原因会被清空，已保存的授权不会被撤销。'))
    )
      return;
    this._sources = null;
    this.setData({
      draft: model.emptyDraft(),
      dirty: false,
      teams: [],
      members: [],
      eventIndex: -1,
      teamIndex: -1,
      memberIndex: -1,
      profileIndex: -1,
      selectedEvent: '',
      selectedTeam: '',
      selectedMember: '',
      selectedProfile: '',
      error: '',
      message: '',
    });
  },
  async nominate() {
    if (
      !this.data.authorized ||
      this.data.busy ||
      this.data.sourceLoading ||
      this.data.pending ||
      this.data.pageLoading ||
      (this._pendingNomination && this._pendingNomination.inFlight)
    )
      return;
    const actor = this._actor,
      token = ui.begin(this);
    let pending = this._pendingNomination;
    this.setData({ busy: true, error: '', message: '' });
    try {
      if (!pending) {
        model.nominateInput(
          this.data.draft,
          this.data.manageableEvents,
          this._sources,
          this.data.profiles,
          'validation',
        );
        const id = await ui.uuid();
        if (!this.active(token)) return;
        pending = {
          actor,
          payload: model.nominateInput(
            this.data.draft,
            this.data.manageableEvents,
            this._sources,
            this.data.profiles,
            id,
          ),
          inFlight: false,
        };
        this._pendingNomination = pending;
      }
      if (pending.actor !== actor) throw new Error('不能重放其他账号的提名');
      pending.inFlight = true;
      const saved = await sdk.nominate(pending.payload);
      if (!this.active(token) || actor !== this._actor) return;
      if (
        saved.profileId !== pending.payload.profileId ||
        saved.eventId !== pending.payload.eventId ||
        saved.memberId !== pending.payload.memberId
      )
        throw new Error('保存的授权对象不一致，请重新核对');
      this._pendingNomination = null;
      this._sources = null;
      this.setData({
        busy: false,
        draft: model.emptyDraft(),
        dirty: false,
        nominationUnknown: false,
        message: '提名已保存，等待球员本人明确同意；当前尚不因此公开。',
      });
      await this.load(true);
    } catch (error) {
      if (this.active(token) && actor === this._actor) {
        if (Number(error.status) >= 400 && Number(error.status) < 500)
          this._pendingNomination = null;
        this.setData({ error: ui.message(error), nominationUnknown: !!this._pendingNomination });
      }
    } finally {
      if (pending) pending.inFlight = false;
      if (
        pending &&
        this._pendingNomination === pending &&
        !this._hidden &&
        !this._closed &&
        actor === this._actor &&
        this._revision === api.getClient().sessionRevision()
      )
        this.setData({ busy: false });
      if (this.active(token) && actor === this._actor) this.setData({ busy: false });
    }
  },
  async checkLink(e) {
    if (!this.data.authorized || this.blocked()) return;
    const { id, type } = e.currentTarget.dataset;
    const row = this._links.find((l) => l.id === id);
    if (!row || !model.allowed(row, type)) return;
    const actor = this._actor,
      token = ui.begin(this);
    this.setData({ checking: true, error: '', message: '' });
    try {
      const fresh = await sdk.link(id);
      if (!this.active(token) || actor !== this._actor) return;
      if (fresh.id !== id || !model.allowed(fresh, type))
        throw new Error('当前已不能执行这项授权操作，请刷新核对');
      const commandId = await ui.uuid();
      if (!this.active(token)) return;
      this._links = model.mergeLinks(this._links, [fresh]);
      this.updateLinks();
      this._pendingCommand = {
        actor,
        link: fresh,
        type,
        commandId,
        payload: null,
        inFlight: false,
      };
      this.setData({
        pending: this.dialogData(fresh, type),
        pendingUnknown: false,
        checking: false,
      });
    } catch (error) {
      if (this.active(token)) {
        this._links = this._links.filter((l) => l.id !== id);
        this.updateLinks();
        this.setData({ error: ui.message(error), checking: false });
      }
    }
  },
  dialogData(link, type) {
    return {
      link,
      type,
      title:
        type === 'CONSENT'
          ? '核对并同意公开本人记录'
          : link.status === 'PENDING'
            ? '拒绝本次公开'
            : '撤销公开授权',
      reason: '',
      consent: false,
    };
  },
  dialogReason(e) {
    if (!this.data.pending || this.data.busy || this.data.pendingUnknown) return;
    this.setData({
      pending: { ...this.data.pending, reason: String(e.detail.value), consent: false },
    });
  },
  playerConsent(e) {
    if (!this.data.pending || this.data.busy || this.data.pendingUnknown) return;
    this.setData({
      pending: {
        ...this.data.pending,
        consent: Array.isArray(e.detail.value) && e.detail.value.includes('yes'),
      },
    });
  },
  closeDialog() {
    if (this.data.busy || this.data.pendingUnknown) return;
    this._pendingCommand = null;
    this.setData({ pending: null, pendingUnknown: false, error: '' });
  },
  async submitDialog() {
    const pending = this._pendingCommand;
    if (
      !pending ||
      !this.data.authorized ||
      this.data.busy ||
      pending.inFlight ||
      pending.actor !== this._actor
    )
      return;
    const actor = this._actor,
      token = ui.begin(this);
    this.setData({ busy: true, error: '', message: '' });
    try {
      if (!pending.payload) {
        model.commandInput(
          pending.link,
          pending.type,
          this.data.pending.reason,
          this.data.pending.consent,
          pending.commandId,
        );
        const fresh = await sdk.link(pending.link.id);
        if (!this.active(token)) return;
        if (fresh.id !== pending.link.id || !model.allowed(fresh, pending.type))
          throw { status: 409, message: '当前权限或授权状态已变化，请刷新重新核对' };
        if (fresh.version !== pending.link.version) {
          pending.link = fresh;
          this._links = model.mergeLinks(this._links, [fresh]);
          this.updateLinks();
          this.setData({
            pending: this.dialogData(fresh, pending.type),
            error: '记录版本已变化，请重新核对内容并明确确认。',
            busy: false,
          });
          return;
        }
        pending.payload = model.commandInput(
          fresh,
          pending.type,
          this.data.pending.reason,
          this.data.pending.consent,
          pending.commandId,
        );
      } else {
        // Retrying a lost response must replay the original immutable command,
        // including the old version. Current access is still rechecked by GET and server.
        const fresh = await sdk.link(pending.link.id);
        if (!this.active(token)) return;
        if (fresh.id !== pending.link.id) throw new Error('核对记录不一致');
      }
      pending.inFlight = true;
      const saved = await sdk.performanceCommand(pending.link.id, pending.payload);
      if (!this.active(token) || actor !== this._actor) return;
      if (saved.id !== pending.link.id) throw new Error('授权处理结果不一致，请继续核对原操作');
      this._pendingCommand = null;
      this.setData({
        pending: null,
        pendingUnknown: false,
        busy: false,
        message: '授权处理已保存，公开统计在下次读取时按当前来源重新计算。',
      });
      await this.load(true);
    } catch (error) {
      if (this.active(token) && actor === this._actor) {
        const terminal = Number(error.status) >= 400 && Number(error.status) < 500;
        if (terminal) {
          this._pendingCommand = null;
          this._links = this._links.filter((l) => l.id !== pending.link.id);
          this.updateLinks();
          this.setData({ pending: null, pendingUnknown: false });
        }
        this.setData({ error: ui.message(error), pendingUnknown: !terminal && !!pending.payload });
      }
    } finally {
      pending.inFlight = false;
      if (
        this._pendingCommand === pending &&
        !this._hidden &&
        !this._closed &&
        actor === this._actor &&
        this._revision === api.getClient().sessionRevision()
      )
        this.setData({ busy: false });
      if (this.active(token) && actor === this._actor) this.setData({ busy: false });
    }
  },
});
