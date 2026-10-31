// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  PublicGroupKnockoutData,
  PublicStandingsData,
  StandingsData,
} from '@small-city-basketball/contracts';
import domain from '../api/test-fixtures/result-domain.json';
import { publicStandings } from './test-fixtures';
import { StandingsTable } from './StandingsTable';
import { PublicGroupTables } from '../groups/GroupTables';
afterEach(cleanup);
describe('standings administrative coverage', () => {
  it('keeps confirmed, administrative wins and cancellations distinct for a completed DRR table', () => {
    const data = domain.publicStandings as unknown as PublicStandingsData;
    render(<StandingsTable data={data} />);
    expect(screen.getByText('全部场次已处理')).toBeVisible();
    expect(screen.getByText(/已处理 2 \/ 2 场：0场有效确认、1场弃权裁定、1场取消/)).toBeVisible();
    expect(screen.queryByText('尚无已确认赛果')).not.toBeInTheDocument();
    expect(screen.queryByText('全部场次已确认')).not.toBeInTheDocument();
    expect(screen.getByText(/弃权不产生记录得失分/)).toBeVisible();
    expect(document.querySelectorAll('tbody td .view-rank')[0]).toHaveTextContent('1');
    for (const row of document.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td');
      expect([cells[5]?.textContent, cells[6]?.textContent]).toEqual(['0', '0']);
    }
  });
  it('preserves server tie rankings for cancelled-only groups without saying all fixtures were confirmed', () => {
    const group = domain.cancelledGroups.competition.groups[0]!;
    render(<StandingsTable data={group.standings as unknown as StandingsData} />);
    expect(screen.getByText('全部场次已处理')).toBeVisible();
    expect(screen.getByText('尚无计入积分的赛果')).toBeVisible();
    expect(screen.getByText('取消场次不产生胜负或积分，排名及晋级按赛事规则处理。')).toBeVisible();
    expect(
      Array.from(document.querySelectorAll('tbody .view-rank')).map((r) => r.textContent),
    ).toEqual(['1', '1']);
  });
  it('propagates each public group resolution count into its standings table', () => {
    render(<PublicGroupTables data={domain.publicGroups as unknown as PublicGroupKnockoutData} />);
    expect(screen.getAllByText(/已处理 1 \/ 1 场：0场有效确认、1场弃权裁定、0场取消/)).toHaveLength(
      2,
    );
    expect(screen.queryByText('尚无已确认赛果')).not.toBeInTheDocument();
  });
  it('retains the ordinary unconfirmed empty state and preview label when no administrative source exists', () => {
    render(<StandingsTable data={publicStandings} preview />);
    expect(screen.getByText('尚无已确认赛果')).toBeVisible();
    expect(screen.getByText('未正式发布')).toBeVisible();
    expect(screen.getByText(/已计入 0 \/ 1 场有效确认赛果/)).toBeVisible();
    expect(screen.queryByText(/弃权裁定/)).not.toBeInTheDocument();
  });
});
