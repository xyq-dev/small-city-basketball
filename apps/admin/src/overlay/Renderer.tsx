import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/** Presentation-only values: callers project the limited API response explicitly. */
export interface OverlayPresentation {
  eventName: string;
  homeName: string;
  awayName: string;
  status: string;
  resultStatus: string;
  score: { home: number; away: number } | null;
  period: number | null;
  clockLabel: string | null;
}

export interface OverlayRendererProps {
  data: OverlayPresentation | null;
  message?: string;
  stale?: boolean;
}

function nameSize(name: string) {
  const width = Array.from(name).reduce(
    (sum, letter) => sum + (/[^\x00-\x7f]/.test(letter) ? 2 : 1),
    0,
  );
  return width > 100 ? 22 : width > 64 ? 28 : width > 40 ? 34 : 42;
}

function scoreSize(score: number | undefined) {
  return score === undefined ? 76 : Math.max(18, Math.min(92, 182 / String(score).length));
}

function statusLabel(data: OverlayPresentation) {
  if (data.resultStatus === 'CONFIRMED') return '赛果已确认';
  if (data.resultStatus === 'REQUIRES_RECONFIRMATION') return '赛果待重新确认';
  if (data.status === 'LIVE') return '比赛进行中';
  if (data.status === 'PENDING_CONFIRMATION') return '待确认赛果';
  if (data.status === 'READY') return '待开赛';
  if (data.status === 'CANCELLED') return '比赛已取消';
  return '尚未准备';
}

function BallMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className="overlay-ball-mark">
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M3 16h26M16 3v26M7 6c12 7 12 13 0 20M25 6c-12 7-12 13 0 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** A fixed 1920×1080 design canvas. No score, clock or team is fabricated. */
export function OverlayRenderer({ data, message, stale = false }: OverlayRendererProps) {
  if (!data)
    return (
      <section className="overlay-canvas" aria-label="比赛比分包装" data-overlay-canvas>
        <div className="overlay-empty-card" role="status">
          <BallMark />
          <span>{message || '正在读取比赛画面…'}</span>
        </div>
      </section>
    );

  const status = statusLabel(data);
  return (
    <section className="overlay-canvas" aria-label="比赛比分包装" data-overlay-canvas>
      <div className="overlay-lower-third">
        <div className="overlay-ribbon">
          <div className="overlay-event-ribbon">
            <BallMark />
            <span className="overlay-event-name">{data.eventName}</span>
          </div>
          <span className={`overlay-result-label${stale ? ' overlay-result-stale' : ''}`}>
            <i aria-hidden="true" />
            {stale ? '数据陈旧 · 等待同步' : status}
          </span>
        </div>
        <div className="overlay-scorebar">
          <div className="overlay-team overlay-team-home">
            <span className="overlay-team-label">主队</span>
            <h2 className="overlay-team-name" style={{ fontSize: nameSize(data.homeName) }}>
              {data.homeName}
            </h2>
          </div>
          <div className="overlay-score overlay-score-home" aria-label="包装主队比分">
            <span style={{ fontSize: scoreSize(data.score?.home) }}>{data.score?.home ?? '—'}</span>
          </div>
          <div className="overlay-clock-block">
            <span className="overlay-period">
              {data.score === null
                ? '尚未准备'
                : data.period === null
                  ? '节次未统计'
                  : `第 ${data.period} 节`}
            </span>
            <strong className="overlay-clock" aria-label="包装剩余时间">
              {data.clockLabel ?? '—:—'}
            </strong>
            <span className="overlay-clock-caption">
              {data.score === null ? '等待比赛准备' : '比赛时间'}
            </span>
          </div>
          <div className="overlay-score overlay-score-away" aria-label="包装客队比分">
            <span style={{ fontSize: scoreSize(data.score?.away) }}>{data.score?.away ?? '—'}</span>
          </div>
          <div className="overlay-team overlay-team-away">
            <span className="overlay-team-label">客队</span>
            <h2 className="overlay-team-name" style={{ fontSize: nameSize(data.awayName) }}>
              {data.awayName}
            </h2>
          </div>
        </div>
        {stale && (
          <span className="overlay-stale-note">
            {message || '画面可能滞后，请以现场记录台为准'}
          </span>
        )}
      </div>
    </section>
  );
}

/** Management and source both display the same design at a uniform scale. */
export function OverlayPreview({
  className = '',
  ...props
}: OverlayRendererProps & { className?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setScale(width / 1920);
    };
    resize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', resize);
      return () => window.removeEventListener('resize', resize);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={viewport}
      className={`overlay-preview ${className}`.trim()}
      style={{ '--overlay-scale': scale } as CSSProperties}
    >
      <OverlayRenderer {...props} />
    </div>
  );
}
