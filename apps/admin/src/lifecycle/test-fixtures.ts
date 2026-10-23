import type { EventLifecycleData } from '@small-city-basketball/contracts';
import { overview } from '../viewing/test-fixtures';
export const lifecycle: EventLifecycleData = {
  event: { ...overview.event, status: 'RUNNING' },
  completion: {
    totalMatchCount: 1,
    confirmedMatchCount: 1,
    ready: true,
    blockers: [],
    sourceHash: 'confirmed-source',
  },
  capabilities: { canComplete: true, canArchive: false, canReopen: false },
};
