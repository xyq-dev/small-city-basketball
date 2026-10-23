// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicViewingApp } from '../viewing/PublicPages';
import { publicEvent, publicMatch, response } from '../viewing/test-fixtures';
import { publicKnockoutFixture } from './test-fixtures';
import { scheduleCsv } from '../viewing/exports';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});
describe('anonymous knockout viewing', () => {
  it('renders bracket and pending final placings from the public projection without requesting round-robin standings', async () => {
    window.history.replaceState({}, '', '/watch/public-event-a');
    const event = {
      ...publicEvent,
      format: 'SINGLE_ELIMINATION' as const,
      rules: null,
      totalMatchCount: 2,
      confirmedMatchCount: 1,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (path) =>
        String(path).includes('/schedule?')
          ? response([publicMatch])
          : String(path).endsWith('/knockout')
            ? response(publicKnockoutFixture)
            : response(event),
      );
    render(<PublicViewingApp fetcher={fetcher} />);
    expect(await screen.findByRole('heading', { level: 1, name: publicEvent.name })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '晋级与名次' }));
    expect(screen.getByRole('region', { name: '公开淘汰赛签位' })).toHaveTextContent('轮空晋级');
    expect(screen.getByRole('region', { name: '公开最终名次' })).toHaveTextContent(
      '最终名次未产生',
    );
    expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/standings'))).toBe(false);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === 'omit')).toBe(true);
    expect(screen.queryByText('已发布排名规则')).not.toBeInTheDocument();
  });
  it('exports every current formal match while excluding byes and unmaterialized future rounds', () => {
    const event = {
      ...publicEvent,
      format: 'SINGLE_ELIMINATION' as const,
      rules: null,
      totalMatchCount: 2,
    };
    const output = scheduleCsv(event, [publicMatch], publicEvent.serverTime);
    expect(output.body).toContain(publicMatch.home.teamName);
    expect(output.body).not.toContain('undefined');
    expect(() =>
      scheduleCsv(
        { ...event, format: 'ROUND_ROBIN', rules: publicEvent.rules },
        [publicMatch],
        publicEvent.serverTime,
      ),
    ).toThrow('完整公开赛程');
  });
});
