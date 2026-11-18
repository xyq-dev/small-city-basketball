const { circlePairings } = require('./circle-pairing');
const SAMPLE = [
  '青锋一队',
  '青锋二队',
  '青锋三队',
  '青锋四队',
  '青锋五队',
  '青锋六队',
  '青锋七队',
  '青锋八队',
];
const TIMES = ['09:00', '11:00', '14:00', '16:00'];

function planTrial(input) {
  const teams = (input.teams || []).map((name) => String(name || '').trim()).filter(Boolean);
  const dates = (input.dates || []).map((date) => String(date || '').trim()).filter(Boolean);
  const courts = (input.courts || []).map((court) => String(court || '').trim()).filter(Boolean);
  const kept = { teams, dates, courts };
  const fail = (hard) => ({ ok: false, hard, soft: '', placed: [], ...kept });
  if (new Set(teams).size !== teams.length) return fail('队名不能重复。');
  if (teams.length < 2) return fail('至少需要 2 支球队才能试排。');
  if (teams.length > 16) return fail('试排最多 16 队、128 场，超出部分不会静默删掉。');
  if (!dates.length) return fail('请至少填写一个比赛日。');
  if (!courts.length) return fail('请至少填写一个场地。');
  const paired = circlePairings(teams);
  const games = paired.fixtures.map((fixture) => ({
    roundNo: fixture.roundNo,
    position: fixture.positionNo,
    home: fixture.homeEntryId,
    away: fixture.awayEntryId,
  }));
  const rounds = paired.rounds.map((round) => ({
    roundNo: round.roundNo,
    bye: round.byeEntryId || '',
    games: games.filter((game) => game.roundNo === round.roundNo),
  }));
  const pairs = new Set();
  for (const game of games) {
    const pair = [game.home, game.away].sort().join('|');
    if (pairs.has(pair)) return fail('对阵出现重复，已停止生成。');
    pairs.add(pair);
  }
  if (games.length > 128) return fail('试排最多 128 场，当前对阵超出上限。');
  const slots = [];
  dates.forEach((date, day) =>
    TIMES.forEach((time, timeIndex) =>
      slots.push({ date, time, slot: day * TIMES.length + timeIndex }),
    ),
  );
  let cursor = 0;
  const placed = [];
  for (const round of rounds) {
    let courtIndex = 0;
    for (const game of round.games) {
      if (courtIndex >= courts.length) {
        courtIndex = 0;
        cursor += 1;
      }
      if (cursor >= slots.length) {
        return {
          ...fail(
            '场地时段不够，还差 ' +
              (games.length - placed.length) +
              ' 场。请增加比赛日或场地后再生成。',
          ),
          rounds,
        };
      }
      placed.push({
        ...game,
        date: slots[cursor].date,
        time: slots[cursor].time,
        slot: slots[cursor].slot,
        court: courts[courtIndex],
        demo: true,
      });
      courtIndex += 1;
    }
    cursor += 1;
  }
  const last = new Map();
  let consecutive = false;
  for (const game of placed) {
    for (const name of [game.home, game.away]) {
      if (last.has(name) && game.slot - last.get(name) === 1) consecutive = true;
      last.set(name, game.slot);
    }
  }
  return {
    ok: true,
    hard: '',
    soft: consecutive ? '部分球队会连续出场。这是偏好未全部满足，正式发布前可以再调整。' : '',
    placed,
    rounds,
    ...kept,
  };
}

module.exports = { SAMPLE, planTrial };
