// Client-side allocation proposal for a round-robin draft. Like the Web console's suggestion,
// it only proposes court/time pairs; the server validates every conflict before publishing.
const conflictLabels = {
  UNASSIGNED: '尚未安排时间与场地',
  OUTSIDE_WINDOW: '超出场地可用时段',
  OUTSIDE_EVENT_DATES: '超出赛事日期',
  COURT_DISABLED: '场地已停用',
  COURT_OVERLAP: '同一场地时间重叠',
  TEAM_OVERLAP: '同一球队时间重叠',
  MIN_REST: '球队休息时间不足',
  MIN_LOCAL_DAY_GAP: '球队比赛日间隔不足',
};
const DAY = 86400000;
const localDay = (ms) => Math.floor((ms + 8 * 3600000) / DAY);

function slots(policy) {
  const step = policy.slotDurationMinutes * 60000;
  const result = [];
  for (const w of policy.courtWindows) {
    const end = Date.parse(w.endsAt);
    for (let t = Date.parse(w.startsAt); t + step <= end; t += step)
      result.push({ courtId: w.courtId, start: t, end: t + step });
  }
  return result.sort((a, b) => a.start - b.start || (a.courtId < b.courtId ? -1 : 1));
}
/** Earliest feasible slot per fixture, in round order; unplaceable fixtures stay unassigned. */
function propose(revision) {
  const policy = revision.policy;
  const free = slots(policy);
  const used = new Set();
  const teams = new Map();
  const rest = policy.minRestMinutes * 60000;
  const fixtures = revision.fixtures
    .slice()
    .sort((a, b) => a.roundNo - b.roundNo || a.positionNo - b.positionNo);
  const allocations = [];
  for (const f of fixtures) {
    const fits = (slot) => {
      for (const entry of [f.homeEntryId, f.awayEntryId])
        for (const busy of teams.get(entry) || []) {
          if (slot.start < busy.end + rest && busy.start < slot.end + rest) return false;
          if (policy.minLocalDayGap > 0) {
            const gap = Math.abs(localDay(slot.start) - localDay(busy.start));
            if (gap < policy.minLocalDayGap) return false;
          }
        }
      return true;
    };
    const index = free.findIndex((slot, i) => !used.has(i) && fits(slot));
    if (index < 0) {
      allocations.push({ fixtureKey: f.fixtureKey, courtId: null, startsAt: null });
      continue;
    }
    const slot = free[index];
    used.add(index);
    for (const entry of [f.homeEntryId, f.awayEntryId])
      teams.set(entry, (teams.get(entry) || []).concat({ start: slot.start, end: slot.end }));
    allocations.push({
      fixtureKey: f.fixtureKey,
      courtId: slot.courtId,
      startsAt: new Date(slot.start).toISOString(),
    });
  }
  return {
    allocations,
    unassigned: allocations.filter((a) => !a.startsAt).length,
  };
}
function eachDay(startDate, endDate) {
  const days = [];
  for (
    let t = Date.parse(startDate + 'T00:00:00Z');
    t <= Date.parse(endDate + 'T00:00:00Z') && days.length < 366;
    t += DAY
  )
    days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}
module.exports = { conflictLabels, slots, propose, eachDay };
