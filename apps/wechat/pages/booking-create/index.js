const api = require('../../utils/api');
const ui = require('../../utils/ui');
const sdk = require('../../utils/booking');
const form = require('../../utils/booking-form');
const { recoveryStore } = require('../../utils/booking-recovery');
const EMPTY_QUOTES = {
  service: '¥0.00',
  platform: '¥0.00',
  travel: '¥0.00',
  accommodation: '¥0.00',
  confirmed: '¥0.00',
  conditional: '¥0.00',
  count: 0,
  fixedCount: 0,
  conditionalCount: 0,
};
const PLACEHOLDER_COMMAND = '00000000-0000-4000-8000-000000000001';
function compactMoney(value) {
  return value.replace(/\.00$/, '');
}
function summaryDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return value || '请选择日期';
  return (
    (match[1] === ui.today().slice(0, 4) ? '' : match[1] + '年') +
    Number(match[2]) +
    '月' +
    Number(match[3]) +
    '日'
  );
}
function selected(value, item) {
  return Array.isArray(value) && value.includes(item);
}
function initialIds(query) {
  const raw = String(query.ids || query.playerId || query.profileId || '');
  if (raw.length > 2048) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .filter(form.id)
        .map((id) => id.toLowerCase()),
    ),
  ).slice(0, 3);
}
Page({
  data: {
    loading: false,
    busy: false,
    ready: false,
    loginRequired: false,
    error: '',
    notice: '',
    scope: 'SINGLE',
    scopeOptions: form.SCOPES,
    scopeIndex: 0,
    teams: [],
    teamIndex: 0,
    teamName: '',
    teamId: '',
    events: [],
    eventIndex: 0,
    eventId: '',
    eventName: '',
    players: [],
    selectedCount: 0,
    slots: [],
    matchChoices: [],
    matchIndex: 0,
    periodStart: '',
    periodEnd: '',
    review: false,
    detailsOpen: false,
    editorOpen: false,
    compactQuote: {},
    consent: false,
    quote: EMPTY_QUOTES,
    pending: false,
    invalidRecovery: false,
    storageUnavailable: false,
    storageReadBlocked: false,
    recoveryChecked: false,
    recoveryEventName: '',
    recoveryScope: '',
    recoveryCount: 0,
    recoveryCommand: '',
    recoverySlots: [],
    canRecover: false,
    originalResolvedId: '',
    originalRejected: '',
    canRequote: false,
    success: false,
    successOrderId: '',
    noTeams: false,
    noPlayers: false,
    quoteInvalid: false,
  },
  onLoad(query) {
    this.closed = false;
    this.initialIds = initialIds(query || {});
    this.initialTeamId = form.id(query && query.teamId) ? query.teamId : '';
    this.returnPath =
      '/pages/booking-create/index' +
      (this.initialIds.length ? '?ids=' + this.initialIds.join(',') : '');
  },
  onShow() {
    this.load();
  },
  onUnload() {
    this.closed = true;
    ui.close(this);
  },
  async load() {
    if (this._loading || this._busy) return;
    this._loading = true;
    this.workspace = null;
    this.setData({
      loading: true,
      ready: false,
      error: '',
      teams: [],
      events: [],
      players: [],
      slots: [],
      recoverySlots: [],
      recoveryEventName: '',
      recoveryCommand: '',
      originalResolvedId: '',
      originalRejected: '',
      quote: EMPTY_QUOTES,
      detailsOpen: false,
      editorOpen: false,
      compactQuote: {},
      review: false,
      consent: false,
      noTeams: false,
      noPlayers: false,
    });
    let token;
    try {
      const session = await ui.session(this, this.returnPath || '/pages/booking-create/index');
      if (!session) return;
      token = ui.begin(this);
      const workspace = await sdk.workspace();
      if (this.closed || !ui.live(this, token)) return;
      if (workspace.viewerUserId !== session.user.id)
        throw new Error('当前身份已变化，请重新读取预约资料');
      if (this.actor !== session.user.id) {
        this.draft = null;
        this.entry = null;
      }
      this.actor = session.user.id;
      this.viewRevision = api.getClient().sessionRevision();
      this.needsRequote = false;
      this.workspace = workspace;
      if (!this.draft) {
        const ids = (this.initialIds || []).filter((id) =>
          workspace.players.some((p) => p.id === id && p.userId !== this.actor),
        );
        const team = workspace.teams.find((t) => t.id === this.initialTeamId) || workspace.teams[0];
        const day = ui.today();
        this.draft = {
          scope: 'SINGLE',
          teamId: team ? team.id : '',
          eventId: '',
          eventName: '',
          selectedIds: ids,
          slots: [form.initialSlot(day, ids)],
          periodStart: day,
          periodEnd: day,
          consent: false,
        };
      }
      this.draft.consent = false;
      this.setData({
        ready: true,
        loginRequired: false,
        review: false,
        consent: false,
        canRequote: false,
        noTeams: !workspace.teams.length,
        noPlayers: !workspace.players.some((p) => p.userId !== this.actor),
      });
      this.renderForm();
      this.renderRecovery();
    } catch (error) {
      if (!this.closed && (!token || ui.live(this, token)))
        this.setData({ ready: false, error: ui.message(error) });
    } finally {
      this._loading = false;
      if (!this.closed && (!token || ui.live(this, token))) this.setData({ loading: false });
    }
  },
  renderRecovery(snapshot) {
    if (!this.actor || !this.workspace) return;
    const stored = snapshot || recoveryStore.load(this.actor);
    this.entry = stored.entry;
    const base = {
      pending: !!stored.entry,
      invalidRecovery: stored.invalid,
      storageUnavailable: stored.storageUnavailable,
      storageReadBlocked: stored.storageReadBlocked === true,
      recoveryChecked: false,
      canRecover: false,
      recoveryEventName: '',
      recoveryCommand: '',
      recoveryCount: 0,
      recoveryScope: '',
      recoverySlots: [],
      originalResolvedId: '',
      originalRejected: '',
    };
    if (stored.storageReadBlocked) {
      this.draft.consent = false;
      base.review = false;
      base.consent = false;
    }
    if (stored.entry) {
      const original = JSON.parse(stored.entry.payload);
      const allowed = this.workspace.teams.some(
        (t) => t.id === original.teamId && t.orgId === original.orgId,
      );
      base.canRecover = allowed;
      if (allowed) {
        base.recoveryEventName = original.eventName;
        base.recoveryCommand = original.commandId;
        base.recoveryCount = original.appearances.length;
        base.recoveryScope = ui.scope(original.scope);
        base.recoverySlots = original.appearances.map((a, i) => ({
          key: i,
          label: a.label,
          venue: a.venue,
          schedule: a.conditional ? '条件意向：' + a.conditionText : ui.localTime(a.startAt, true),
        }));
        base.originalResolvedId = stored.entry.resolvedOrderId || '';
        base.originalRejected = stored.entry.rejectedMessage || '';
      }
    }
    this.setData(base);
  },
  renderForm() {
    if (!this.workspace || !this.draft) return;
    const draft = this.draft,
      workspace = this.workspace;
    const team = workspace.teams.find((t) => t.id === draft.teamId);
    const availablePlayers = workspace.players.filter((p) => p.userId !== this.actor);
    const players = availablePlayers.map((p) => ({
      id: p.id,
      label: p.displayName + ' · ' + ui.position(p.position),
      name: p.displayName,
      position: ui.position(p.position),
      meta: [p.heightCm ? String(p.heightCm) + 'cm' : '', p.city || ''].filter(Boolean).join(' · '),
      priceShort: compactMoney(ui.money(p.priceFen)),
      price: ui.money(p.priceFen),
      total: ui.money(
        p.priceFen +
          p.travelFen +
          p.accommodationFen +
          Math.round((p.priceFen * workspace.settings.feeBps) / 10000),
      ),
      selected: draft.selectedIds.includes(p.id),
    }));
    const events = [{ id: '', name: '其他比赛 / 手工填写' }].concat(
      workspace.events.filter((e) => team && e.orgId === team.orgId),
    );
    const matches = workspace.matches.filter(
      (m) =>
        m.eventId === draft.eventId &&
        team &&
        m.orgId === team.orgId &&
        (m.homeTeamId === team.id || m.awayTeamId === team.id),
    );
    const count = form.quoteDraft(draft, workspace);
    const quote = {
      service: ui.money(count.serviceFen),
      platform: ui.money(count.platformFeeFen),
      travel: ui.money(count.travelFen),
      accommodation: ui.money(count.accommodationFen),
      confirmed: ui.money(count.confirmedTotalFen),
      conditional: ui.money(count.conditionalTotalFen),
      count: count.appearanceCount,
      fixedCount: count.fixedCount,
      conditionalCount: count.conditionalCount,
    };
    const slots = draft.slots.map((s, index) => ({
      ...s,
      number: index + 1,
      key: index,
      dayLabel: summaryDay(s.startDate),
      reportLabel:
        s.reportDate === s.startDate ? s.reportTime : summaryDay(s.reportDate) + ' ' + s.reportTime,
      scheduleLabel:
        s.startTime +
        '–' +
        (s.endDate === s.startDate ? s.endTime : summaryDay(s.endDate) + ' ' + s.endTime),
      playerChoices: players
        .filter((p) => draft.selectedIds.includes(p.id))
        .map((p) => ({ ...p, selected: s.profileIds.includes(p.id) })),
    }));
    const quoteInvalid = draft.selectedIds.some((id) => !availablePlayers.some((p) => p.id === id));
    const compactQuote = {};
    Object.keys(quote).forEach((key) => {
      compactQuote[key] = typeof quote[key] === 'string' ? compactMoney(quote[key]) : quote[key];
    });
    this.setData({
      scope: draft.scope,
      scopeIndex: form.SCOPES.findIndex((s) => s.value === draft.scope),
      teams: workspace.teams,
      teamIndex: Math.max(
        0,
        workspace.teams.findIndex((t) => t.id === draft.teamId),
      ),
      teamName: team ? team.name : '',
      teamId: draft.teamId,
      events,
      eventIndex: Math.max(
        0,
        events.findIndex((e) => e.id === draft.eventId),
      ),
      eventId: draft.eventId,
      eventName: draft.eventName,
      detailsOpen:
        this.data.detailsOpen || !draft.selectedIds.length || !draft.eventName || !draft.teamId,
      players,
      slots,
      selectedCount: draft.selectedIds.length,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      matchChoices: [{ id: '', label: '选择本队正式比赛' }].concat(
        matches.map((m) => ({ id: m.id, label: m.label + ' · ' + ui.localTime(m.startAt) })),
      ),
      matchIndex: 0,
      quote,
      compactQuote,
      quoteInvalid,
    });
  },
  editable() {
    return (
      !this.closed &&
      this.data.ready &&
      this.viewRevision === api.getClient().sessionRevision() &&
      !!this.draft &&
      !!this.workspace &&
      !this._busy &&
      !this.data.pending &&
      !this.data.invalidRecovery &&
      !this.data.storageReadBlocked &&
      !this.data.success
    );
  },
  changed() {
    this.draft.consent = false;
    this.setData({
      consent: false,
      review: false,
      error: '',
      canRequote: this.needsRequote === true,
    });
    this.renderForm();
  },
  openEditor() {
    if (!this.editable() || this.data.review) return;
    this.setData({ editorOpen: true, detailsOpen: true });
  },
  closeEditor() {
    if (!this.editable() || this.data.review) return;
    this.setData({ editorOpen: false, detailsOpen: false });
  },
  toggleDetails() {
    if (!this.editable() || this.data.review) return;
    this.setData({ detailsOpen: !this.data.detailsOpen });
  },
  async changeScope(event) {
    if (!this.editable()) return;
    const scope = event.currentTarget.dataset.scope;
    if (!form.SCOPES.some((s) => s.value === scope)) return;
    if (['SINGLE', 'TIME_BLOCK'].includes(scope) && this.draft.slots.length > 1) {
      const actor = this.actor,
        revision = api.getClient().sessionRevision();
      const yes = await ui.confirm(
        '切换合作方式',
        '这会仅保留第一场安排。需要多场时可继续使用多场、整届或赛季合作。',
      );
      if (
        !yes ||
        actor !== this.actor ||
        revision !== api.getClient().sessionRevision() ||
        !this.editable()
      )
        return;
      this.draft.slots = [this.draft.slots[0]];
    }
    this.draft.scope = scope;
    if (['SINGLE', 'TIME_BLOCK'].includes(scope)) this.draft.slots[0].conditional = false;
    this.changed();
  },
  teamPick(event) {
    if (!this.editable()) return;
    const team = this.workspace.teams[Number(event.detail.value)];
    if (!team) return;
    this.draft.teamId = team.id;
    this.draft.eventId = '';
    this.draft.eventName = '';
    this.draft.slots.forEach((s) => {
      s.matchId = '';
    });
    this.changed();
  },
  eventPick(event) {
    if (!this.editable()) return;
    const value = this.data.events[Number(event.detail.value)];
    if (!value) return;
    this.draft.eventId = value.id;
    this.draft.eventName = value.id ? value.name : '';
    this.draft.slots.forEach((s) => {
      s.matchId = '';
    });
    this.changed();
  },
  input(event) {
    if (!this.editable()) return;
    const key = event.currentTarget.dataset.field;
    if (
      !['eventName', 'periodStart', 'periodEnd'].includes(key) ||
      (key === 'eventName' && this.draft.eventId)
    )
      return;
    this.draft[key] = String(event.detail.value);
    this.changed();
  },
  playerPick(event) {
    if (!this.editable()) return;
    const ids = Array.isArray(event.detail.value)
      ? event.detail.value.filter((id) =>
          this.workspace.players.some((p) => p.id === id && p.userId !== this.actor),
        )
      : [];
    if (ids.length > 64) {
      this.renderForm();
      this.setData({ error: '单份预约最多选择64位球员，请分开提交' });
      return;
    }
    const added = ids.filter((id) => !this.draft.selectedIds.includes(id));
    this.draft.selectedIds = Array.from(new Set(ids));
    this.draft.slots.forEach((s) => {
      s.profileIds = s.profileIds.filter((id) => ids.includes(id)).concat(added);
    });
    this.changed();
  },
  slotPlayers(event) {
    if (!this.editable()) return;
    const slot = this.draft.slots[Number(event.currentTarget.dataset.index)];
    if (!slot) return;
    slot.profileIds = Array.from(
      new Set((event.detail.value || []).filter((id) => this.draft.selectedIds.includes(id))),
    );
    this.changed();
  },
  slotInput(event) {
    if (!this.editable()) return;
    const slot = this.draft.slots[Number(event.currentTarget.dataset.index)],
      key = event.currentTarget.dataset.field;
    if (
      !slot ||
      ![
        'label',
        'venue',
        'conditionText',
        'reportDate',
        'reportTime',
        'startDate',
        'startTime',
        'endDate',
        'endTime',
      ].includes(key)
    )
      return;
    slot[key] = String(event.detail.value);
    if (
      [
        'venue',
        'reportDate',
        'reportTime',
        'startDate',
        'startTime',
        'endDate',
        'endTime',
      ].includes(key)
    )
      slot.matchId = '';
    this.changed();
  },
  conditional(event) {
    if (!this.editable() || ['SINGLE', 'TIME_BLOCK'].includes(this.draft.scope)) return;
    const slot = this.draft.slots[Number(event.currentTarget.dataset.index)];
    if (!slot) return;
    slot.conditional = event.detail.value === true;
    slot.matchId = '';
    this.changed();
  },
  addSlot() {
    if (!this.editable() || ['SINGLE', 'TIME_BLOCK'].includes(this.draft.scope)) return;
    if (this.draft.slots.length >= 64) {
      this.setData({ error: '每份预约最多64项球员场次，请拆分提交' });
      return;
    }
    this.draft.slots.push(form.initialSlot(ui.today(), this.draft.selectedIds));
    this.changed();
  },
  removeSlot(event) {
    if (!this.editable() || this.draft.slots.length < 2) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.draft.slots.length) return;
    this.draft.slots.splice(index, 1);
    this.changed();
  },
  matchPick(event) {
    if (!this.editable()) return;
    const choice = this.data.matchChoices[Number(event.detail.value)];
    const match = choice && this.workspace.matches.find((m) => m.id === choice.id);
    if (!match) return;
    const slot = form.fromMatch(match, this.draft.selectedIds, ui.datePart, ui.timePart);
    if (['SINGLE', 'TIME_BLOCK'].includes(this.draft.scope)) this.draft.slots = [slot];
    else this.draft.slots = this.draft.slots.filter((s) => s.matchId !== match.id).concat(slot);
    this.changed();
  },
  review() {
    if (!this.editable()) return;
    if (this.needsRequote) {
      this.setData({ error: '请先读取最新报价，再重新核对本次合作费用' });
      return;
    }
    try {
      form.buildCreate({ ...this.draft, consent: true }, this.workspace, PLACEHOLDER_COMMAND);
      this.draft.consent = false;
      this.setData({ review: true, consent: false, error: '', notice: '' });
    } catch (error) {
      this.setData({ error: ui.message(error) });
    }
  },
  edit() {
    if (!this.editable()) return;
    this.draft.consent = false;
    this.setData({ review: false, consent: false, error: '' });
  },
  consent(event) {
    if (!this.editable() || !this.data.review) return;
    this.draft.consent = selected(event.detail.value, 'agree');
    this.setData({ consent: this.draft.consent });
  },
  async submit() {
    if (!this.editable() || !this.data.review || !this.data.consent || this.needsRequote) return;
    this._busy = true;
    this.setData({ busy: true, error: '' });
    let token;
    try {
      const session = await ui.session(this, this.returnPath);
      if (this.closed) return;
      if (!session || session.user.id !== this.actor) {
        this.setData({ ready: false, error: '当前身份已变化，请重新读取后操作' });
        return;
      }
      token = ui.begin(this);
      const stored = recoveryStore.load(this.actor);
      if (stored.invalid || stored.entry || stored.storageReadBlocked) {
        this.renderRecovery(stored);
        return;
      }
      const commandId = await ui.uuid();
      if (!ui.live(this, token)) return;
      const input = form.buildCreate(this.draft, this.workspace, commandId);
      this.entry = recoveryStore.begin(this.actor, JSON.stringify(input));
      this.renderRecovery();
      await this.sendOriginal(this.entry, token);
    } catch (error) {
      if (!this.closed && (!token || ui.live(this, token))) {
        if (error && error.code === 'RECOVERY_READ_BLOCKED') {
          this.draft.consent = false;
          this.setData({
            storageReadBlocked: true,
            storageUnavailable: true,
            review: false,
            consent: false,
          });
        }
        this.setData({ error: ui.message(error) });
      }
    } finally {
      this._busy = false;
      if (!this.closed && (!token || ui.live(this, token))) this.setData({ busy: false });
    }
  },
  async sendOriginal(entry, token) {
    try {
      const actor = entry.actorUserId;
      const result = await recoveryStore.execute(actor, entry, (payload) => {
        if (!ui.live(this, token) || this.actor !== actor)
          throw new Error('当前身份已变化，原请求仍需核对');
        return sdk.create(payload);
      });
      if (!ui.live(this, token) || this.actor !== actor) return;
      const cleared = recoveryStore.clear(actor, entry);
      if (!cleared) {
        this.renderRecovery();
        this.setData({
          notice: '原预约已创建，恢复标记暂时无法移除。请先查看原预约并检查本机存储权限。',
        });
      } else {
        this.entry = null;
        this.setData({
          pending: false,
          success: true,
          successOrderId: result.id,
          review: false,
          consent: false,
          error: '',
          notice: '合作预约已提交，未发生在线付款。',
        });
      }
    } catch (error) {
      if (!ui.live(this, token) || this.actor !== entry.actorUserId) return;
      if (entry.rejectedMessage && recoveryStore.clear(this.actor, entry)) {
        this.entry = null;
        this.draft.consent = false;
        this.needsRequote = true;
        this.setData({
          pending: false,
          review: false,
          consent: false,
          canRequote: true,
          error: '原请求已明确拒绝：' + entry.rejectedMessage + '。请重新读取报价并核对。',
        });
      } else {
        this.renderRecovery();
        this.setData({ error: ui.message(error) });
      }
    }
  },
  async recover() {
    if (this._busy || !this.entry || !this.data.canRecover) return;
    this._busy = true;
    this.setData({ busy: true, error: '' });
    let token;
    try {
      const session = await ui.session(this, this.returnPath);
      if (this.closed) return;
      if (!session || session.user.id !== this.actor) {
        this.setData({ ready: false, error: '当前身份已变化，请重新读取' });
        return;
      }
      token = ui.begin(this);
      const workspace = await sdk.workspace();
      if (!ui.live(this, token)) return;
      if (workspace.viewerUserId !== this.actor) throw new Error('当前身份已变化，请重新读取');
      this.workspace = workspace;
      this.renderRecovery();
      if (!this.data.canRecover || !this.entry) return;
      await this.sendOriginal(this.entry, token);
    } catch (error) {
      if (!this.closed && (!token || ui.live(this, token)))
        this.setData({ error: ui.message(error) });
    } finally {
      this._busy = false;
      if (!this.closed && (!token || ui.live(this, token))) this.setData({ busy: false });
    }
  },
  recoveryCheck(event) {
    this.setData({ recoveryChecked: selected(event.detail.value, 'checked') });
  },
  async acknowledgeInvalid() {
    if (
      this._busy ||
      !this.actor ||
      !this.data.invalidRecovery ||
      this.data.storageReadBlocked ||
      !this.data.recoveryChecked
    )
      return;
    const session = await ui.session(this, this.returnPath);
    if (this.closed) return;
    if (!session || session.user.id !== this.actor) {
      this.setData({ ready: false, error: '当前身份已变化，请重新读取' });
      return;
    }
    const ok = recoveryStore.acknowledgeInvalid(this.actor);
    if (ok) {
      this.setData({
        invalidRecovery: false,
        recoveryChecked: false,
        review: false,
        consent: false,
        error: '',
      });
      this.draft.consent = false;
    } else
      this.setData({
        storageUnavailable: true,
        error: '恢复标记无法移除，请检查本机存储权限后再核对',
      });
  },
  requote() {
    if (!this.data.pending && !this.data.invalidRecovery) this.load();
  },
  login() {
    ui.login(this.returnPath || '/pages/booking-create/index');
  },
  orders() {
    ui.open('bookings');
  },
  players() {
    ui.open('players');
  },
  playerCenter() {
    ui.open('player-center');
  },
  result() {
    const id = this.data.successOrderId || this.data.originalResolvedId;
    if (form.id(id)) ui.open('booking-detail', { id });
  },
});
