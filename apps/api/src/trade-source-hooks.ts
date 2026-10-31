import type { TradeService } from './trade-service.js';
import type { PoolClient } from 'pg';
/** Only source capture and gates run in the caller's business transaction. */
export type SourceTradeHooks = Pick<
  TradeService,
  'captureSourceCharge' | 'assertSourceFinancialGate'
>;
/** All source writers take the same org -> calendar order before team/source rows. */
export async function lockTradeSourceCalendar(c: PoolClient, orgId: string) {
  await c.query('INSERT INTO org_schedule_mutex(org_id) VALUES($1) ON CONFLICT DO NOTHING', [
    orgId,
  ]);
  await c.query('SELECT org_id FROM org_schedule_mutex WHERE org_id=$1 FOR UPDATE', [orgId]);
  await c.query('SELECT x12_calendar_lock()');
}
