import { createHash } from 'node:crypto';
import type { ScoringCommandInput } from '@small-city-basketball/contracts';
import { parseScoringCommand } from './scoring-domain.js';
import { invalid, objectInput } from './validation.js';

export const OFFLINE_SCORING_TYPES = [
  'RECORD_STAT',
  'ADD_CORRECTION',
  'VOID_STAT',
  'REPLACE_STAT',
  'RECORD_SHOT',
  'RECORD_TECHNICAL',
  'VOID_PRO_STAT',
  'ADD_PRO_CORRECTION',
] as const;
export interface OfflineScoringIntent {
  intentId: string;
  queueId: string;
  ordinal: number;
  previousIntentId: string | null;
  command: Omit<ScoringCommandInput, 'control'>;
}
export function parseOfflineScoringIntent(raw: unknown): OfflineScoringIntent {
  const v = objectInput(raw, ['intentId', 'queueId', 'ordinal', 'previousIntentId', 'command']);
  const id = (value: unknown): string => {
    if (
      typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    )
      invalid('离线编号无效');
    return (value as string).toLowerCase();
  };
  const intentId = id(v.intentId);
  const queueId = id(v.queueId);
  if (!Number.isSafeInteger(v.ordinal) || Number(v.ordinal) < 1 || Number(v.ordinal) > 10000)
    invalid('离线队列顺序无效');
  const previousIntentId = v.previousIntentId === null ? null : id(v.previousIntentId);
  if ((v.ordinal === 1) !== (previousIntentId === null) || previousIntentId === intentId)
    invalid('离线队列前序无效');
  // The persisted logical operation deliberately never contains a lease or session credential.
  objectInput(v.command, ['commandId', 'type', 'payload', 'expectedVersion', 'capturedAt']);
  const command = parseScoringCommand({
    ...(v.command as object),
    // Existing command parsing requires a control for statistical writes. This placeholder
    // is used solely for schema validation, never for authorization or execution.
    control: { leaseId: intentId, clientInstanceId: queueId, fencingToken: '1' },
  });
  if (!(OFFLINE_SCORING_TYPES as readonly string[]).includes(command.type))
    invalid('时钟、阵容、节次与赛果确认只能在线操作');
  if (command.commandId !== intentId) invalid('离线逻辑编号与原命令编号须相同');
  const { control: _, ...logical } = command;
  return { intentId, queueId, ordinal: Number(v.ordinal), previousIntentId, command: logical };
}
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return (
    '{' +
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + stable(v))
      .join(',') +
    '}'
  );
}
export function offlineIntentHash(intent: OfflineScoringIntent) {
  return createHash('sha256').update(stable(intent)).digest('hex');
}
