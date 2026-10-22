import { useMemo } from 'react';
import { createOverlaySourceApi } from '../api/overlay';
import { clockLabel, clockRemaining } from '../scoring/clock';
import { OverlayPreview } from './Renderer';
import type { OverlayPresentation } from './Renderer';
import type { OverlayPreviewData } from '@small-city-basketball/contracts';
import { useOverlaySource } from './useOverlaySource';
export function presentation(
  data: OverlayPreviewData | null,
  elapsed = 0,
): OverlayPresentation | null {
  return data
    ? {
        eventName: data.eventName,
        homeName: data.home.teamName,
        awayName: data.away.teamName,
        status: data.status,
        resultStatus: data.resultStatus,
        score: data.score,
        period: data.clock?.period ?? null,
        clockLabel: data.clock
          ? clockLabel(clockRemaining(data.clock, data.serverTime, elapsed))
          : null,
      }
    : null;
}
export function OverlaySource({
  overlayId,
  token,
  fetcher,
}: {
  overlayId: string;
  token: string | null;
  fetcher?: typeof fetch;
}) {
  const api = useMemo(() => createOverlaySourceApi({ fetcher }), [fetcher]);
  const state = useOverlaySource(api, overlayId, token);
  return (
    <OverlayPreview
      className="overlay-source-viewport"
      data={presentation(state.data, state.now - state.receivedAt)}
      message={state.message}
      stale={state.stale}
    />
  );
}
