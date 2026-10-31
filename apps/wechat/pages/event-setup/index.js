const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');
const scoringView = require('../../utils/scoring');
const directoryUtil = require('../../utils/directory');
const regions = require('../../utils/regions');
const templates = require('../../utils/event-templates');

// Native forms over the existing event-setup commands. Each section is shown only when the
// server's capabilities allow it, and every write carries the version it was read at.
const FORMATS = [
  { value: 'ROUND_ROBIN', label: '单循环' },
  { value: 'SINGLE_ELIMINATION', label: '单淘汰' },
  { value: 'GROUP_KNOCKOUT', label: '分组循环接淘汰' },
  { value: 'DOUBLE_ROUND_ROBIN', label: '双循环（主客各一场）' },
];
const TIEBREAKERS = [
  { value: 'SCORE_DIFFERENCE', label: '净胜分' },
  { value: 'POINTS_FOR', label: '总得分' },
  { value: 'WINS', label: '胜场' },
];
const privateDefaults = {
  event: null,
  draft: null,
  registration: null,
  scoring: null,
  standings: null,
  viewing: null,
  directory: null,
  unavailable: false,
  setupGuide: null,
  guideError: '',
  templateOptions: [{ label: '不使用模板' }],
  templateIndex: 0,
  templatePreview: null,
  templateCanManage: false,
  templateLoading: false,
  templateError: '',
  templatePending: false,
  templateName: '',
  templateExpectedTeams: '',
  templateScheduling: null,
  templateCanArchive: false,
  templateArchiveReason: '',
};
const DIRECTORY_GROUP_LABELS = { LIVE: '进行中', UPCOMING: '即将开始', HISTORY: '历史赛事' };
const DIRECTORY_REVOKED = {
  UNLIST: '已手动撤出目录。',
  PUBLICATION_REVOKED: '公开观赛授权已撤销（关闭、完赛、重新开放或发布新轮次），目录已自动撤出。',
  ORGANIZATION_DISABLED: '机构停用时目录已自动撤出。',
};
function directoryFailure(error) {
  const codes = {
    DIRECTORY_ALREADY_LISTED: '该赛事已在公开目录中，已重新读取。',
    DIRECTORY_NOT_LISTED: '该赛事当前不在公开目录中，已重新读取。',
    PUBLIC_VIEWING_NOT_ENABLED: '请先开启公开观赛，再列入目录。',
    INVALID_EVENT_STATE: '当前赛事状态与公开观赛用途不符，不能列入目录。',
    VERSION_CONFLICT: '赛事已被其他操作更新，已重新读取，请核对后再操作。',
    REGION_CATALOG_CHANGED: '地区目录已更新，请重新选择并确认地区。',
    INVALID_REGION: '该地区已不再可选，请重新选择。',
    DIRECTORY_LISTING_CHANGED: '目录记录已变化，已重新读取，请核对后再操作。',
    DIRECTORY_REGION_UNCHANGED: '当前记录已是这一标准地区，无需重复更正。',
  };
  if (error && !error.status)
    return '目录操作结果未知：请点“刷新”重新读取核对后再决定，不要直接重复提交。';
  return (error && codes[error.code]) || ui.message(error);
}
const date = /^\d{4}-\d{2}-\d{2}$/;
function int(value, label, min, max) {
  const n = Number(value);
  if (!/^\d+$/.test(String(value).trim()) || !Number.isSafeInteger(n) || n < min || n > max)
    throw new Error(label + '请填写' + min + '至' + max + '的整数');
  return n;
}
function eventInput(form) {
  const name = String(form.name || '').trim();
  if (name.length < 1 || name.length > 80) throw new Error('赛事名称请填写1至80个字');
  if (!date.test(form.startDate) || !date.test(form.endDate) || form.endDate < form.startDate)
    throw new Error('请选择有效的开始与结束日期');
  const venue = String(form.venueName || '').trim();
  if (venue.length > 100) throw new Error('场地名称最多100个字');
  return {
    name,
    startDate: form.startDate,
    endDate: form.endDate,
    timezone: 'Asia/Shanghai',
    ...(venue ? { venueName: venue } : {}),
    format: form.format,
  };
}
// Server order first (that order is the ranking), then the unused options. Only an explicit
// toggle or move by the organizer changes what is sent back.
function tiebreakerRows(saved) {
  const order = saved || ['SCORE_DIFFERENCE', 'POINTS_FOR'];
  const known = (v) => TIEBREAKERS.find((t) => t.value === v);
  return ranked([
    ...order.filter(known).map((v) => ({ ...known(v), on: true })),
    ...TIEBREAKERS.filter((t) => !order.includes(t.value)).map((t) => ({ ...t, on: false })),
  ]);
}
function ranked(rows) {
  let rank = 0;
  return rows.map((t) => ({ ...t, rank: t.on ? String(++rank) : '' }));
}
function orderLabel(rows) {
  const on = rows.filter((t) => t.on).map((t) => t.label);
  return on.length ? on.join(' → ') : '不设同分比较';
}
// Durations are whole seconds on the server; edit them as minutes plus seconds, never rounded.
function clock(seconds) {
  return { minutes: String(Math.floor(seconds / 60)), seconds: String(seconds % 60) };
}
function seconds(minutes, secs, label, max) {
  const total = int(minutes, label + '分钟', 0, max / 60) * 60 + int(secs, label + '秒数', 0, 59);
  if (total < 1 || total > max) throw new Error(label + '须为1秒至' + max / 60 + '分钟');
  return total;
}
function failure(error) {
  if (error && error.code === 'VERSION_CONFLICT')
    return '赛事已被其他操作更新，已重新读取，请核对后再保存。';
  return ui.message(error);
}

Page({
  data: {
    loading: false,
    busy: false,
    error: '',
    notice: '',
    creating: false,
    formats: FORMATS,
    tiebreakers: TIEBREAKERS,
    ...privateDefaults,
  },
  onLoad(query = {}) {
    this._alive = true;
    try {
      this.orgId = api.uuid(query.orgId);
      this.eventId = query.eventId ? api.uuid(query.eventId) : '';
    } catch {
      this.setData({ unavailable: true, error: '入口无效，请从赛事详情重新进入。' });
      return;
    }
    if (!this.eventId) {
      const day = ui.today();
      this.setData({
        creating: true,
        draft: {
          name: '',
          startDate: day,
          endDate: day,
          venueName: '',
          format: 'ROUND_ROBIN',
          formatIndex: 0,
        },
      });
      this.loadTemplates();
      return;
    }
    this.load();
  },
  onUnload() {
    this._alive = false;
    this._load = (this._load || 0) + 1;
    ui.close(this);
  },
  onSessionReset() {
    this._load = (this._load || 0) + 1;
    this._directory = null;
    this._templateLoad = (this._templateLoad || 0) + 1;
    this._templateRows = null;
    this._selectedTemplate = null;
    this._pendingTemplate = null;
    this._guide = null;
    this._regionPick = (this._regionPick || 0) + 1;
    this._directoryEdit = (this._directoryEdit || 0) + 1;
    this.setData({
      ...privateDefaults,
      loading: false,
      busy: false,
      error: '登录身份已变化，已清除上一身份的赛事设置。',
    });
  },
  base() {
    return '/v1/orgs/' + this.orgId + '/events/' + this.eventId;
  },
  async load() {
    if (!this.eventId || this.data.loading || this.data.busy) return;
    const client = api.getClient();
    const load = (this._load = (this._load || 0) + 1);
    const current = () => this._alive && load === this._load;
    if (!client.hasSession()) {
      this.setData({ ...privateDefaults, unavailable: true, error: '请先登录后设置赛事。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      await events.session(client);
    } catch (error) {
      if (current()) this.setData({ ...privateDefaults, loading: false, error: ui.message(error) });
      return;
    }
    if (!current()) return;
    const token = ui.begin(this);
    const live = () => ui.live(this, token) && current();
    const quiet = (p) => p.then((r) => r.data).catch(() => null);
    let event;
    try {
      event = (await client.request(this.base())).data;
    } catch (error) {
      if (!live()) return;
      const hidden = error.status === 401 || error.status === 403 || error.status === 404;
      this.setData({
        ...(hidden ? privateDefaults : {}),
        loading: false,
        unavailable: hidden,
        error: hidden ? '该赛事不存在或当前身份无权设置。' : ui.message(error),
      });
      return;
    }
    const [registration, scoring, standings, directory, guide] = await Promise.all([
      quiet(client.request(this.base() + '/registration')),
      quiet(client.request(this.base() + '/scoring')),
      quiet(client.request(this.base() + '/standings')),
      quiet(client.request(this.base() + '/directory')),
      quiet(client.request(this.base() + '/setup-guide')),
    ]);
    if (!live()) return;
    this._event = event;
    let setupGuide = null,
      guideError = '';
    try {
      setupGuide = templates.guide(guide, event.version);
    } catch (error) {
      guideError = ui.message(error);
    }
    this._guide = setupGuide;
    const editable = !!(event.permissions && event.permissions.canEditDraft);
    const reg = registration;
    const rules = reg && reg.rules;
    const sc = scoring && scoring.rules;
    const st = standings && standings.rules;
    const pub = standings && standings.publication;
    this.setData({
      loading: false,
      unavailable: false,
      event: {
        name: event.name,
        status: event.status,
        statusLabel: api.eventStatus(event.status),
        formatLabel: api.eventFormat(event.format),
        dateLabel: event.startDate + ' 至 ' + event.endDate,
        venueName: event.venueName || '场地待定',
        roundRobin: ['ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN'].includes(event.format),
        knockout: event.format === 'SINGLE_ELIMINATION',
        groups: event.format === 'GROUP_KNOCKOUT',
      },
      draft: editable
        ? {
            name: event.name,
            startDate: event.startDate,
            endDate: event.endDate,
            venueName: event.venueName || '',
            format: event.format,
            formatIndex: Math.max(
              0,
              FORMATS.findIndex((f) => f.value === event.format),
            ),
          }
        : null,
      registration: reg
        ? {
            minPlayers: String(rules ? rules.minPlayers : 5),
            maxPlayers: String(rules ? rules.maxPlayers : 15),
            zeroDistinct: rules ? rules.zeroAndDoubleZeroDistinct : true,
            requireIdentity: rules ? rules.requireIdentity : false,
            requireInsurance: rules ? rules.requireInsurance : false,
            requireParticipantMaterials: rules ? rules.requireParticipantMaterials === true : false,
            saved: !!rules,
            editable: !!reg.capabilities.canManageRules,
          }
        : null,
      scoring:
        scoring && (scoring.capabilities.canManageRules || sc)
          ? {
              editable: scoring.capabilities.canManageRules && !scoring.locked,
              locked: scoring.locked,
              periods: String(sc ? sc.regulationPeriods : 4),
              ...clock(sc ? sc.periodDurationSeconds : 600),
              scores: [1, 2, 3].map((v) => ({
                value: v,
                on: sc ? sc.allowedScoreValues.includes(v) : true,
              })),
              overtime: sc ? sc.tiePolicy === 'OVERTIME' : true,
              durationLabel: sc ? scoringView.duration(sc.periodDurationSeconds) : '',
              ...((ot) => ({ otMinutes: ot.minutes, otSeconds: ot.seconds }))(
                clock(sc && sc.overtimeDurationSeconds ? sc.overtimeDurationSeconds : 300),
              ),
              otLabel:
                sc && sc.overtimeDurationSeconds
                  ? scoringView.duration(sc.overtimeDurationSeconds)
                  : '',
              saved: !!sc,
            }
          : null,
      standings:
        standings && (standings.capabilities.canManageRules || st)
          ? {
              editable: standings.capabilities.canManageRules && !standings.locked,
              locked: standings.locked,
              canPublish: standings.capabilities.canPublishRules && !!st && !standings.locked,
              rulesetId: st ? st.id : '',
              win: String(st ? st.winPoints : 2),
              loss: String(st ? st.lossPoints : 1),
              draw: String(st ? st.drawPoints : 1),
              tiebreakers: tiebreakerRows(st && st.tiebreakers),
              orderLabel: orderLabel(tiebreakerRows(st && st.tiebreakers)),
              saved: !!st,
            }
          : null,
      viewing: standings
        ? {
            active: !!(pub && pub.status === 'ACTIVE'),
            publicEventId: pub && pub.status === 'ACTIVE' ? pub.publicEventId : '',
            canEnable: standings.capabilities.canEnablePublicViewing,
            canDisable: standings.capabilities.canDisablePublicViewing,
            history: ['COMPLETED', 'ARCHIVED'].includes(event.status),
          }
        : null,
      directory: this.directoryView(directory),
      setupGuide,
      guideError,
      templateScheduling:
        this.data.templateScheduling ||
        (setupGuide && setupGuide.template
          ? setupGuide.template.configuration.scheduling
          : {
              dailyStart: '09:00',
              dailyEnd: '21:00',
              slotDurationMinutes: 60,
              minRestMinutes: 0,
              minLocalDayGap: 0,
              groupCount: event.format === 'GROUP_KNOCKOUT' ? 2 : null,
              thirdPlaceMatch: false,
            }),
      templateExpectedTeams:
        this.data.templateExpectedTeams ||
        (setupGuide && setupGuide.template && setupGuide.template.expectedTeams
          ? String(setupGuide.template.expectedTeams)
          : ''),
    });
    this._directory = directory;
    this.loadCurrentDirectoryRegion(directory);
    this.loadTemplates();
  },
  async loadTemplates() {
    if (!this._alive || this.data.busy) return;
    const client = api.getClient(),
      generation = (this._templateLoad = (this._templateLoad || 0) + 1);
    this.setData({ templateLoading: true, templateError: '' });
    try {
      await events.session(client);
      if (!this._alive || generation !== this._templateLoad) return;
      const token = ui.guard(this),
        actor = client.viewerId();
      this._pendingTemplate = templates.read(actor, this.orgId);
      this.setData({ templatePending: !!this._pendingTemplate });
      const result = templates.catalog(
        (await client.request('/v1/orgs/' + this.orgId + '/event-templates')).data,
      );
      if (!ui.held(this, token) || generation !== this._templateLoad) return;
      this._templateRows = result.rows;
      const previous = this._selectedTemplate && this._selectedTemplate.key;
      const index = Math.max(
        0,
        result.rows.findIndex((t) => t.key === previous),
      );
      this.setData({
        templateOptions: result.rows.map((t) => ({ label: t.label })),
        templateIndex: index,
        templateCanManage: result.canManage,
        templateLoading: false,
        templateError: result.truncated ? '仅显示最新100个机构模板。已有版本和实例仍保留。' : '',
      });
      this.selectTemplate(index);
    } catch (error) {
      if (!this._alive || generation !== this._templateLoad) return;
      this.setData({
        templateLoading: false,
        templateCanManage: false,
        templateError: ui.message(error),
      });
    }
  },
  pickTemplate(e) {
    if (!this.data.busy && !this.data.templatePending) this.selectTemplate(Number(e.detail.value));
  },
  selectTemplate(index) {
    const selected = this._templateRows && this._templateRows[index];
    this._selectedTemplate = selected && selected.configuration ? selected : null;
    const cfg = this._selectedTemplate && this._selectedTemplate.configuration;
    this.setData({
      templateIndex: index,
      templateCanArchive: !!(this._selectedTemplate && !this._selectedTemplate.preset),
      templatePreview: cfg
        ? {
            formatLabel: api.eventFormat(cfg.format),
            teams:
              cfg.expectedTeams === null
                ? '按实际批准队数'
                : cfg.expectedTeams + '支（冻结时须一致）',
            players: cfg.registration.minPlayers + '–' + cfg.registration.maxPlayers + '人',
            schedule:
              cfg.scheduling.dailyStart +
              '–' +
              cfg.scheduling.dailyEnd +
              ' · 每场' +
              cfg.scheduling.slotDurationMinutes +
              '分钟 · 休息' +
              cfg.scheduling.minRestMinutes +
              '分钟',
            bronze: cfg.scheduling.thirdPlaceMatch,
            groups: cfg.scheduling.groupCount,
          }
        : null,
      ...(cfg && this.data.creating
        ? {
            'draft.format': cfg.format,
            'draft.formatIndex': FORMATS.findIndex((f) => f.value === cfg.format),
          }
        : {}),
    });
  },
  templateField(e) {
    if (this.data.busy || this.data.templatePending) return;
    const field = e.currentTarget.dataset.field;
    if (['templateName', 'templateExpectedTeams', 'templateArchiveReason'].includes(field))
      this.setData({ [field]: e.detail.value });
    else if (
      [
        'dailyStart',
        'dailyEnd',
        'slotDurationMinutes',
        'minRestMinutes',
        'minLocalDayGap',
        'groupCount',
      ].includes(field)
    )
      this.setData({ ['templateScheduling.' + field]: e.detail.value });
  },
  toggleTemplateBronze() {
    if (!this.data.busy && !this.data.templatePending)
      this.setData({
        'templateScheduling.thirdPlaceMatch': !this.data.templateScheduling.thirdPlaceMatch,
      });
  },
  openGuideStep(e) {
    const step =
      this.data.setupGuide && this.data.setupGuide.steps[Number(e.currentTarget.dataset.index)];
    if (!step) return;
    if (step.action === 'REGISTRATION') this.openReview();
    else if (step.action === 'SCHEDULING') this.openSchedule();
    else if (step.action === 'EVENT') this.openEvent();
    else this.setData({ notice: '请在下方保存规则，并按向导处理缺项。' });
  },
  async executeTemplate(body, label, op) {
    if (this.data.busy || !op || !op.valid()) return null;
    const client = api.getClient(),
      actor = client.viewerId(),
      org = this.orgId,
      token = ui.hold(this);
    const valid = () =>
      op.valid() && ui.held(this, token) && client.viewerId() === actor && this.orgId === org;
    this.setData({ busy: true, error: '', notice: '' });
    let sent = body;
    try {
      if (!sent.clientRequestId) sent = { ...sent, clientRequestId: await ui.uuid() };
      if (!valid()) return null;
      templates.save(actor, org, sent);
      this._pendingTemplate = sent;
      this.setData({ templatePending: true });
      let result;
      try {
        result = (
          await client.request(
            '/v1/orgs/' + org + '/event-template-commands/' + sent.clientRequestId,
          )
        ).data;
      } catch (error) {
        if (!valid()) return null;
        if (error.status !== 404) throw error;
      }
      if (!valid()) return null;
      if (!result)
        result = (
          await client.request('/v1/orgs/' + org + '/event-template-commands', 'POST', sent)
        ).data;
      if (!valid()) return null;
      const confirmed = templates.receipt(result, sent),
        cleared = templates.clear(actor, org, sent);
      this._pendingTemplate = cleared ? null : sent;
      this.setData({
        templatePending: !cleared,
        notice: label + '已完成' + (cleared ? '。' : '；本机记录未清除，下次仍可沿原编号核对。'),
      });
      return confirmed;
    } catch (error) {
      if (!valid()) return null;
      if (!templates.unknown(error) && sent.clientRequestId) {
        const cleared = templates.clear(actor, org, sent);
        if (cleared) this._pendingTemplate = null;
      }
      this.setData({
        templatePending: !!this._pendingTemplate,
        error: this._pendingTemplate
          ? '结果尚待核对，请点“核对并重试原请求”；原编号和内容已保留。 ' + ui.message(error)
          : ui.message(error),
      });
      return null;
    } finally {
      if (valid()) this.setData({ busy: false });
    }
  },
  async finishTemplate(receipt) {
    if (!receipt) return;
    if (receipt.event) {
      this.eventId = api.uuid(receipt.event.id);
      this.setData({ creating: false, templateScheduling: null, templateExpectedTeams: '' });
      await this.load();
    } else await this.loadTemplates();
  },
  async resumeTemplate() {
    if (this.data.busy) return;
    let body;
    try {
      body = templates.read(api.getClient().viewerId(), this.orgId);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    if (!body) return;
    const op = await ui.confirmOp(
      this,
      '核对原模板请求',
      (body.event ? body.event.name : body.name || '原模板操作') +
        '。先查询原编号；只有未找到回执才沿原编号重试。',
    );
    if (!op) return;
    await this.finishTemplate(await this.executeTemplate(body, '原请求', op));
  },
  async createFromTemplate(input) {
    const chosen = this._selectedTemplate;
    if (!chosen || this.data.templatePending) return;
    const snapshot = JSON.stringify(this.data.draft);
    const body = {
      type: 'INSTANTIATE',
      ...(chosen.preset
        ? { presetKey: chosen.key }
        : {
            templateId: chosen.key,
            templateVersionId: chosen.versionId,
            expectedTemplateVersion: chosen.version,
          }),
      event: {
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
        ...(input.venueName ? { venueName: input.venueName } : {}),
      },
    };
    const op = await ui.confirmOp(
      this,
      '按模板创建草稿',
      input.name +
        '，使用' +
        chosen.label +
        '。复制规则配置，球队和人员另行报名；不会自动开放或发布。',
    );
    if (!op || this._selectedTemplate !== chosen || JSON.stringify(this.data.draft) !== snapshot)
      return;
    await this.finishTemplate(await this.executeTemplate(body, '模板草稿', op));
  },
  async saveAsTemplate() {
    if (!this._event || !this.data.templateCanManage || this.data.templatePending || this.data.busy)
      return;
    const event = this._event,
      s = this.data.templateScheduling,
      source = JSON.stringify({
        name: this.data.templateName,
        expected: this.data.templateExpectedTeams,
        s,
      });
    let body;
    try {
      const name = String(this.data.templateName || '').trim();
      if (!name || name.length > 80) throw new Error('模板名称请填写1至80字');
      body = {
        type: 'CREATE_FROM_EVENT',
        eventId: event.id,
        expectedEventVersion: event.version,
        name,
        expectedTeams:
          String(this.data.templateExpectedTeams).trim() === ''
            ? null
            : int(this.data.templateExpectedTeams, '预期队数', 2, 32),
        scheduling: {
          dailyStart: s.dailyStart,
          dailyEnd: s.dailyEnd,
          slotDurationMinutes: int(s.slotDurationMinutes, '每场分钟', 1, 1440),
          minRestMinutes: int(s.minRestMinutes, '休息分钟', 0, 43200),
          minLocalDayGap: int(s.minLocalDayGap, '日期间隔', 0, 365),
          groupCount: event.format === 'GROUP_KNOCKOUT' ? int(s.groupCount, '分组数', 2, 8) : null,
          thirdPlaceMatch:
            ['GROUP_KNOCKOUT', 'SINGLE_ELIMINATION'].includes(event.format) &&
            s.thirdPlaceMatch === true,
        },
      };
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    const op = await ui.confirmOp(
      this,
      '保存可复用模板',
      '保存服务器上已保存的规则和以下排程偏好，不含球队、人员、场地编号或原赛事日期。',
    );
    if (
      !op ||
      this._event !== event ||
      source !==
        JSON.stringify({
          name: this.data.templateName,
          expected: this.data.templateExpectedTeams,
          s: this.data.templateScheduling,
        })
    )
      return;
    await this.finishTemplate(await this.executeTemplate(body, '可复用模板', op));
  },
  async archiveTemplate() {
    const chosen = this._selectedTemplate,
      reason = String(this.data.templateArchiveReason || '').trim();
    if (
      !chosen ||
      chosen.preset ||
      !this.data.templateCanManage ||
      this.data.templatePending ||
      this.data.busy
    )
      return;
    if (reason.length < 4 || reason.length > 500) {
      this.setData({ error: '归档原因请填写4至500字' });
      return;
    }
    const op = await ui.confirmOp(
      this,
      '归档办赛模板',
      chosen.label + '。归档后不再用于创建赛事，既有赛事和版本记录仍保留。',
    );
    if (
      !op ||
      this._selectedTemplate !== chosen ||
      String(this.data.templateArchiveReason || '').trim() !== reason
    )
      return;
    const receipt = await this.executeTemplate(
      {
        type: 'ARCHIVE_TEMPLATE',
        templateId: chosen.key,
        expectedTemplateVersion: chosen.version,
        reason,
      },
      '模板归档',
      op,
    );
    if (receipt) this.setData({ templateArchiveReason: '' });
    await this.finishTemplate(receipt);
  },
  async loadCurrentDirectoryRegion(d) {
    if (!d || !d.listing || !d.listing.region || !d.regionCatalogVersion) return;
    const current = () => this._alive && this._directory === d;
    try {
      const catalog = await regions.fetchCatalog();
      if (!current()) return;
      const node = catalog.index[d.listing.region.regionId];
      this.setData({
        'directory.currentRegionLabel':
          catalog.version !== d.regionCatalogVersion
            ? '地区目录已更新，请刷新后核对标准归属。'
            : node
              ? node.path + '（标准地区）'
              : '原标准地区已不在当前目录，请重新选择；赛事仍可在全国目录中找到。',
      });
    } catch (error) {
      if (current())
        this.setData({
          'directory.currentRegionLabel':
            '已保存标准地区，当前完整路径暂不可读取：' + regions.failure(error),
        });
    }
  },
  field(e) {
    const { section, field } = e.currentTarget.dataset;
    if (!['draft', 'registration', 'scoring', 'standings'].includes(section) || !this.data[section])
      return;
    let value = e.detail.value;
    if (field === 'formatIndex') {
      const format = FORMATS[Number(value)];
      if (!format) return;
      this.setData({ 'draft.formatIndex': Number(value), 'draft.format': format.value });
      return;
    }
    if (!/^[A-Za-z]+$/.test(field || '')) return;
    this.setData({
      [section + '.' + field]: typeof value === 'string' ? value.slice(0, 120) : value,
    });
  },
  toggle(e) {
    const { section, field, index } = e.currentTarget.dataset;
    if (!this.data[section] || this.data.busy) return;
    if (field === 'scores') {
      const i = Number(index);
      if (!this.data[section][field][i]) return;
      this.setData({
        [section + '.' + field + '[' + i + '].on']: !this.data[section][field][i].on,
      });
      return;
    }
    if (field === 'tiebreakers' && section === 'standings') {
      const rows = this.data.standings.tiebreakers.map((t, i) =>
        i === Number(index) ? { ...t, on: !t.on } : t,
      );
      this.setTiebreakers(rows);
      return;
    }
    if (
      [
        'zeroDistinct',
        'requireIdentity',
        'requireInsurance',
        'requireParticipantMaterials',
        'overtime',
      ].includes(field)
    )
      this.setData({ [section + '.' + field]: !this.data[section][field] });
  },
  // Moves one comparison up a place; the list order is the order sent to the server.
  moveTiebreaker(e) {
    const s = this.data.standings;
    const i = Number(e.currentTarget.dataset.index);
    if (!s || this.data.busy || !(i > 0) || !s.tiebreakers[i]) return;
    const rows = s.tiebreakers.slice();
    [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
    this.setTiebreakers(rows);
  },
  setTiebreakers(rows) {
    const next = ranked(rows);
    this.setData({ 'standings.tiebreakers': next, 'standings.orderLabel': orderLabel(next) });
  },
  // `op`: the confirmation this write follows (ui.confirmOp), if any; re-checked right
  // before sending and never replaced by the write token.
  async write(path, method, body, label, op) {
    if (this.data.busy) return null;
    if (op && !op.valid()) return null;
    const token = ui.hold(this);
    if ((op && !op.valid()) || !ui.held(this, token)) return null;
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      const result = (await api.getClient().request(path, method, body)).data;
      if (!ui.held(this, token)) return null;
      this.setData({ busy: false, notice: label + '已保存。' });
      return result || {};
    } catch (error) {
      if (!ui.held(this, token)) return null;
      this.setData({ busy: false, error: failure(error) });
      if (error && error.code === 'VERSION_CONFLICT') await this.load();
      return null;
    }
  },
  async create() {
    let input;
    try {
      input = eventInput(this.data.draft);
      if (this.data.templatePending) throw new Error('请先核对原模板请求，再创建另一赛事。');
      const actor = api.getClient().viewerId && api.getClient().viewerId();
      if (actor && templates.read(actor, this.orgId))
        throw new Error('存在待核对的原模板请求，请先核对并重试。');
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    if (this._selectedTemplate) return this.createFromTemplate(input);
    const op = await ui.confirmOp(
      this,
      '创建赛事草稿',
      input.name +
        '，' +
        input.startDate +
        ' 至 ' +
        input.endDate +
        '。创建后先设置报名规则再开放报名。',
    );
    if (!op || this.eventId || !this.data.creating) return;
    const created = await this.write(
      '/v1/orgs/' + this.orgId + '/events',
      'POST',
      input,
      '赛事草稿',
      op,
    );
    if (!created || !created.id) return;
    this.eventId = api.uuid(created.id);
    this.setData({ creating: false });
    await this.load();
  },
  async saveEvent() {
    let input;
    try {
      input = eventInput(this.data.draft);
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    if (
      await this.write(
        this.base(),
        'PATCH',
        { ...input, expectedVersion: this._event.version },
        '赛事信息',
      )
    )
      await this.load();
  },
  async saveRegistration() {
    const r = this.data.registration;
    let body;
    try {
      const min = int(r.minPlayers, '最少人数', 1, 60),
        max = int(r.maxPlayers, '最多人数', 1, 60);
      if (max < min) throw new Error('最多人数不能少于最少人数');
      body = {
        expectedVersion: this._event.version,
        minPlayers: min,
        maxPlayers: max,
        zeroAndDoubleZeroDistinct: !!r.zeroDistinct,
        requireIdentity: !!r.requireIdentity,
        requireInsurance: !!r.requireInsurance,
        requireParticipantMaterials: !!r.requireParticipantMaterials,
      };
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    if (body.requireIdentity || body.requireInsurance)
      this.setData({
        notice: body.requireParticipantMaterials
          ? '本人资料流程须服务器安全配置就绪；逐人照片、资料及适用保险须独立审核，队伍提交与冻结时复查。'
          : '未启用本人资料流程时，身份或保险要求仍会阻止开放报名。',
      });
    if (await this.write(this.base() + '/registration-rules', 'PUT', body, '报名规则'))
      await this.load();
  },
  async saveScoring() {
    const s = this.data.scoring;
    let body;
    try {
      const scores = s.scores.filter((v) => v.on).map((v) => v.value);
      if (!scores.length) throw new Error('至少选择一种得分分值');
      body = {
        expectedEventVersion: this._event.version,
        regulationPeriods: int(s.periods, '节数', 1, 8),
        periodDurationSeconds: seconds(s.minutes, s.seconds, '每节时长', 3600),
        allowedScoreValues: scores,
        tiePolicy: s.overtime ? 'OVERTIME' : 'ALLOW_DRAW',
        overtimeDurationSeconds: s.overtime
          ? seconds(s.otMinutes, s.otSeconds, '加时时长', 1800)
          : null,
      };
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    if (await this.write(this.base() + '/scoring-rules', 'PUT', body, '记分规则'))
      await this.load();
  },
  async saveStandings() {
    const s = this.data.standings;
    let body;
    try {
      body = {
        expectedEventVersion: this._event.version,
        winPoints: int(s.win, '胜场积分', 0, 1000),
        lossPoints: int(s.loss, '负场积分', 0, 1000),
        drawPoints: int(s.draw, '平局积分', 0, 1000),
        tiebreakers: s.tiebreakers.filter((t) => t.on).map((t) => t.value),
      };
    } catch (error) {
      this.setData({ error: ui.message(error) });
      return;
    }
    if (await this.write(this.base() + '/standings-rules', 'PUT', body, '积分规则'))
      await this.load();
  },
  async publishStandings() {
    const s = this.data.standings;
    if (!s || !s.canPublish || !this._event) return;
    const version = this._event.version;
    const op = await ui.confirmOp(
      this,
      '锁定积分规则',
      '锁定后本届积分规则不可再改，正式积分按此计算。',
    );
    const now = this.data.standings;
    if (
      !op ||
      !this._event ||
      this._event.version !== version ||
      !now ||
      !now.canPublish ||
      now.rulesetId !== s.rulesetId
    )
      return;
    if (
      await this.write(
        this.base() + '/standings-rule-commands',
        'POST',
        {
          type: 'PUBLISH_STANDINGS_RULES',
          rulesetId: s.rulesetId,
          expectedEventVersion: version,
        },
        '积分规则锁定',
        op,
      )
    )
      await this.load();
  },
  async viewing(e) {
    const type = e.currentTarget.dataset.type;
    if (!['ENABLE', 'ENABLE_HISTORY', 'DISABLE'].includes(type)) return;
    const note =
      type === 'DISABLE'
        ? '关闭后现有观赛链接立即失效；再次开启会生成新的链接。'
        : '开启后持有链接的观众可查看赛程、比分与排名，不含名单与联系方式。';
    if (!this._event) return;
    const version = this._event.version;
    const op = await ui.confirmOp(this, type === 'DISABLE' ? '关闭公开观赛' : '开启公开观赛', note);
    const v = this.data.viewing;
    if (
      !op ||
      !this._event ||
      this._event.version !== version ||
      !v ||
      !(type === 'DISABLE' ? v.canDisable : v.canEnable)
    )
      return;
    if (
      await this.write(
        this.base() + '/public-viewing-commands',
        'POST',
        { type, expectedEventVersion: version },
        type === 'DISABLE' ? '公开观赛关闭' : '公开观赛开启',
        op,
      )
    )
      await this.load();
  },
  // Directory writes remain bound to the session, event, publication and original listing.
  directoryView(d) {
    if (!d) return null;
    const previous = this.data.directory;
    const selected = previous && previous.selectedRegion;
    const last = d.lastListing;
    return {
      listed: !!d.listing,
      city: d.listing ? d.listing.displayCity || '' : '',
      currentRegionLabel:
        d.listing && d.listing.region
          ? (d.listing.displayCity || '已保存') + '（标准地区）'
          : '尚未确认标准地区，历史标签可能用于匹配',
      catalogVersion: d.regionCatalogVersion || '',
      selectedRegion:
        selected && selected.catalogVersion === d.regionCatalogVersion ? selected : null,
      group: d.group ? DIRECTORY_GROUP_LABELS[d.group] : '',
      publicActive: !!(d.publication && d.publication.status === 'ACTIVE'),
      canList: !!d.capabilities.canList,
      canUnlist: !!d.capabilities.canUnlist,
      canReplaceRegion: !!d.capabilities.canReplaceRegion,
      lastNote: !d.listing && last ? DIRECTORY_REVOKED[last.revokeSource] || '' : '',
      cityInput: previous ? previous.cityInput : '',
      reason: previous ? previous.reason : '',
    };
  },
  chooseDirectoryRegion() {
    const d = this._directory;
    if (
      !d ||
      !d.regionCatalogVersion ||
      !this._event ||
      this.data.busy ||
      !(d.capabilities.canList || d.capabilities.canReplaceRegion)
    )
      return;
    const token = ui.guard(this);
    const generation = (this._regionPick = (this._regionPick || 0) + 1);
    const version = this._event.version;
    const listingId = d.listing ? d.listing.id : '';
    const publicEventId = d.publication ? d.publication.publicEventId : '';
    wx.navigateTo({
      url: '/pages/city-select/index?context=directory',
      events: {
        regionSelected: (selection) => {
          const now = this._directory;
          if (
            !this._alive ||
            !ui.held(this, token) ||
            generation !== this._regionPick ||
            !now ||
            !this._event ||
            this._event.version !== version ||
            (now.listing ? now.listing.id : '') !== listingId ||
            (now.publication ? now.publication.publicEventId : '') !== publicEventId ||
            !(now.capabilities.canList || now.capabilities.canReplaceRegion)
          )
            return;
          if (
            !regions.validSelection(selection) ||
            selection.catalogVersion !== now.regionCatalogVersion
          ) {
            this.setData({ error: '地区目录已更新，请刷新赛事设置后重新选地。' });
            return;
          }
          this._directoryEdit = (this._directoryEdit || 0) + 1;
          this.setData({
            'directory.selectedRegion': { ...selection },
            'directory.cityInput': '',
            error: '',
          });
        },
      },
    });
  },
  clearDirectoryRegion() {
    if (!this.data.directory || !this.data.directory.canList || this.data.busy) return;
    this._directoryEdit = (this._directoryEdit || 0) + 1;
    this.setData({ 'directory.selectedRegion': null });
  },
  directoryCityInput(e) {
    this._directoryEdit = (this._directoryEdit || 0) + 1;
    this.setData({ 'directory.cityInput': String(e.detail.value || '').slice(0, 40) });
  },
  directoryReasonInput(e) {
    this.setData({ 'directory.reason': String(e.detail.value || '').slice(0, 500) });
  },
  listDirectory() {
    return this.directoryCommand('LIST');
  },
  unlistDirectory() {
    return this.directoryCommand('UNLIST');
  },
  replaceDirectoryRegion() {
    return this.directoryCommand('REPLACE_REGION');
  },
  async directoryCommand(type) {
    const d = this._directory,
      view = this.data.directory;
    if (!d || !view || this.data.busy || !this._event) return;
    const capability =
      type === 'LIST' ? 'canList' : type === 'REPLACE_REGION' ? 'canReplaceRegion' : 'canUnlist';
    if (!d.capabilities[capability]) return;
    const reason = view.reason.trim();
    if (Array.from(reason).length < 4 || Array.from(reason).length > 500) {
      this.setData({ error: '请填写4–500字的原因。' });
      return;
    }
    const selected = type === 'UNLIST' ? null : view.selectedRegion;
    if (type === 'REPLACE_REGION' && !selected) {
      this.setData({ error: '请先选择完整的标准地区，再确认更正。' });
      return;
    }
    if (
      selected &&
      (!regions.validSelection(selected) || selected.catalogVersion !== d.regionCatalogVersion)
    ) {
      this.setData({ error: '地区目录已更新，请重新选择并确认。' });
      return;
    }
    let city = null;
    if (type === 'LIST' && !selected) {
      city = directoryUtil.normalizeCity(view.cityInput);
      if (city === undefined) {
        this.setData({ error: '城市仅支持中文、字母、数字、空格和“·”，最多20个字。' });
        return;
      }
    }
    const region = selected
      ? { catalogVersion: selected.catalogVersion, regionId: selected.regionId }
      : null;
    const selectedKey = JSON.stringify(selected || null);
    const edit = this._directoryEdit || 0;
    const version = this._event.version;
    const publicEventId = d.publication ? d.publication.publicEventId : '';
    const listingId = d.listing ? d.listing.id : '';
    const catalogVersion = d.regionCatalogVersion;
    const title =
      type === 'LIST'
        ? '列入公开赛事目录'
        : type === 'REPLACE_REGION'
          ? '更正目录标准地区'
          : '撤出公开赛事目录';
    const note =
      type === 'LIST'
        ? '列入后，所有观众都可以在公开赛事目录中发现该赛事' +
          (selected
            ? '（标准地区：' + selected.label + '）'
            : city
              ? '（城市：' + city + '）'
              : '') +
          '，并打开当前公开观赛页。'
        : type === 'REPLACE_REGION'
          ? '原公开标签：' +
            (view.city || '未填写') +
            '。更正为：' +
            selected.label +
            '。系统保留旧记录并重新上架，原文字筛选可能不再找到此赛事；全国、标准地区和分享链接仍可访问。'
          : '撤出后不再出现在目录中；已分享的观赛链接仍可访问。如需停止链接访问，请关闭公开观赛。';
    const op = await ui.confirmOp(this, title, note);
    const now = this._directory;
    if (
      !op ||
      !this._event ||
      this._event.version !== version ||
      !now ||
      (now.publication ? now.publication.publicEventId : '') !== publicEventId ||
      (now.listing ? now.listing.id : '') !== listingId ||
      !now.capabilities[capability] ||
      now.regionCatalogVersion !== catalogVersion ||
      (this._directoryEdit || 0) !== edit ||
      (type !== 'UNLIST' &&
        JSON.stringify(this.data.directory.selectedRegion || null) !== selectedKey)
    )
      return;
    const token = ui.hold(this);
    if (!op.valid() || !ui.held(this, token)) return;
    this.setData({ busy: true, loading: false, error: '', notice: '' });
    try {
      await api.getClient().request(this.base() + '/directory-commands', 'POST', {
        type,
        expectedEventVersion: version,
        reason,
        ...(region ? { region } : type === 'LIST' && city ? { displayCity: city } : {}),
        ...(type === 'REPLACE_REGION' ? { expectedListingId: listingId } : {}),
      });
      if (!ui.held(this, token)) return;
      this.setData({
        busy: false,
        'directory.reason': '',
        'directory.cityInput': '',
        'directory.selectedRegion': null,
        notice:
          type === 'LIST'
            ? '已列入公开赛事目录。'
            : type === 'REPLACE_REGION'
              ? '标准地区已更正，原上架记录已保留，分享链接仍有效。'
              : '已撤出公开赛事目录；分享链接仍有效。',
      });
      await this.load();
    } catch (error) {
      if (!ui.held(this, token)) return;
      const message = directoryFailure(error);
      this.setData({ busy: false, error: message });
      if (error && error.status === 409) {
        if (error.code === 'REGION_CATALOG_CHANGED')
          this.setData({ 'directory.selectedRegion': null });
        await this.load();
        if (ui.held(this, token) && !this.data.unavailable) this.setData({ error: message });
      }
    }
  },
  openPublic() {
    const id = this.data.viewing && this.data.viewing.publicEventId;
    if (/^[A-Za-z0-9_-]{43}$/.test(id || '')) ui.open('event', { event: id });
  },
  openSchedule() {
    ui.open('schedule', { orgId: this.orgId, eventId: this.eventId });
  },
  openReview() {
    ui.open('entry-review', { orgId: this.orgId, eventId: this.eventId });
  },
  openEvent() {
    ui.open('org-event', { orgId: this.orgId, eventId: this.eventId });
  },
});
