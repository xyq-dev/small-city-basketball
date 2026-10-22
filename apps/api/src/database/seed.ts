import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { hashPassword } from '../security.js';
import { passwordInput } from '../validation.js';

const ids = {
  user: '00000000-0000-4000-8000-000000000101',
  org: '00000000-0000-4000-8000-000000000102',
  event: '00000000-0000-4000-8000-000000000103',
};

/** Explicit opt-in synthetic fixtures; never clears data or resets existing passwords. */
export async function seedDev(pool: Pool, explicitPassword: string): Promise<typeof ids> {
  const password = passwordInput(explicitPassword);
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [7240202602]);
    await client.query(
      `INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'dev-owner@example.test','开发示例管理员',$2) ON CONFLICT(id) DO NOTHING`,
      [ids.user, passwordHash],
    );
    const existing = await client.query<{ email: string }>(
      'SELECT email FROM users WHERE id=$1 FOR SHARE',
      [ids.user],
    );
    if (existing.rows[0]?.email !== 'dev-owner@example.test')
      throw new Error('Development seed identifier is already in use');
    await client.query(
      "INSERT INTO organizations(id,name) VALUES($1,'城市体育（开发示例）') ON CONFLICT(id) DO NOTHING",
      [ids.org],
    );
    await client.query(
      "INSERT INTO organization_memberships(org_id,user_id,role) VALUES($1,$2,'ORG_OWNER') ON CONFLICT(org_id,user_id) DO NOTHING",
      [ids.org, ids.user],
    );
    await client.query(
      `INSERT INTO events(id,org_id,name,start_date,end_date,timezone,venue_name,format,created_by)
      VALUES($1,$2,'开发示例篮球邀请赛','2026-11-01','2026-11-08','Asia/Shanghai','开发示例球场','GROUP_KNOCKOUT',$3) ON CONFLICT(id) DO NOTHING`,
      [ids.event, ids.org, ids.user],
    );
    const event = await client.query<{ org_id: string }>('SELECT org_id FROM events WHERE id=$1', [
      ids.event,
    ]);
    if (event.rows[0]?.org_id !== ids.org)
      throw new Error('Development seed event identifier is already in use');
    await client.query(
      `INSERT INTO audit_logs(id,org_id,actor_id,action,resource_type,resource_id,metadata)
      SELECT $1,$2,$3,'DEV_SEED','organization',$2,'{}'::jsonb WHERE NOT EXISTS (SELECT 1 FROM audit_logs WHERE org_id=$2 AND action='DEV_SEED')`,
      [randomUUID(), ids.org, ids.user],
    );
    await client.query('COMMIT');
    return ids;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* Retain original error. */
    }
    throw error;
  } finally {
    client.release();
  }
}
