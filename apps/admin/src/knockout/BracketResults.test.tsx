// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { EventKnockoutData, PublicKnockoutData } from '@small-city-basketball/contracts';
import fixtures from '../api/test-fixtures/result-domain.json';
import { Bracket, PublicBracket } from './Bracket';
afterEach(cleanup);
describe('bronze and adjudicated bracket labels', () => {
  it('shows private administrative advancement and separate first/third placements without false confirmations', () => {
    const data = fixtures.knockoutComplete as unknown as EventKnockoutData;
    render(
      <MemoryRouter>
        <Bracket bracket={data.bracket!} participants={data.participants} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('弃权裁定')).toHaveLength(4);
    expect(screen.getByText('裁定冠军：')).toBeVisible();
    expect(screen.getByText('裁定季军：')).toBeVisible();
    expect(screen.getByText('第3名')).toBeVisible();
    expect(screen.getByText('第4名')).toBeVisible();
    expect(screen.queryByText('独立确认晋级：')).not.toBeInTheDocument();
    expect(screen.getByLabelText('淘汰赛最终名次')).toHaveTextContent('半决赛负者争夺第三名');
    expect(screen.getByLabelText('淘汰赛最终名次')).not.toHaveTextContent('不设三四名赛');
  });
  it('shows public bronze semantics, hides cancelled winner and never fabricates a score', () => {
    const data = structuredClone(fixtures.publicKnockout) as unknown as PublicKnockoutData;
    const slot = data.rounds[0]!.slots[0]!;
    slot.adjudication = { kind: 'CANCELLED' };
    slot.winner = null;
    render(
      <MemoryRouter>
        <PublicBracket data={data} />
      </MemoryRouter>,
    );
    expect(screen.getByText('本场取消')).toBeVisible();
    expect(screen.getByText(/取消场次不产生晋级者/)).toBeVisible();
    expect(screen.getByText('季军赛')).toBeVisible();
    expect(screen.queryByText(/20\s*[:：]\s*0/)).not.toBeInTheDocument();
    expect(screen.getAllByText('裁定晋级：')).toHaveLength(1);
  });
  it('labels unfilled bronze contestants as semifinal losers on both surfaces', () => {
    const data = structuredClone(fixtures.knockout) as unknown as EventKnockoutData;
    const slot = data.bracket!.rounds[1]!.slots[1]!;
    slot.homeEntryId = null;
    slot.awayEntryId = null;
    const { unmount } = render(
      <MemoryRouter>
        <Bracket bracket={data.bracket!} participants={data.participants} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/R1-P[12] 负者待定/)).toHaveLength(2);
    unmount();
    const pub = structuredClone(fixtures.publicKnockout) as unknown as PublicKnockoutData;
    pub.rounds[1]!.slots[1]!.home = null;
    pub.rounds[1]!.slots[1]!.away = null;
    render(
      <MemoryRouter>
        <PublicBracket data={pub} />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('半决赛负者待定')).toHaveLength(2);
  });
});
