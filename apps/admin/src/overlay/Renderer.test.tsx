// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayPreview, OverlayRenderer } from './Renderer';
import type { OverlayPresentation } from './Renderer';

const match: OverlayPresentation = {
  eventName: '城市篮球邀请赛',
  homeName: '青峰篮球队',
  awayName: '北城篮球队',
  status: 'LIVE',
  resultStatus: 'UNCONFIRMED',
  score: { home: 28, away: 31 },
  period: 2,
  clockLabel: '05:42',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('limited overlay renderer', () => {
  it('shows supplied scores and clock, and removes all names and scores when cleared', () => {
    const { rerender } = render(<OverlayRenderer data={match} />);
    expect(screen.getByRole('heading', { name: match.homeName })).toBeVisible();
    expect(screen.getByLabelText('包装主队比分')).toHaveTextContent('28');
    expect(screen.getByLabelText('包装客队比分')).toHaveTextContent('31');
    expect(screen.getByLabelText('包装剩余时间')).toHaveTextContent('05:42');
    expect(screen.getByText('第 2 节')).toBeVisible();
    rerender(<OverlayRenderer data={null} message="包装链接已到期" />);
    expect(screen.getByRole('status')).toHaveTextContent('包装链接已到期');
    expect(screen.queryByText(match.eventName)).not.toBeInTheDocument();
    expect(screen.queryByText(match.homeName)).not.toBeInTheDocument();
    expect(screen.queryByText(match.awayName)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('包装主队比分')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('包装剩余时间')).not.toBeInTheDocument();
  });

  it('keeps unprepared values unknown instead of inventing zero scores or a clock', () => {
    render(
      <OverlayRenderer
        data={{ ...match, status: 'SCHEDULED', score: null, period: null, clockLabel: null }}
      />,
    );
    expect(screen.getByLabelText('包装主队比分')).toHaveTextContent('—');
    expect(screen.getByLabelText('包装客队比分')).toHaveTextContent('—');
    expect(screen.getByLabelText('包装剩余时间')).toHaveTextContent('—:—');
    expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('等待比赛准备')).toBeVisible();
  });

  it('labels stale data explicitly and renders the same canvas at a uniform preview scale', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 960,
      height: 540,
      top: 0,
      left: 0,
      right: 960,
      bottom: 540,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const { container } = render(<OverlayPreview data={match} stale />);
    expect(container.querySelector('.overlay-preview')).toHaveStyle('--overlay-scale: 0.5');
    expect(container.querySelectorAll('[data-overlay-canvas]')).toHaveLength(1);
    expect(screen.getByText('数据陈旧 · 等待同步')).toBeVisible();
    expect(screen.getByLabelText('包装主队比分')).toHaveTextContent('28');
  });

  it('preserves full legal long names while selecting a smaller presentation size', () => {
    const homeName = '青'.repeat(80),
      awayName = 'A'.repeat(80);
    render(<OverlayRenderer data={{ ...match, homeName, awayName }} />);
    expect(screen.getByRole('heading', { name: homeName })).toHaveStyle('font-size: 22px');
    expect(screen.getByRole('heading', { name: awayName })).toHaveStyle('font-size: 28px');
  });
});
