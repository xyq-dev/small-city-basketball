const api = require('../../utils/api');
const ui = require('../../utils/ui');
const events = require('../../utils/events');

// Server-filtered: owners/admins, actual event staff or this match's explicit staff only.
const groups = [
  { key: 'live', label: '进行中', statuses: ['LIVE'] },
  { key: 'ready', label: '已准备 · 待开赛', statuses: ['READY'] },
  { key: 'pending', label: '已结束 · 待独立确认', statuses: ['PENDING_CONFIRMATION'] },
  { key: 'adjudicated', label: '行政弃权／取消 · 不计个人统计', statuses: [] },
  { key: 'scheduled', label: '待准备', statuses: ['SCHEDULED'] },
  { key: 'final', label: '已确认', statuses: ['FINAL'] },
];
const MAX_PAGES = 10;
const privateDefaults = { sections: [], orgErrors: [], empty: false, truncated: false };

Page({
  data: { loading: false, loginRequired: false, error: '', scopeLabel: '', ...privateDefaults },
  onLoad(query = {}) {
    try {
      if (query.orgId && query.eventId) {
        this.scope = { orgId: api.uuid(query.orgId), eventId: api.uuid(query.eventId) };
        this.setData({ scopeLabel: '仅显示本届赛事的比赛' });
      }
    } catch {
      this.scope = null;
    }
  },
  onShow() {
    this.load();
  },
  onUnload() {
    ui.close(this);
  },
  onSessionReset() {
    this.setData({
      ...privateDefaults,
      loading: false,
      loginRequired: true,
      error: '登录身份已变化，已清除上一身份的记分任务。',
    });
  },
  async load() {
    if (this.data.loading) return;
    const client = api.getClient();
    if (!client.hasSession()) {
      this.setData({ ...privateDefaults, loginRequired: true, error: '' });
      return;
    }
    this.setData({ loading: true, error: '' });
    let session;
    try {
      session = await events.session(client);
    } catch (error) {
      this.setData({
        ...privateDefaults,
        loading: false,
        loginRequired: error.status === 401,
        error: error.status === 401 ? '' : ui.message(error),
      });
      return;
    }
    const token = ui.begin(this);
    const orgs = events
      .organizations(session)
      .filter((o) => !this.scope || o.id === this.scope.orgId);
    const rows = [],
      orgErrors = [];
    let truncated = false;
    for (const org of orgs) {
      try {
        let cursor = null;
        for (let page = 0; page < MAX_PAGES; page++) {
          const response = await client.request(
            '/v1/orgs/' +
              org.id +
              '/scoring-matches?' +
              (this.scope ? 'eventId=' + this.scope.eventId + '&' : '') +
              'limit=100' +
              (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
          );
          if (!Array.isArray(response.data)) throw { message: '比赛资料格式无效' };
          for (const m of response.data)
            if (
              m.adjudication !== undefined &&
              (!m.adjudication ||
                typeof m.adjudication !== 'object' ||
                Array.isArray(m.adjudication) ||
                !['FORFEIT', 'CANCELLED'].includes(m.adjudication.kind) ||
                !['SCHEDULED', 'READY'].includes(m.status))
            )
              throw { message: '比赛行政裁定资料格式无效' };
          for (const m of response.data) rows.push({ org, m });
          cursor = response.meta.nextCursor;
          if (!cursor) break;
        }
        if (cursor) truncated = true;
      } catch (error) {
        if (error && error.status === 401) break;
        orgErrors.push({ key: org.id, text: org.name + '：' + ui.message(error) });
      }
      if (!ui.live(this, token)) return;
    }
    if (!ui.live(this, token)) return;
    const sections = groups
      .map((g) => ({
        key: g.key,
        label: g.label,
        items: rows
          .filter((r) =>
            r.m.adjudication
              ? g.key === 'adjudicated'
              : g.key !== 'adjudicated' && g.statuses.includes(r.m.status),
          )
          .slice(0, g.key === 'final' ? 20 : 200)
          .map(({ org, m }) => ({
            key: org.id + ':' + m.matchId,
            orgId: org.id,
            matchId: m.matchId,
            title: m.homeTeamName + ' vs ' + m.awayTeamName,
            meta:
              m.eventName + ' · ' + ui.localTime(m.startsAt) + ' · ' + (m.courtName || '场地待定'),
            score: !m.adjudication && m.score ? m.score.home + ' : ' + m.score.away : '',
            statusLabel: m.adjudication
              ? m.adjudication.kind === 'FORFEIT'
                ? '行政弃权已生效'
                : '本场已取消'
              : api.matchStatus(m.status),
            live: !m.adjudication && m.status === 'LIVE',
          })),
      }))
      .filter((s) => s.items.length);
    this.setData({
      loading: false,
      loginRequired: false,
      sections,
      orgErrors,
      truncated,
      empty: !sections.length && !orgErrors.length,
    });
  },
  open(e) {
    const { org, match } = e.currentTarget.dataset;
    ui.open('org-match', { orgId: org, matchId: match });
  },
  login() {
    ui.login('/pages/scoring-tasks/index');
  },
});
