// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type {
  ResultConfirmationData,
  ScoringCommandInput,
  ScoringEventData,
  ScoringWorkbenchData,
} from '@small-city-basketball/contracts';
import { createApiClient } from '../api/client';
import { MatchWorkbench } from './Workbench';
import { CorrectionDialog } from './Dialogs';
import { PlayerStatisticsPanel } from './PlayerStatistics';
import {
  lease,
  now,
  playerRoster,
  playerSnapshot,
  playerStatistics,
  playerWorkbench,
  response,
  snapshot,
  workbench,
} from './test-fixtures';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
function setup(initial: ScoringWorkbenchData, confirmations: ResultConfirmationData[] = []) {
  let current = structuredClone(initial);
  const commands: ScoringCommandInput[] = [];
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = String(url);
    if (path.endsWith('/scorekeeper-lease') && init?.method === 'POST') {
      const input = JSON.parse(String(init.body));
      return response({ ...lease, clientInstanceId: input.clientInstanceId });
    }
    if (path.endsWith('/commands') && init?.method === 'POST') {
      const input = JSON.parse(String(init.body)) as ScoringCommandInput;
      commands.push(input);
      const version = current.match.version + 1;
      if (input.type === 'PREPARE_MATCH') {
        current.snapshot = {
          ...(input.payload.collectionMode === 'PLAYER_BASIC'
            ? structuredClone(playerSnapshot)
            : structuredClone(snapshot)),
          status: 'READY',
          version,
        };
        current.capabilities.canPrepare = false;
      } else if (input.type === 'RECORD_STAT' && current.snapshot) {
        const { side, kind, value, memberId } = input.payload;
        const teamKey = side === 'HOME' ? 'home' : 'away';
        const key = kind === 'SCORE' ? 'score' : kind === 'FOUL' ? 'fouls' : 'timeouts';
        current.snapshot.totals[teamKey][key] += value;
        current.snapshot.periods[0][teamKey][key] += value;
        const team = current.snapshot.playerStatistics?.[teamKey];
        if (team && kind !== 'TIMEOUT') {
          const target =
            team.players.find((player) => player.memberId === memberId) ?? team.unassigned;
          target[key as 'score' | 'fouls'] += value;
        }
      }
      current.match.version = version;
      if (current.snapshot) {
        current.snapshot.version = version;
        current.match.status = current.snapshot.status;
      }
      return response({
        receipt: {
          commandId: input.commandId,
          matchId: current.match.id,
          type: input.type,
          appliedVersion: version,
          firstEventSeq: 3,
          lastEventSeq: 3,
          acceptedAt: now,
        },
        snapshot: current.snapshot,
      });
    }
    if (path.includes('/scoring-events')) return response([]);
    if (path.includes('/result-confirmations')) return response(confirmations);
    return response(current);
  });
  const context = {
    client: createApiClient({ fetcher }),
    organizationId: 'org-a',
    userId: 'user-a',
    onSessionRefresh: async () => {},
  };
  render(
    <MemoryRouter>
      <MatchWorkbench context={context} matchId="match-a" />
    </MemoryRouter>,
  );
  return { commands, fetcher, confirmations, read: () => current };
}

describe('player basic collection UI', () => {
  it('prepares an explicitly chosen immutable mode without changing the legacy default', async () => {
    const model = setup({
      ...playerWorkbench,
      snapshot: null,
      match: { ...workbench.match, status: 'SCHEDULED' },
      capabilities: { ...workbench.capabilities, canPrepare: true },
    });
    const selector = await screen.findByRole('combobox', { name: '统计采集模式' });
    expect(selector).toHaveValue('TEAM_ONLY');
    expect(screen.getByText(/准备后本场模式不可更改/)).toBeVisible();
    change('统计采集模式', 'PLAYER_BASIC');
    fireEvent.click(screen.getByRole('button', { name: '准备比赛' }));
    await waitFor(() => expect(model.commands).toHaveLength(1));
    expect(model.commands[0]).toMatchObject({
      type: 'PREPARE_MATCH',
      payload: { expectedEventVersion: 8, collectionMode: 'PLAYER_BASIC' },
    });
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: '统计采集模式' })).not.toBeInTheDocument(),
    );
    expect(await screen.findByLabelText('个人基础统计')).toHaveTextContent('已归属得分 0 / 0');
  });

  it('records a selected player and unassigned score once, and refreshes the same authoritative totals', async () => {
    const model = setup(playerWorkbench);
    fireEvent.click(await screen.findByRole('button', { name: '取得记分控制权' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '主队加2分' })).toBeEnabled());
    change('主队球员归属', playerRoster.home[0].memberId);
    fireEvent.click(screen.getByRole('button', { name: '主队加2分' }));
    await waitFor(() => expect(model.commands).toHaveLength(1));
    expect(model.commands[0]).toMatchObject({
      type: 'RECORD_STAT',
      payload: { side: 'HOME', kind: 'SCORE', value: 2, memberId: playerRoster.home[0].memberId },
    });
    await waitFor(() => expect(screen.getByLabelText('主队比分')).toHaveTextContent('2'));
    const table = screen.getByRole('table', { name: '合成甲队球员基础统计' });
    expect(within(table).getByRole('row', { name: '7号 合成球员甲 2 0' })).toBeVisible();
    change('主队球员归属', '');
    fireEvent.click(screen.getByRole('button', { name: '主队加1分' }));
    await waitFor(() => expect(model.commands).toHaveLength(2));
    expect(model.commands[1].payload).toMatchObject({ memberId: null, value: 1 });
    await waitFor(() => expect(screen.getByLabelText('主队比分')).toHaveTextContent('3'));
    expect(within(table).getByRole('row', { name: '未归属球员 1 0' })).toBeVisible();
    expect(screen.getByText('已归属得分 2 / 3 · 未归属 1 分')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新读取比赛' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '重新读取比赛' })).toBeEnabled());
    expect(model.commands).toHaveLength(2);
    expect(screen.getByLabelText('主队比分')).toHaveTextContent('3');
    expect(within(table).getByRole('row', { name: '7号 合成球员甲 2 0' })).toBeVisible();
  });

  it('never attributes timeouts to a selected player and blocks player writes when offline', async () => {
    const model = setup(playerWorkbench);
    fireEvent.click(await screen.findByRole('button', { name: '取得记分控制权' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '主队暂停加1' })).toBeEnabled());
    change('主队球员归属', playerRoster.home[0].memberId);
    fireEvent.click(screen.getByRole('button', { name: '主队暂停加1' }));
    await waitFor(() => expect(model.commands).toHaveLength(1));
    expect(model.commands[0].payload).not.toHaveProperty('memberId');
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByLabelText('主队球员归属')).toBeDisabled();
    expect(screen.getByRole('button', { name: '主队加2分' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '主队加2分' }));
    expect(model.commands).toHaveLength(1);
  });

  it('shows player data as read only without a scoring capability or a held lease', async () => {
    const model = setup({
      ...playerWorkbench,
      capabilities: {
        ...workbench.capabilities,
        canAcquireControl: false,
        canRecord: false,
        canCorrect: false,
      },
    });
    expect(await screen.findByLabelText('个人基础统计')).toHaveTextContent('合成球员甲');
    expect(screen.getByLabelText('主队球员归属')).toBeDisabled();
    expect(screen.getByRole('button', { name: '主队加2分' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '取得记分控制权' })).not.toBeInTheDocument();
    expect(model.commands).toHaveLength(0);
  });

  it('keeps TEAM_ONLY free of invented player zeroes or attribution selectors', () => {
    render(<PlayerStatisticsPanel statistics={null} homeName="主队" awayName="客队" />);
    expect(screen.getByText('本场采用球队记分；个人得分及犯规：未统计。')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/篮板、助攻、抢断/)).toHaveTextContent('未统计');
  });

  it('pins reviewed personal statistics and refuses confirmation after a newer version arrives', async () => {
    const initial = structuredClone(playerWorkbench);
    initial.match.status = 'PENDING_CONFIRMATION';
    initial.snapshot!.status = 'PENDING_CONFIRMATION';
    initial.snapshot!.clock.remainingMs = 0;
    initial.snapshot!.totals.home.score = 2;
    initial.snapshot!.periods[0].home.score = 2;
    initial.snapshot!.playerStatistics!.home.players[0].score = 2;
    initial.capabilities = {
      ...initial.capabilities,
      canAcquireControl: false,
      canRecord: false,
      canCorrect: false,
      canConfirm: true,
    };
    const model = setup(initial);
    fireEvent.click(await screen.findByRole('button', { name: '确认当前赛果' }));
    const dialog = screen.getByRole('dialog', { name: '确认当前赛果' });
    expect(within(dialog).getByText('已归属得分 2 / 2 · 未归属 0 分')).toBeVisible();
    const current = model.read();
    current.match.version = 4;
    current.snapshot!.version = 4;
    current.snapshot!.totals.home.score = 4;
    current.snapshot!.periods[0].home.score = 4;
    current.snapshot!.playerStatistics!.home.players[0].score = 4;
    fireEvent.click(screen.getByRole('button', { name: '重新读取比赛' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '正式确认赛果' })).toBeDisabled(),
    );
    expect(within(dialog).getByRole('alert')).toHaveTextContent('待确认赛果版本已变化');
    expect(within(dialog).getByText('已归属得分 2 / 2 · 未归属 0 分')).toBeVisible();
    expect(within(dialog).queryByText('已归属得分 4 / 4 · 未归属 0 分')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '正式确认赛果' }));
    expect(model.commands).toHaveLength(0);
  });

  it('uses the confirmation snapshot for history instead of current player values', async () => {
    const current = structuredClone(playerWorkbench);
    current.snapshot!.totals.home.score = 4;
    current.snapshot!.periods[0].home.score = 4;
    current.snapshot!.playerStatistics!.home.players[0].score = 4;
    const historical = structuredClone(playerStatistics);
    historical.home.players[0].score = 2;
    setup(current, [
      {
        id: 'confirmed-old',
        matchId: 'match-a',
        confirmingUserId: 'reviewer',
        rulesetId: snapshot.rules.id,
        rulesetVersion: 1,
        sourceMatchVersion: 4,
        lastEventSeq: 3,
        home: { score: 2, fouls: 0, timeouts: 0 },
        away: { score: 0, fouls: 0, timeouts: 0 },
        periods: [
          {
            period: 1,
            home: { score: 2, fouls: 0, timeouts: 0 },
            away: { score: 0, fouls: 0, timeouts: 0 },
          },
        ],
        playerStatistics: historical,
        confirmedAt: now,
      },
    ]);
    const history = await screen.findByLabelText('确认版本4个人统计');
    expect(within(history).getByText('已归属得分 2 / 2 · 未归属 0 分')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('个人基础统计')).getByText('已归属得分 4 / 4 · 未归属 0 分'),
    ).toBeVisible();
  });
});

describe('player attribution correction', () => {
  const events: ScoringEventData[] = [
    {
      id: 'recorded-home-player',
      seq: 3,
      type: 'STAT_RECORDED',
      payload: {
        side: 'HOME',
        kind: 'SCORE',
        value: 2,
        period: 1,
        memberId: playerRoster.home[0].memberId,
      },
      actorId: 'scorer',
      commandId: 'command',
      capturedAt: now,
      serverTime: now,
      targetEventId: null,
    },
  ];
  it('initializes the original player on replacement and clears attribution on a side change', async () => {
    const submit = vi.fn().mockResolvedValue(false);
    render(
      <CorrectionDialog
        snapshot={playerSnapshot}
        playerRoster={playerRoster}
        events={events}
        busy={false}
        onSubmit={submit}
        onClose={vi.fn()}
      />,
    );
    change('修正方式', 'REPLACE_STAT');
    change('原始统计记录', events[0].id);
    expect(screen.getByLabelText('统计归属球员')).toHaveValue(playerRoster.home[0].memberId);
    change('修正理由', '复核归属');
    fireEvent.click(screen.getByRole('button', { name: '提交修正' }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        type: 'REPLACE_STAT',
        payload: {
          targetEventId: events[0].id,
          side: 'HOME',
          value: 2,
          reason: '复核归属',
          memberId: playerRoster.home[0].memberId,
        },
      }),
    );
    change('所属球队', 'AWAY');
    expect(screen.getByLabelText('统计归属球员')).toHaveValue('');
    expect(screen.queryByRole('option', { name: '7号 · 合成球员甲' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提交修正' }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        type: 'REPLACE_STAT',
        payload: {
          targetEventId: events[0].id,
          side: 'AWAY',
          value: 2,
          reason: '复核归属',
          memberId: null,
        },
      }),
    );
  });
  it('sends explicit unassigned or selected player on additions while omitting attribution for timeouts', async () => {
    const submit = vi.fn().mockResolvedValue(false);
    render(
      <CorrectionDialog
        snapshot={playerSnapshot}
        events={[]}
        playerRoster={playerRoster}
        busy={false}
        onSubmit={submit}
        onClose={vi.fn()}
      />,
    );
    change('统计数值', '2');
    change('修正理由', '补记漏分');
    fireEvent.click(screen.getByRole('button', { name: '提交修正' }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        type: 'ADD_CORRECTION',
        payload: {
          side: 'HOME',
          kind: 'SCORE',
          period: 1,
          value: 2,
          reason: '补记漏分',
          memberId: null,
        },
      }),
    );
    change('统计归属球员', playerRoster.home[1].memberId);
    fireEvent.click(screen.getByRole('button', { name: '提交修正' }));
    await waitFor(() =>
      expect(submit.mock.lastCall?.[0].payload.memberId).toBe(playerRoster.home[1].memberId),
    );
    change('统计项目', 'TIMEOUT');
    change('统计数值', '1');
    expect(screen.queryByLabelText('统计归属球员')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提交修正' }));
    await waitFor(() =>
      expect(submit.mock.lastCall?.[0].payload).toEqual({
        side: 'HOME',
        kind: 'TIMEOUT',
        period: 1,
        value: 1,
        reason: '补记漏分',
      }),
    );
  });
});
