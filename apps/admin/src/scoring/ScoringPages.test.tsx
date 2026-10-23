// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ScoringWorkbenchData, ScoringEventData } from '@small-city-basketball/contracts';
import { createApiClient } from '../api/client';
import type { RegistrationWorkspace } from '../registration/shared';
import { RulesForm, StaffPanel } from './Management';
import { MatchWorkbench } from './Workbench';
import { ScoringIndexPage, ScoringWorkbenchPage } from './ScoringPages';
import { CorrectionDialog } from './Dialogs';
import { eventScoring, response, snapshot, workbench, deferred } from './test-fixtures';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const context = (fetcher: typeof fetch): RegistrationWorkspace => ({
  client: createApiClient({ fetcher }),
  organizationId: 'org-a',
  userId: 'user-a',
  onSessionRefresh: async () => {},
});
describe('scoring controls and review boundaries', () => {
  it('fixes single-elimination tie handling to overtime and requires an explicit overtime duration', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <RulesForm
        data={{ ...eventScoring, event: { ...eventScoring.event, format: 'SINGLE_ELIMINATION' } }}
        busy={false}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText('平局处理', { exact: true })).toHaveValue('OVERTIME');
    expect(screen.getByLabelText('平局处理', { exact: true })).toBeDisabled();
    expect(screen.queryByRole('option', { name: '允许平局' })).not.toBeInTheDocument();
    change('常规节数', '1');
    change('每节时长（秒）', '60');
    fireEvent.click(screen.getByLabelText('允许1分'));
    fireEvent.click(screen.getByRole('button', { name: '保存记分规则' }));
    expect(screen.getByRole('alert')).toHaveTextContent('加时时长');
    expect(onSave).not.toHaveBeenCalled();
    change('加时时长（秒）', '300');
    fireEvent.click(screen.getByRole('button', { name: '保存记分规则' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ tiePolicy: 'OVERTIME', overtimeDurationSeconds: 300 }),
      ),
    );
  });
  it('names rule and staff selects exactly, independently of selected option text', () => {
    render(
      <>
        <RulesForm data={eventScoring} busy={false} onSave={vi.fn()} />
        <StaffPanel
          data={{ ...workbench, capabilities: { ...workbench.capabilities, canManageStaff: true } }}
          busy={false}
          onSave={vi.fn()}
        />
      </>,
    );
    for (const [label, value] of [
      ['平局处理', 'OVERTIME'],
      ['场次角色', 'RESULT_REVIEWER'],
      ['授权状态', 'DISABLED'],
    ]) {
      const select = screen.getByRole('combobox', { name: label });
      expect(select).toBe(screen.getByLabelText(label, { exact: true }));
      expect(select).toHaveAttribute('aria-label', label);
      fireEvent.change(select, { target: { value } });
      expect(select).toHaveAccessibleName(label);
      expect(screen.getByLabelText(label, { exact: true })).toHaveValue(value);
    }
  });
  it('names every correction select exactly across mode and option changes', () => {
    render(
      <CorrectionDialog
        snapshot={snapshot}
        events={[
          {
            id: 'stat-a',
            seq: 1,
            type: 'STAT_RECORDED',
            payload: { kind: 'SCORE', side: 'HOME', value: 2, period: 1 },
            actorId: 'user-a',
            commandId: 'command-a',
            capturedAt: snapshot.serverTime,
            serverTime: snapshot.serverTime,
            targetEventId: null,
          },
        ]}
        busy={false}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const exactSelect = (label: string) => {
      const select = screen.getByRole('combobox', { name: label });
      expect(select).toBe(screen.getByLabelText(label, { exact: true }));
      expect(select).toHaveAttribute('aria-label', label);
      return select;
    };
    fireEvent.change(exactSelect('统计项目'), { target: { value: 'FOUL' } });
    fireEvent.change(exactSelect('所属球队'), { target: { value: 'AWAY' } });
    fireEvent.change(exactSelect('修正方式'), { target: { value: 'REPLACE_STAT' } });
    fireEvent.change(exactSelect('原始统计记录'), { target: { value: 'stat-a' } });
    expect(exactSelect('原始统计记录')).toHaveValue('stat-a');
    expect(exactSelect('所属球队')).toHaveValue('HOME');
    change('修正理由', '明确核对后修正');
    expect(screen.getByLabelText('修正理由', { exact: true })).toHaveAccessibleName('修正理由');
  });
  it('keeps the match status filter name exact when an option is selected', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([]));
    render(
      <MemoryRouter>
        <ScoringIndexPage context={context(fetcher)} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const filter = screen.getByRole('combobox', { name: '筛选比赛状态' });
    expect(filter).toHaveAttribute('aria-label', '筛选比赛状态');
    fireEvent.change(filter, { target: { value: 'LIVE' } });
    expect(screen.getByLabelText('筛选比赛状态', { exact: true })).toHaveAccessibleName(
      '筛选比赛状态',
    );
    expect(filter).toHaveValue('LIVE');
  });
  it('match-only assignments offer their workbench without an unauthorized event-level link', async () => {
    const match = {
      matchId: 'match-a',
      eventId: 'event-a',
      eventName: '仅场次授权赛事',
      homeTeamName: '甲队',
      awayTeamName: '乙队',
      courtName: '球场',
      startsAt: snapshot.serverTime,
      status: 'LIVE',
      version: 3,
      score: { home: 0, away: 0 },
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response([match]));
    render(
      <MemoryRouter>
        <ScoringIndexPage context={context(fetcher)} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: '进入记分工作台' })).toHaveAttribute(
      'href',
      '/matches/match-a/scoring',
    );
    expect(screen.queryByRole('link', { name: '查看赛事记分规则' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.every(([path]) => String(path).includes('/scoring-matches?'))).toBe(
      true,
    );
  });
  it('replacement initializes away statistics and resynchronizes when target or mode changes', async () => {
    const base = {
      seq: 1,
      type: 'STAT_RECORDED',
      actorId: 'user-a',
      commandId: 'command-a',
      capturedAt: snapshot.serverTime,
      serverTime: snapshot.serverTime,
      targetEventId: null,
    };
    const events: ScoringEventData[] = [
      { ...base, id: 'away-score', payload: { kind: 'SCORE', side: 'AWAY', value: 3, period: 1 } },
      {
        ...base,
        id: 'home-foul',
        seq: 2,
        payload: { kind: 'FOUL', side: 'HOME', value: 1, period: 1 },
      },
    ];
    const submit = vi.fn().mockResolvedValue(false);
    render(
      <CorrectionDialog
        snapshot={snapshot}
        events={events}
        busy={false}
        onSubmit={submit}
        onClose={vi.fn()}
      />,
    );
    change('修正方式', 'REPLACE_STAT');
    change('原始统计记录', 'away-score');
    expect(screen.getByLabelText('所属球队', { exact: true })).toHaveValue('AWAY');
    expect(screen.getByLabelText('统计数值')).toHaveValue(3);
    expect(screen.getByText('原统计项目：得分')).toBeVisible();
    change('修正理由', '复核原始客队记录');
    fireEvent.click(screen.getByRole('button', { name: '提交修正' }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        type: 'REPLACE_STAT',
        payload: {
          targetEventId: 'away-score',
          side: 'AWAY',
          value: 3,
          reason: '复核原始客队记录',
        },
      }),
    );
    change('所属球队', 'HOME');
    fireEvent.click(screen.getByRole('button', { name: '提交修正' }));
    await waitFor(() =>
      expect(submit).toHaveBeenLastCalledWith({
        type: 'REPLACE_STAT',
        payload: {
          targetEventId: 'away-score',
          side: 'HOME',
          value: 3,
          reason: '复核原始客队记录',
        },
      }),
    );
    change('原始统计记录', 'home-foul');
    expect(screen.getByLabelText('所属球队')).toHaveValue('HOME');
    expect(screen.getByLabelText('统计数值')).toHaveValue(1);
    expect(screen.getByText('原统计项目：犯规')).toBeVisible();
    change('所属球队', 'AWAY');
    change('统计数值', '2');
    change('修正方式', 'VOID_STAT');
    change('修正方式', 'REPLACE_STAT');
    expect(screen.getByLabelText('所属球队')).toHaveValue('HOME');
    expect(screen.getByLabelText('统计数值')).toHaveValue(1);
    change('原始统计记录', 'away-score');
    expect(screen.getByLabelText('所属球队')).toHaveValue('AWAY');
    expect(screen.getByLabelText('统计数值')).toHaveValue(3);
  });
  it('requires explicit rules and sends event CAS, never hidden basketball defaults', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<RulesForm data={eventScoring} busy={false} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: '保存记分规则' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('常规节数');
    change('常规节数', '1');
    change('每节时长（秒）', '60');
    fireEvent.click(screen.getByLabelText('允许2分'));
    change('平局处理', 'OVERTIME');
    fireEvent.click(screen.getByRole('button', { name: '保存记分规则' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('加时时长');
    change('加时时长（秒）', '30');
    fireEvent.click(screen.getByRole('button', { name: '保存记分规则' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        expectedEventVersion: 7,
        regulationPeriods: 1,
        periodDurationSeconds: 60,
        allowedScoreValues: [2],
        tiePolicy: 'OVERTIME',
        overtimeDurationSeconds: 30,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '取消规则修改' }));
    expect(screen.getByLabelText('常规节数')).toHaveValue(null);
  });
  it('locked rules and staff capabilities are read only; a stale role does not grant controls', () => {
    render(
      <>
        <RulesForm
          data={{ ...eventScoring, rules: snapshot.rules, locked: true }}
          busy={false}
          onSave={vi.fn()}
        />
        <StaffPanel data={workbench} busy={false} onSave={vi.fn()} />
      </>,
    );
    expect(screen.queryByRole('button', { name: '保存记分规则' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存场次人员' })).not.toBeInTheDocument();
    expect(screen.getByText('记分规则已锁定')).toBeVisible();
  });
  it('pins reviewed result version and disables confirmation after a newer poll', async () => {
    let current: ScoringWorkbenchData = {
      ...workbench,
      match: { ...workbench.match, status: 'PENDING_CONFIRMATION', version: 5 },
      snapshot: {
        ...snapshot,
        status: 'PENDING_CONFIRMATION',
        version: 5,
        clock: { ...snapshot.clock, remainingMs: 0 },
      },
      capabilities: {
        ...workbench.capabilities,
        canAcquireControl: false,
        canRecord: false,
        canCorrect: false,
        canConfirm: true,
      },
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (init?.method === 'POST') throw new Error('must not submit');
      return response(
        String(path).includes('/scoring-events') || String(path).includes('/result-confirmations')
          ? []
          : current,
      );
    });
    vi.useFakeTimers();
    render(
      <MemoryRouter>
        <MatchWorkbench
          matchId="match-a"
          context={context(fetcher) as RegistrationWorkspace & { organizationId: string }}
        />
      </MemoryRouter>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole('button', { name: '确认当前赛果' }));
    const dialog = screen.getByRole('dialog', { name: '确认当前赛果' });
    expect(within(dialog).getByText(/资料版本 5/)).toBeVisible();
    current = {
      ...current,
      match: { ...current.match, version: 6 },
      snapshot: {
        ...current.snapshot!,
        version: 6,
        totals: { ...snapshot.totals, home: { ...snapshot.totals.home, score: 2 } },
      },
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(within(dialog).getByRole('button', { name: '正式确认赛果' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('待确认赛果版本已变化');
    expect(within(dialog).getByText(/资料版本 5/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: '正式确认赛果' }));
    expect(fetcher.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
  });
  it('overtime tie correction remains pending and cannot be confirmed or returned to LIVE', async () => {
    const current = {
      ...workbench,
      match: { ...workbench.match, status: 'PENDING_CONFIRMATION' },
      snapshot: {
        ...snapshot,
        status: 'PENDING_CONFIRMATION',
        rules: { ...snapshot.rules, tiePolicy: 'OVERTIME', overtimeDurationSeconds: 60 },
      },
      capabilities: {
        ...workbench.capabilities,
        canAcquireControl: false,
        canRecord: false,
        canCorrect: false,
        canConfirm: true,
      },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        response(
          String(path).includes('/scoring-events') || String(path).includes('/result-confirmations')
            ? []
            : current,
        ),
      );
    render(
      <MemoryRouter>
        <MatchWorkbench
          context={context(fetcher) as RegistrationWorkspace & { organizationId: string }}
          matchId="match-a"
        />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: '确认当前赛果' })).toBeDisabled();
    expect(screen.getByText(/加时规则下，修正后平局不能确认/)).toBeVisible();
    expect(screen.queryByRole('button', { name: '开始比赛' })).not.toBeInTheDocument();
  });
  it('team context does not issue any private scoring request', () => {
    const fetcher = vi.fn<typeof fetch>();
    render(
      <MemoryRouter>
        <ScoringIndexPage
          context={{
            ...context(fetcher),
            organizationId: undefined,
            teamContext: {
              orgId: 'org-a',
              organizationName: '机构',
              teamId: 'team-a',
              teamName: '球队',
            },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '请切换到机构工作台' })).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('a late read from the previous organization cannot replace the new context', async () => {
    const old = deferred<Response>();
    const next = {
      ...workbench,
      match: { ...workbench.match, home: { ...workbench.match.home, teamName: '乙机构主队' } },
      snapshot: { ...snapshot, home: { ...snapshot.home, teamName: '乙机构主队' } },
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (
        String(path).includes('/scoring-events') ||
        String(path).includes('/result-confirmations')
      )
        return response([]);
      return String(path).includes('/org-a/') ? old.promise : response(next);
    });
    const first = context(fetcher),
      second = { ...first, organizationId: 'org-b' };
    const page = (value: RegistrationWorkspace) => (
      <MemoryRouter initialEntries={['/matches/match-a/scoring']}>
        <Routes>
          <Route
            path="/matches/:matchId/scoring"
            element={<ScoringWorkbenchPage context={value} />}
          />
        </Routes>
      </MemoryRouter>
    );
    const view = render(page(first));
    view.rerender(page(second));
    expect(
      await screen.findByRole('heading', { level: 1, name: '乙机构主队 vs 合成乙队' }),
    ).toBeVisible();
    await act(async () => {
      old.resolve(response(workbench));
    });
    expect(screen.getByRole('heading', { level: 1, name: '乙机构主队 vs 合成乙队' })).toBeVisible();
    expect(fetcher.mock.calls.every(([path]) => !String(path).includes('/orgs//'))).toBe(true);
  });
  it('an API failure is explicit and never substitutes demonstration matches', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ code: 'INTERNAL_ERROR', message: '记分服务暂时不可用' }, {}, 503),
      );
    render(
      <MemoryRouter>
        <ScoringIndexPage context={context(fetcher)} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('记分服务暂时不可用');
    expect(screen.queryByText('合成甲队')).not.toBeInTheDocument();
    expect(
      fetcher.mock.calls.every(([path]) =>
        String(path).startsWith('/v1/orgs/org-a/scoring-matches'),
      ),
    ).toBe(true);
  });
  it('corrections require reason and only offer active original statistics', () => {
    const base = {
      seq: 1,
      type: 'STAT_RECORDED',
      payload: { period: 1, kind: 'SCORE', side: 'HOME', value: 2 },
      actorId: 'user',
      commandId: 'cmd',
      capturedAt: '2026-10-22T08:00:00Z',
      serverTime: '2026-10-22T08:00:00Z',
      targetEventId: null,
    };
    const events: ScoringEventData[] = [
      { ...base, id: 'old' },
      { ...base, id: 'active', seq: 3 },
      {
        ...base,
        id: 'void',
        seq: 4,
        type: 'STAT_VOIDED',
        targetEventId: 'old',
        payload: { reason: '记录撤销' },
      },
    ];
    const submit = vi.fn();
    render(
      <CorrectionDialog
        snapshot={snapshot}
        events={events}
        busy={false}
        onClose={vi.fn()}
        onSubmit={submit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '提交修正' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('修正理由');
    change('修正方式', 'VOID_STAT');
    expect(screen.getByLabelText('原始统计记录').querySelectorAll('option')).toHaveLength(2);
    expect(screen.getByLabelText('原始统计记录').querySelector('option[value="old"]')).toBeNull();
  });
});
