const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPage, createWx } = require('./helpers/native-page.cjs');
const { buildPreview } = require('./helpers/native-preview.cjs');
const root = path.resolve(__dirname, '..');
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const snapshot = () => ({
  status: 'READY',
  version: 2,
  home: { teamName: '主队' },
  away: { teamName: '客队' },
  totals: { home: { score: 0, fouls: 0, timeouts: 0 }, away: { score: 0, fouls: 0, timeouts: 0 } },
  periods: [],
  rules: { regulationPeriods: 4, allowedScoreValues: [1, 2, 3] },
  clock: {
    period: 1,
    running: false,
    remainingMs: 60000,
    anchorServerTime: '2026-10-31T00:00:00Z',
  },
  serverTime: '2026-10-31T00:00:00Z',
  collected: { playerStatistics: true },
  professionalStatistics: {
    home: {
      lineup: [id(1)],
      players: [
        {
          memberId: id(1),
          name: '甲',
          jerseyNo: '1',
          onCourt: true,
          starter: true,
          appeared: true,
          playingMs: 10000,
          fieldGoalsMade: 1,
          fieldGoalsAttempted: 2,
          fieldGoalPercentage: 50,
          threePointersMade: 0,
          threePointersAttempted: 1,
          freeThrowsMade: 0,
          freeThrowsAttempted: 0,
          rebounds: 1,
          assists: 2,
          steals: 0,
          blocks: 0,
          turnovers: 1,
        },
      ],
    },
    away: {
      lineup: [id(2)],
      players: [
        {
          memberId: id(2),
          name: '乙',
          jerseyNo: '2',
          onCourt: true,
          starter: true,
          appeared: true,
          playingMs: 10000,
          fieldGoalsMade: 0,
          fieldGoalsAttempted: 0,
          fieldGoalPercentage: null,
          rebounds: 0,
          assists: 0,
          steals: 0,
          blocks: 0,
          turnovers: 0,
        },
      ],
    },
  },
});
const event = (side, kind, value) => ({ currentTarget: { dataset: { side, kind, value } } });
test('professional prepare is explicit and choosing team-only clears the switch', () => {
  const h = loadPage({ root, route: 'pages/org-match/index' }),
    sent = [];
  h.page._eventVersion = 4;
  h.page.run = (...args) => sent.push(args);
  h.page.setMode({ currentTarget: { dataset: { mode: 'PLAYER_BASIC' } } });
  h.page.setTechnical({ detail: { value: true } });
  h.page.prepare();
  assert.equal(sent[0][1].technicalCollection, true);
  h.page.setMode({ currentTarget: { dataset: { mode: 'TEAM_ONLY' } } });
  h.page.prepare();
  assert.equal('technicalCollection' in sent[1][1], false);
});
test('native scorer sends made/missed shots and technical events with selected player identity', () => {
  const h = loadPage({ root, route: 'pages/scorer/index' }),
    sent = [];
  h.page.command = (...args) => sent.push(args);
  h.page.setData({
    match: { home: '主队', away: '客队' },
    roster: {
      home: [{ memberId: id(1), label: '1号 甲' }],
      away: [{ memberId: id(2), label: '2号 乙' }],
    },
    pick: { home: 0, away: 0 },
  });
  h.page.show(snapshot(), Date.now());
  h.page.stat(event('HOME', 'SCORE', 3));
  h.page.missShot(event('HOME', null, 2));
  h.page.technical(event('HOME', 'ASSIST'));
  assert.deepEqual(JSON.parse(JSON.stringify(sent.map((a) => a.slice(0, 2)))), [
    ['RECORD_SHOT', { side: 'HOME', memberId: id(1), shotValue: 3, made: true }],
    ['RECORD_SHOT', { side: 'HOME', memberId: id(1), shotValue: 2, made: false }],
    ['RECORD_TECHNICAL', { side: 'HOME', memberId: id(1), kind: 'ASSIST' }],
  ]);
  assert.equal(h.page.data.proGroups[0].players[0].time, '0:10');
  assert.equal(h.page.data.proGroups[0].players[0].shooting, '1/2');
});
test('professional history distinguishes missed-shot/technical voids and builds three-width layouts', () => {
  const h = loadPage({ root, route: 'pages/scorer/index', wx: createWx() }),
    scoring = h.requireLocal('utils/scoring.js');
  const result = scoring.history(
    [
      {
        id: id(3),
        seq: 1,
        type: 'PRO_STAT_RECORDED',
        payload: {
          kind: 'SHOT',
          side: 'HOME',
          memberId: id(1),
          shotValue: 2,
          made: false,
          period: 1,
        },
        serverTime: '2026-10-31T00:00:00Z',
      },
    ],
    snapshot(),
    { [id(1)]: '甲' },
  );
  assert.equal(result[0].voidType, 'VOID_PRO_STAT');
  assert.match(result[0].text, /2分未命中/);
  h.page.setData({ match: { home: '主队', away: '客队', status: 'READY' }, held: true });
  h.page.show(snapshot(), Date.now());
  for (const width of [320, 390, 430]) {
    const preview = buildPreview({ root, route: 'pages/scorer/index', data: h.page.data, width });
    assert.match(preview.html, /专业统计与实际阵容时间/);
  }
});
