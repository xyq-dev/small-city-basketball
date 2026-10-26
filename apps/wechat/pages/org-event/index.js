const api = require('../../utils/api');
const ui = require('../../utils/ui');

const TABS = ['schedule', 'ranking', 'stats'];
const MAX_MATCH_PAGES = 10;

function shortDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.slice(5).replace('-', '/')
    : '日期待确认';
}
function sectionError(error) {
  if (error && error.status === 403) return '当前身份无权查看这部分资料。';
  if (error && error.code === 'RESULT_SOURCE_INVALID')
    return '正式赛果来源待核对，暂不展示，避免显示不一致的结果。';
  return (error && error.message) || '这部分资料暂时无法读取。';
}
function standingRows(standings) {
  return ((standings && standings.rows) || []).map((row) => ({
    key: row.entryId || row.teamId || row.teamName,
    rankLabel: row.rank === null || row.rank === undefined ? '暂列' : String(row.rank),
    teamName: row.teamName,
    tied: !!row.tied,
    record: row.wins + '胜' + row.losses + '负',
    points: row.leaguePoints,
    diff: (row.scoreDifference > 0 ? '+' : '') + row.scoreDifference,
  }));
}
function bracketView(bracket, names) {
  if (!bracket) return null;
  const name = (id) => (id && names[id]) || null;
  return {
    progress: '已确认 ' + bracket.confirmedMatchCount + ' / ' + bracket.totalMatchCount + ' 场',
    isComplete: !!bracket.isComplete,
    rounds: (bracket.rounds || []).map((round) => ({
      roundNo: round.roundNo,
      label: round.label,
      published: !!round.published,
      slots: (round.slots || []).map((slot) => ({
        key: slot.fixtureKey,
        positionNo: slot.positionNo,
        bye: slot.status === 'BYE' ? name(slot.byeEntryId) || '轮空球队' : null,
        home: name(slot.homeEntryId) || '待晋级',
        away: name(slot.awayEntryId) || '待晋级',
        statusLabel:
          slot.status === 'WAITING'
            ? '尚未发布'
            : slot.status === 'BYE'
              ? '轮空'
              : api.matchStatus(slot.status),
        winner: name(slot.winnerEntryId),
      })),
    })),
    placements: (bracket.placements || []).map((p) => ({
      key: p.entryId,
      rank: p.rank,
      teamName: p.teamName,
      tied: !!p.tied,
    })),
  };
}
function participantNames(list, names = {}) {
  for (const p of list || []) if (p && p.entryId) names[p.entryId] = p.teamName;
  return names;
}
const qualificationLabels = {
  WAITING: '组内赛果尚未全部确认',
  TIE_BREAK_REQUIRED: '组内同分资格待抽签',
  READY: '资格已具备，等待负责人明确发布',
  PUBLISHED: '当前出线资格已正式发布',
};

Page({
  data: {
    event: null,
    tab: 'schedule',
    loading: false,
    error: '',
    unavailable: false,
    matches: [],
    matchesTruncated: false,
    scheduleError: '',
    ranking: null,
    rankingError: '',
    stats: null,
    statsError: '',
    publicEventId: '',
  },
  onLoad(query) {
    this._alive = true;
    try {
      this.orgId = api.uuid(query.orgId);
      this.eventId = api.uuid(query.eventId);
    } catch {
      this.setData({ error: '赛事入口无效，请从赛事列表重新进入。', unavailable: true });
      return;
    }
    if (TABS.includes(query.tab)) this.setData({ tab: query.tab });
    this.load();
  },
  onUnload() {
    this._alive = false;
    ui.close(this);
  },
  base() {
    return '/v1/orgs/' + this.orgId + '/events/' + this.eventId;
  },
  async load() {
    if (!this.orgId || this.data.loading) return;
    const client = api.getClient();
    const token = { request: (this._request = (this._request || 0) + 1) };
    token.session = client.sessionRevision();
    const live = () =>
      this._alive && token.request === this._request && token.session === client.sessionRevision();
    this.setData({ loading: true, error: '' });
    let raw;
    try {
      raw = (await client.request(this.base())).data;
      if (!raw || typeof raw.name !== 'string') throw { message: '赛事资料格式无效' };
    } catch (error) {
      if (!live()) return;
      const hidden = error.status === 401 || error.status === 403 || error.status === 404;
      this.setData({
        loading: false,
        event: hidden ? null : this.data.event,
        unavailable: hidden,
        error:
          error.status === 401
            ? '请先登录后查看机构赛事。'
            : error.status === 403 || error.status === 404
              ? '该赛事不存在或当前身份无权查看。'
              : sectionError(error),
      });
      return;
    }
    const event = {
      id: raw.id,
      name: raw.name,
      format: raw.format,
      status: raw.status,
      statusLabel: api.eventStatus(raw.status),
      formatLabel: api.eventFormat(raw.format),
      dateLabel: shortDate(raw.startDate) + '–' + shortDate(raw.endDate),
      venueName: raw.venueName || '场地待说明',
    };
    const [schedule, ranking, stats] = await Promise.all([
      this.readSchedule(client),
      this.readRanking(client, event.format),
      this.readStats(client),
    ]);
    if (!live()) return;
    this.setData({
      loading: false,
      unavailable: false,
      event,
      matches: schedule.matches,
      matchesTruncated: schedule.truncated,
      scheduleError: schedule.error,
      ranking: ranking.value,
      rankingError: ranking.error,
      publicEventId: ranking.publicEventId,
      stats: stats.value,
      statsError: stats.error,
    });
  },
  async readSchedule(client) {
    try {
      let cursor = null,
        rows = [];
      for (let page = 0; page < MAX_MATCH_PAGES; page++) {
        const response = await client.request(
          this.base() +
            '/matches?limit=100' +
            (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
        );
        if (!Array.isArray(response.data)) throw { message: '赛程资料格式无效' };
        rows = rows.concat(response.data);
        cursor = response.meta.nextCursor;
        if (!cursor) break;
      }
      return {
        truncated: !!cursor,
        error: '',
        matches: rows.map((m) => ({
          id: m.id,
          roundLabel: '第' + m.roundNo + '轮',
          timeLabel: ui.localTime(m.startsAt),
          courtName: m.courtName || '场地待定',
          home: (m.home && m.home.teamName) || '待定',
          away: (m.away && m.away.teamName) || '待定',
          status: m.status,
          statusLabel: api.matchStatus(m.status),
        })),
      };
    } catch (error) {
      return { matches: [], truncated: false, error: sectionError(error) };
    }
  },
  async readRanking(client, format) {
    try {
      if (format === 'SINGLE_ELIMINATION') {
        const data = (await client.request(this.base() + '/knockout')).data;
        return {
          publicEventId: '',
          error: '',
          value: {
            kind: 'bracket',
            bracket: bracketView(data.bracket, participantNames(data.participants)),
          },
        };
      }
      if (format === 'GROUP_KNOCKOUT') {
        const data = (await client.request(this.base() + '/groups')).data;
        const competition = data.competition;
        const groups = (competition && competition.groups) || [];
        const names = {};
        for (const g of groups) participantNames(g.participants, names);
        return {
          publicEventId: '',
          error: '',
          value: {
            kind: 'groups',
            qualificationLabel:
              (competition && qualificationLabels[competition.qualification.status]) || '',
            groups: groups.map((g) => ({
              key: g.groupKey,
              label: g.label,
              progress:
                '已确认 ' +
                g.standings.confirmedMatchCount +
                ' / ' +
                g.standings.totalMatchCount +
                ' 场',
              tieBreakRequired: (g.unresolvedTieEntryIds || []).length > 0,
              rows: standingRows(g.standings),
            })),
            bracket: bracketView(competition && competition.bracket, names),
          },
        };
      }
      const data = (await client.request(this.base() + '/standings')).data;
      const standings = data.standings;
      const publication = data.publication;
      return {
        error: '',
        publicEventId:
          publication &&
          publication.status === 'ACTIVE' &&
          /^[A-Za-z0-9_-]{43}$/.test(publication.publicEventId)
            ? publication.publicEventId
            : '',
        value: {
          kind: 'standings',
          modeLabel: !standings
            ? ''
            : standings.mode === 'PUBLISHED'
              ? '正式积分 · 仅计入独立确认的赛果'
              : '积分规则尚未锁定 · 草稿预览',
          progress: standings
            ? '已确认 ' + standings.confirmedMatchCount + ' / ' + standings.totalMatchCount + ' 场'
            : '',
          rows: standingRows(standings),
        },
      };
    } catch (error) {
      return { value: null, publicEventId: '', error: sectionError(error) };
    }
  },
  async readStats(client) {
    try {
      const data = (await client.request(this.base() + '/player-statistics')).data;
      const summary = data.summary;
      if (!summary) return { error: '', value: { empty: true, rows: [], teams: [] } };
      return {
        error: '',
        value: {
          empty: false,
          progress:
            '已纳入 ' + summary.includedMatchCount + ' / ' + summary.totalMatchCount + ' 场',
          coverageLabel: summary.coverageComplete
            ? '全部已发布比赛均已逐人采集并确认'
            : '部分比赛仅记录球队比分或尚待确认，个人数据不完整',
          attributionLabel: summary.attributionComplete ? '' : '存在未归属到个人的得分或犯规',
          pendingLabel:
            summary.pendingMatchCount > 0 ? summary.pendingMatchCount + ' 场待确认，未纳入' : '',
          rows: summary.rows.slice(0, 50).map((row) => ({
            key: row.entryId + ':' + row.memberId,
            rankLabel: (row.tied ? '并列' : '') + row.rank,
            name: row.name,
            jerseyNo: row.jerseyNo,
            teamName: row.teamName,
            score: row.score,
            fouls: row.fouls,
            samples: row.rosterSampleMatchCount,
          })),
          truncated: summary.rows.length > 50,
          teams: summary.teams.map((t) => ({
            key: t.entryId,
            teamName: t.teamName,
            unassignedScore: t.unassignedScore,
            unassignedFouls: t.unassignedFouls,
          })),
        },
      };
    } catch (error) {
      return { value: null, error: sectionError(error) };
    }
  },
  tab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (TABS.includes(tab) && !this.data.loading) this.setData({ tab });
  },
  openPublic() {
    if (/^[A-Za-z0-9_-]{43}$/.test(this.data.publicEventId))
      ui.open('event', { event: this.data.publicEventId });
  },
  events() {
    wx.redirectTo({ url: '/pages/watch/index' });
  },
  login() {
    ui.login('/pages/watch/index');
  },
});
