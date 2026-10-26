const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');

const root = path.resolve(__dirname, '..');
const harness = loadPage({ root, route: 'pages/scorer/index' });
const scoring = harness.requireLocal('utils/scoring.js');
const plan = harness.requireLocal('utils/schedule.js');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const snapshot = {
  status: 'LIVE',
  version: 7,
  home: { teamName: '合成主队' },
  away: { teamName: '合成客队' },
  totals: { home: { score: 5, fouls: 1, timeouts: 0 }, away: { score: 3, fouls: 0, timeouts: 1 } },
  periods: [{ period: 1, home: { score: 5 }, away: { score: 3 } }],
  rules: { regulationPeriods: 4, allowedScoreValues: [1, 2, 3] },
  clock: {
    period: 1,
    remainingMs: 60000,
    running: true,
    anchorServerTime: '2026-10-27T10:00:00.000Z',
  },
  serverTime: '2026-10-27T10:00:10.000Z',
  collected: { playerStatistics: true },
  requiresReconfirmation: false,
};

test('board interpolates the running clock once from server time and labels overtime', () => {
  const receivedAt = 1000;
  const board = scoring.board(snapshot, receivedAt, receivedAt + 5000);
  // 60s at anchor, 10s elapsed by serverTime, 5s more locally => 0:45.
  assert.equal(board.clockLabel, '0:45');
  assert.equal(board.home.score, 5);
  assert.equal(board.playerMode, true);
  assert.equal(scoring.period(snapshot.rules, 5), '加时1');
  assert.equal(scoring.duration(600), '10 分钟');
  assert.equal(scoring.duration(1), '1 秒');
  assert.equal(scoring.board({ ...snapshot, status: 'FINAL' }, 0).final, true);
  assert.equal(
    scoring.board({ ...snapshot, status: 'FINAL', requiresReconfirmation: true }, 0).final,
    false,
  );
});

test('history keeps voided records visible, marks them and never offers voiding twice', () => {
  const events = [
    { id: id(1), seq: 1, type: 'START_MATCH', payload: {}, serverTime: snapshot.serverTime },
    {
      id: id(2),
      seq: 2,
      type: 'STAT_RECORDED',
      payload: { kind: 'SCORE', side: 'HOME', value: 2, period: 1, memberId: id(9) },
      serverTime: snapshot.serverTime,
    },
    {
      id: id(3),
      seq: 3,
      type: 'STAT_VOIDED',
      targetEventId: id(2),
      payload: { reason: '记错球队' },
      serverTime: snapshot.serverTime,
    },
  ];
  const rows = scoring.history(events, snapshot, { [id(9)]: '4号 合成甲' });
  assert.deepEqual(
    rows.map((r) => r.seq),
    [3, 2, 1],
  );
  const stat = rows.find((r) => r.seq === 2);
  assert.equal(stat.voided, true);
  assert.equal(stat.canVoid, false);
  assert.match(stat.text, /合成主队 得分 \+2 · 4号 合成甲/);
  assert.equal(rows.find((r) => r.seq === 3).reason, '记错球队');
});

test('an unknown command result is kept for receipt lookup; known failures are thrown', async () => {
  const lost = { request: () => Promise.reject({ code: 'NETWORK_ERROR', message: 'x' }) };
  const body = { commandId: id(5), expectedVersion: 1, type: 'CLOCK_START', payload: {} };
  const outcome = await scoring.send(lost, '/v1/orgs/' + id(1) + '/matches/' + id(2), body);
  assert.equal(outcome.done, false);
  assert.equal(outcome.pending, body);
  const rejected = { request: () => Promise.reject({ code: 'LEASE_CONFLICT', status: 409 }) };
  await assert.rejects(scoring.send(rejected, '/x', body), { code: 'LEASE_CONFLICT' });
  const missing = { request: () => Promise.reject({ code: 'COMMAND_NOT_FOUND', status: 404 }) };
  assert.equal(await scoring.receipt(missing, '/x', id(5)), null);
});

test('scorer blocks new writes while a result is unknown and never writes without control', async () => {
  const wx = createWx();
  const h = loadPage({ root, route: 'pages/scorer/index', wx });
  h.page.setData({
    match: { home: '甲', away: '乙', status: 'LIVE' },
    board: { playerMode: false },
  });
  await h.page.command('CLOCK_START', {}, '启动计时');
  assert.match(h.page.data.error, /请先取得记分控制/);
  h.page._control = { leaseId: id(1), fencingToken: '1', clientInstanceId: id(2) };
  h.page.setData({ pending: { body: {}, label: '记录' } });
  await h.page.command('CLOCK_START', {}, '启动计时');
  assert.equal(
    wx.calls.some((c) => c.type === 'request'),
    false,
  );
});

test('schedule proposal never double-books a team, respects rest and leaves overflow unassigned', () => {
  const court = id(10);
  const revision = {
    policy: {
      slotDurationMinutes: 60,
      minRestMinutes: 60,
      minLocalDayGap: 0,
      courtWindows: [
        {
          courtId: court,
          startsAt: '2028-03-01T01:00:00.000Z',
          endsAt: '2028-03-01T06:00:00.000Z',
        },
      ],
    },
    fixtures: [
      { fixtureKey: 'a', roundNo: 1, positionNo: 1, homeEntryId: 'A', awayEntryId: 'B' },
      { fixtureKey: 'b', roundNo: 1, positionNo: 2, homeEntryId: 'C', awayEntryId: 'D' },
      { fixtureKey: 'c', roundNo: 2, positionNo: 1, homeEntryId: 'A', awayEntryId: 'C' },
      { fixtureKey: 'd', roundNo: 2, positionNo: 2, homeEntryId: 'B', awayEntryId: 'D' },
      { fixtureKey: 'e', roundNo: 3, positionNo: 1, homeEntryId: 'A', awayEntryId: 'D' },
      { fixtureKey: 'f', roundNo: 3, positionNo: 2, homeEntryId: 'B', awayEntryId: 'C' },
    ],
  };
  const { allocations, unassigned } = plan.propose(revision);
  const at = Object.fromEntries(allocations.map((a) => [a.fixtureKey, a.startsAt]));
  // Five one-hour slots on one court; a team needs one free hour between its games.
  const games = {};
  for (const f of revision.fixtures)
    if (at[f.fixtureKey])
      for (const team of [f.homeEntryId, f.awayEntryId])
        (games[team] = games[team] || []).push(Date.parse(at[f.fixtureKey]));
  for (const times of Object.values(games)) {
    times.sort((x, y) => x - y);
    for (let i = 1; i < times.length; i++)
      assert.ok(times[i] - times[i - 1] >= 2 * 3600000, 'one hour game plus one hour rest');
  }
  assert.deepEqual(at, {
    a: '2028-03-01T01:00:00.000Z',
    b: '2028-03-01T02:00:00.000Z',
    c: '2028-03-01T04:00:00.000Z',
    d: '2028-03-01T05:00:00.000Z',
    e: null,
    f: null,
  });
  assert.equal(unassigned, 2);
  assert.equal(allocations.length, 6, 'every fixture key is sent, assigned or not');
  assert.deepEqual(
    [...plan.eachDay('2028-02-28', '2028-03-01')],
    ['2028-02-28', '2028-02-29', '2028-03-01'],
  );
});
