// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventScoringData } from '@small-city-basketball/contracts';
import { RulesForm } from './Management';
import { eventScoring, rules } from './test-fixtures';

afterEach(cleanup);
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const grouped: EventScoringData = {
  ...eventScoring,
  event: { ...eventScoring.event, format: 'GROUP_KNOCKOUT' },
};

describe('group competition scoring rules', () => {
  it('preselects and locks overtime for both stages and requires an explicit overtime duration before saving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RulesForm data={grouped} busy={false} onSave={onSave} />);
    expect(screen.getByLabelText('平局处理', { exact: true })).toHaveValue('OVERTIME');
    expect(screen.getByLabelText('平局处理', { exact: true })).toBeDisabled();
    expect(screen.queryByRole('option', { name: '允许平局' })).not.toBeInTheDocument();
    expect(screen.getByText(/组内赛和淘汰赛均必须分出胜负/)).toBeVisible();
    change('常规节数', '1');
    change('每节时长（秒）', '60');
    fireEvent.click(screen.getByLabelText('允许2分'));
    fireEvent.click(screen.getByRole('button', { name: '保存记分规则' }));
    expect(screen.getByRole('alert')).toHaveTextContent('加时时长');
    expect(onSave).not.toHaveBeenCalled();
    change('加时时长（秒）', '90');
    fireEvent.click(screen.getByRole('button', { name: '保存记分规则' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        expectedEventVersion: grouped.event.version,
        regulationPeriods: 1,
        periodDurationSeconds: 60,
        allowedScoreValues: [2],
        tiePolicy: 'OVERTIME',
        overtimeDurationSeconds: 90,
      }),
    );
  });
  it('restores saved group overtime rules on cancellation and keeps the mandatory tie policy fixed', async () => {
    const saved: EventScoringData = {
      ...grouped,
      rules: { ...rules, tiePolicy: 'OVERTIME', overtimeDurationSeconds: 120 },
    };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RulesForm data={saved} busy={false} onSave={onSave} />);
    expect(screen.getByLabelText('加时时长（秒）', { exact: true })).toHaveValue(120);
    change('加时时长（秒）', '300');
    fireEvent.click(screen.getByRole('button', { name: '取消规则修改' }));
    expect(screen.getByLabelText('加时时长（秒）', { exact: true })).toHaveValue(120);
    expect(screen.getByLabelText('平局处理', { exact: true })).toHaveValue('OVERTIME');
    expect(screen.getByLabelText('平局处理', { exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存记分规则' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ tiePolicy: 'OVERTIME', overtimeDurationSeconds: 120 }),
      ),
    );
  });
  it('does not offer a stale saved draw policy as a valid group choice', () => {
    render(<RulesForm data={{ ...grouped, rules }} busy={false} onSave={vi.fn()} />);
    expect(screen.getByLabelText('平局处理', { exact: true })).toHaveValue('OVERTIME');
    expect(screen.queryByRole('option', { name: '允许平局' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('加时时长（秒）', { exact: true })).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: '取消规则修改' }));
    expect(screen.getByLabelText('平局处理', { exact: true })).toHaveValue('OVERTIME');
  });
  it('retains editable draw handling and a null overtime duration for round-robin events', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RulesForm data={{ ...eventScoring, rules }} busy={false} onSave={onSave} />);
    expect(screen.getByLabelText('平局处理', { exact: true })).toHaveValue('ALLOW_DRAW');
    expect(screen.getByLabelText('平局处理', { exact: true })).toBeEnabled();
    expect(screen.getByRole('option', { name: '允许平局' })).toBeInTheDocument();
    expect(screen.queryByText(/组内赛和淘汰赛均必须分出胜负/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存记分规则' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ tiePolicy: 'ALLOW_DRAW', overtimeDurationSeconds: null }),
      ),
    );
  });
});
