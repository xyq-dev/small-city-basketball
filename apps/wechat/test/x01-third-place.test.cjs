const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createWx, loadPage } = require('./helpers/native-page.cjs');
const root = path.resolve(__dirname, '..');

test('X01 semifinal losers are explicitly labeled as the bronze source, with no invented names', () => {
  const h = loadPage({ root, route: 'pages/bracket/index', wx: createWx() });
  const bracket = h.requireLocal('utils/bracket.js');
  const rounds = bracket.rounds(
    {
      rounds: [
        {
          roundNo: 2,
          label: '决赛与季军赛',
          published: false,
          slots: [
            {
              fixtureKey: 'R2-P1',
              kind: 'CHAMPIONSHIP',
              sourceOutcome: 'WINNER',
              positionNo: 1,
              homeEntryId: null,
              awayEntryId: null,
              homeSource: 'R1-P1',
              awaySource: 'R1-P2',
              status: 'WAITING',
              winnerEntryId: null,
            },
            {
              fixtureKey: 'R2-P2',
              kind: 'THIRD_PLACE',
              sourceOutcome: 'LOSER',
              positionNo: 2,
              homeEntryId: null,
              awayEntryId: null,
              homeSource: 'R1-P1',
              awaySource: 'R1-P2',
              status: 'WAITING',
              winnerEntryId: null,
            },
          ],
        },
      ],
    },
    {},
  );
  assert.equal(rounds[0].slots[0].home, '待定（R1-P1胜者）');
  assert.equal(rounds[0].slots[1].home, '待定（R1-P1负者）');
  assert.equal(rounds[0].slots[1].away, '待定（R1-P2负者）');
  assert.equal(rounds[0].slots[0].winnerLabel, '冠军');
  assert.equal(rounds[0].slots[1].winnerLabel, '季军');
  assert.equal(rounds[0].slots[1].label, '季军赛');
});

test('X01 historical slots retain their original view-model shape', () => {
  const h = loadPage({ root, route: 'pages/bracket/index', wx: createWx() });
  const bracket = h.requireLocal('utils/bracket.js');
  const slot = bracket.rounds(
    {
      rounds: [
        {
          roundNo: 1,
          label: '决赛',
          published: false,
          slots: [
            {
              fixtureKey: 'R1-P1',
              homeEntryId: 'a',
              awayEntryId: 'b',
              status: 'SCHEDULED',
              winnerEntryId: null,
            },
          ],
        },
      ],
    },
    { a: '甲', b: '乙' },
  )[0].slots[0];
  assert.equal(slot.home, '甲');
  assert.equal(slot.away, '乙');
  assert.equal(Object.hasOwn(slot, 'label'), false);
  assert.equal(Object.hasOwn(slot, 'winnerLabel'), false);
});

test('X02 administrative slots label the actual decision while preserving the original match state', () => {
  const h = loadPage({ root, route: 'pages/bracket/index', wx: createWx() });
  const bracket = h.requireLocal('utils/bracket.js');
  for (const kind of ['FORFEIT', 'CANCELLED']) {
    const slot = bracket.rounds(
      {
        rounds: [
          {
            roundNo: 1,
            label: '决赛',
            published: true,
            slots: [
              {
                fixtureKey: 'R1-P1',
                status: 'SCHEDULED',
                adjudication: { kind },
                homeEntryId: 'a',
                awayEntryId: 'b',
                winnerEntryId: kind === 'FORFEIT' ? 'b' : null,
              },
            ],
          },
        ],
      },
      { a: '甲', b: '乙' },
    )[0].slots[0];
    assert.equal(slot.status, 'SCHEDULED');
    assert.equal(slot.statusLabel, kind === 'FORFEIT' ? '弃权裁定' : '本场取消');
    assert.equal(slot.winner, kind === 'FORFEIT' ? '乙' : '');
  }
});
