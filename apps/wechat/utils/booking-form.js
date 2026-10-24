// Pure C08 form rules. Amounts stay in integer CNY fen; the server remains authoritative.
const SCOPES = [
  { value: 'SINGLE', label: '单场预约', hint: '一场明确的比赛' },
  { value: 'MULTI', label: '自选多场', hint: '逐场安排、逐场确认' },
  { value: 'TOURNAMENT', label: '整届赛事', hint: '确定赛程与晋级意向分开' },
  { value: 'SEASON', label: '赛季合作', hint: '周期内逐场约定，不自动续费' },
  { value: 'TIME_BLOCK', label: '按时段预约', hint: '明确服务时间与范围' },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (value) => typeof value === 'string' && UUID.test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownKeys = (value, required, allowed = required) =>
  required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
  Object.keys(value).every((key) => allowed.includes(key));
const version = (value) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const text = (value, max) =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  Array.from(value).length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function chinaStamp(date, time) {
  if (!calendarDate(date) || typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time))
    throw new Error('请选择有效的日期和时间');
  const [hour, minute] = time.split(':').map(Number);
  if (hour > 23 || minute > 59) throw new Error('请选择有效的日期和时间');
  return new Date(date + 'T' + time + ':00+08:00').toISOString();
}
function timestamp(value) {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return false;
  return calendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
function initialSlot(date, profileIds = []) {
  return {
    label: '',
    venue: '',
    profileIds: profileIds.slice(),
    conditional: false,
    conditionText: '',
    reportDate: date,
    reportTime: '19:00',
    startDate: date,
    startTime: '19:30',
    endDate: date,
    endTime: '21:00',
    matchId: '',
  };
}
function fromMatch(match, profiles, datePart, timePart) {
  const report = new Date(Date.parse(match.startAt) - 30 * 60000).toISOString();
  return {
    ...initialSlot(datePart(match.startAt), profiles),
    label: match.label,
    venue: match.venue,
    matchId: match.id,
    reportDate: datePart(report),
    reportTime: timePart(report),
    startTime: timePart(match.startAt),
    endDate: datePart(match.endAt),
    endTime: timePart(match.endAt),
  };
}
function selectedProfiles(draft, workspace) {
  const selected = new Set(draft.selectedIds || []);
  return workspace.players.filter((player) => selected.has(player.id));
}
function quoteDraft(draft, workspace) {
  const players = selectedProfiles(draft, workspace);
  const byId = new Map(players.map((player) => [player.id, player]));
  const feeBps = workspace.settings.feeBps;
  const totals = {
    serviceFen: 0,
    platformFeeFen: 0,
    travelFen: 0,
    accommodationFen: 0,
    confirmedTotalFen: 0,
    conditionalTotalFen: 0,
    fixedCount: 0,
    conditionalCount: 0,
    appearanceCount: 0,
  };
  for (const slot of draft.slots || []) {
    for (const profileId of slot.profileIds || []) {
      const player = byId.get(profileId);
      if (!player) continue;
      const platform = Math.round((player.priceFen * feeBps) / 10000);
      const total = player.priceFen + platform + player.travelFen + player.accommodationFen;
      totals.appearanceCount++;
      if (slot.conditional) {
        totals.conditionalCount++;
        totals.conditionalTotalFen += total;
      } else {
        totals.fixedCount++;
        totals.serviceFen += player.priceFen;
        totals.platformFeeFen += platform;
        totals.travelFen += player.travelFen;
        totals.accommodationFen += player.accommodationFen;
        totals.confirmedTotalFen += total;
      }
    }
  }
  return totals;
}
function schedule(slot) {
  const reportAt = chinaStamp(slot.reportDate, slot.reportTime);
  const startAt = chinaStamp(slot.startDate, slot.startTime);
  const endAt = chinaStamp(slot.endDate, slot.endTime);
  if (reportAt > startAt || startAt >= endAt || Date.parse(endAt) - Date.parse(reportAt) > 43200000)
    throw new Error('报到不得晚于开始，结束须晚于开始，单次服务不超过12小时');
  return { reportAt, startAt, endAt };
}
function buildCreate(draft, workspace, commandId) {
  if (!id(commandId)) throw new Error('安全操作编号无效，请重新读取页面');
  if (!SCOPES.some((scope) => scope.value === draft.scope)) throw new Error('请选择合作方式');
  const team = workspace.teams.find((item) => item.id === draft.teamId);
  if (!team) throw new Error('请先选择当前有权管理的球队');
  if (!text(draft.eventName, 80)) throw new Error('请填写1至80字的赛事或合作名称');
  if (draft.consent !== true) throw new Error('请逐项核对资格、时间地点、费用和规则后明确同意');
  const players = selectedProfiles(draft, workspace);
  const selectedIds = draft.selectedIds || [];
  if (!players.length || players.length !== new Set(selectedIds).size || players.length > 64)
    throw new Error('请重新选择当前可约的球员');
  if (
    players.some(
      (player) => player.status !== 'APPROVED' || player.userId === workspace.viewerUserId,
    )
  )
    throw new Error('不能预约自己或当前不可约的球员');
  if (!version(workspace.settings.version)) throw new Error('平台费率版本无效，请重新读取');
  if (!Array.isArray(draft.slots) || !draft.slots.length || draft.slots.length > 64)
    throw new Error('请添加1至64个逐场安排');
  if (['SINGLE', 'TIME_BLOCK'].includes(draft.scope) && draft.slots.length !== 1)
    throw new Error('本合作方式仅包含一个明确时段；多场请切换合作方式');
  if (draft.eventId) {
    const event = workspace.events.find(
      (item) => item.id === draft.eventId && item.orgId === team.orgId,
    );
    if (!event) throw new Error('所选赛事不在当前球队可约范围，请重新选择');
  }
  if (draft.scope === 'SEASON') {
    if (
      !calendarDate(draft.periodStart) ||
      !calendarDate(draft.periodEnd) ||
      draft.periodStart > draft.periodEnd
    )
      throw new Error('请明确赛季合作起止日期');
  }
  const chosen = new Set(players.map((player) => player.id));
  const appearances = [];
  for (const slot of draft.slots) {
    if (!text(slot.label, 80) || !text(slot.venue, 120)) throw new Error('请补齐每场名称与地点');
    const ids = slot.profileIds || [];
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      ids.some((profileId) => !chosen.has(profileId))
    )
      throw new Error('请为每一场明确选择本场参与球员');
    if (slot.conditional && ['SINGLE', 'TIME_BLOCK'].includes(draft.scope))
      throw new Error('单场和按时段预约不能使用条件意向');
    if (slot.conditional && !text(slot.conditionText, 200))
      throw new Error('请写明晋级或条件触发规则');
    const times = slot.conditional ? {} : schedule(slot);
    if (
      draft.scope === 'SEASON' &&
      !slot.conditional &&
      (slot.startDate < draft.periodStart || slot.endDate > draft.periodEnd)
    )
      throw new Error('确定场次须位于所填赛季合作周期内');
    if (slot.matchId) {
      const match = workspace.matches.find(
        (item) =>
          item.id === slot.matchId &&
          item.orgId === team.orgId &&
          item.eventId === draft.eventId &&
          (item.homeTeamId === team.id || item.awayTeamId === team.id),
      );
      if (!match) throw new Error('正式比赛已不在当前球队范围，请重新选择');
      if (
        !slot.conditional &&
        (times.startAt !== match.startAt ||
          times.endAt !== match.endAt ||
          slot.venue.trim() !== match.venue)
      )
        throw new Error('正式赛程已变化，请重新读取本队比赛');
    }
    for (const profileId of ids)
      appearances.push({
        profileId,
        ...(slot.matchId ? { matchId: slot.matchId } : {}),
        label: slot.label.trim(),
        venue: slot.venue.trim(),
        conditional: slot.conditional === true,
        ...(slot.conditional ? { conditionText: slot.conditionText.trim() } : times),
      });
  }
  if (appearances.length > 64) throw new Error('每份合作最多64项球员场次，请拆分预约');
  const identities = appearances.map(
    (a) => a.profileId + ':' + (a.matchId || a.label + ':' + (a.reportAt || a.conditionText)),
  );
  if (new Set(identities).size !== identities.length) throw new Error('同一球员场次不能重复');
  for (const player of players) {
    const fixed = appearances
      .filter((a) => a.profileId === player.id && !a.conditional)
      .sort((a, b) => a.reportAt.localeCompare(b.reportAt));
    for (let index = 1; index < fixed.length; index++) {
      if (Date.parse(fixed[index].reportAt) < Date.parse(fixed[index - 1].endAt) + 1800000)
        throw new Error('同一球员的场次须预留30分钟交通缓冲');
    }
  }
  return {
    commandId,
    orgId: team.orgId,
    teamId: team.id,
    ...(draft.eventId ? { eventId: draft.eventId } : {}),
    eventName: draft.eventName.trim(),
    scope: draft.scope,
    eligibilityConfirmed: true,
    reviewedSettingsVersion: workspace.settings.version,
    reviewedProfileVersions: Object.fromEntries(
      players
        .filter((player) => appearances.some((a) => a.profileId === player.id))
        .map((player) => {
          if (!version(player.version)) throw new Error('球员报价版本无效，请重新读取');
          return [player.id, player.version];
        }),
    ),
    appearances,
  };
}
function validPayload(serialized) {
  if (typeof serialized !== 'string' || serialized.length > 256 * 1024) return false;
  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    return false;
  }
  const required = [
    'commandId',
    'orgId',
    'teamId',
    'eventName',
    'scope',
    'eligibilityConfirmed',
    'reviewedSettingsVersion',
    'reviewedProfileVersions',
    'appearances',
  ];
  if (
    !object(value) ||
    !ownKeys(value, required, required.concat('eventId')) ||
    !id(value.commandId) ||
    !id(value.orgId) ||
    !id(value.teamId) ||
    (value.eventId !== undefined && !id(value.eventId)) ||
    !text(value.eventName, 80) ||
    !SCOPES.some((scope) => scope.value === value.scope) ||
    value.eligibilityConfirmed !== true ||
    !version(value.reviewedSettingsVersion) ||
    !object(value.reviewedProfileVersions) ||
    !Array.isArray(value.appearances) ||
    value.appearances.length < 1 ||
    value.appearances.length > 64
  )
    return false;
  const profiles = new Set();
  for (const a of value.appearances) {
    const keys = ['profileId', 'label', 'venue', 'conditional'];
    if (
      !object(a) ||
      !ownKeys(
        a,
        keys,
        keys.concat(['matchId', 'conditionText', 'reportAt', 'startAt', 'endAt']),
      ) ||
      !id(a.profileId) ||
      !text(a.label, 80) ||
      !text(a.venue, 120) ||
      typeof a.conditional !== 'boolean' ||
      (a.matchId !== undefined && !id(a.matchId))
    )
      return false;
    if (a.conditional ? !text(a.conditionText, 200) : a.conditionText !== undefined) return false;
    const times =
      !a.conditional ||
      ['reportAt', 'startAt', 'endAt'].some((key) => Object.prototype.hasOwnProperty.call(a, key));
    if (
      times &&
      (!timestamp(a.reportAt) ||
        !timestamp(a.startAt) ||
        !timestamp(a.endAt) ||
        Date.parse(a.reportAt) > Date.parse(a.startAt) ||
        Date.parse(a.startAt) >= Date.parse(a.endAt) ||
        Date.parse(a.endAt) - Date.parse(a.reportAt) > 43200000)
    )
      return false;
    profiles.add(a.profileId);
  }
  const versions = Object.entries(value.reviewedProfileVersions);
  if (
    versions.length !== profiles.size ||
    !versions.every(([key, v]) => id(key) && profiles.has(key) && version(v))
  )
    return false;
  const identities = value.appearances.map(
    (a) => a.profileId + ':' + (a.matchId || a.label + ':' + (a.reportAt || a.conditionText)),
  );
  if (new Set(identities).size !== identities.length) return false;
  if (
    value.scope === 'SINGLE' &&
    (value.appearances.some((a) => a.conditional) ||
      new Set(
        value.appearances.map((a) => a.reportAt + ':' + a.startAt + ':' + a.endAt + ':' + a.venue),
      ).size !== 1)
  )
    return false;
  return true;
}
module.exports = {
  SCOPES,
  id,
  calendarDate,
  chinaStamp,
  initialSlot,
  fromMatch,
  selectedProfiles,
  quoteDraft,
  buildCreate,
  validPayload,
};
