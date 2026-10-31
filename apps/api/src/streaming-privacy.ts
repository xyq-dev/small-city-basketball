import type { PoolClient } from 'pg';
import { ApiError } from './errors.js';
import { resourceId } from './validation.js';
const conflict = () =>
  new ApiError(409, 'STREAMING_PRIVACY_BUSY', '直播或媒体状态正变化，请稍后重新核对注销条件');
/** Same transaction as account closure. No network, credentials, process killing, or table deletes. */
export async function readStreamingClosureBlockers(c: PoolClient, userId: string) {
  resourceId(userId);
  if (
    !(
      await c.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtext('e01-privacy'),hashtext($1)) AS ok",
        [userId],
      )
    ).rows[0]?.ok
  )
    throw conflict();
  try {
    const sessions = (
      await c.query<{ id: string; blocked: boolean }>(
        `SELECT s.id,(NOT s.source_stopped OR EXISTS(SELECT 1 FROM live_relays r WHERE r.session_id=s.id AND r.slot_held)) AS blocked FROM broadcast_sessions s WHERE ($1 IN(s.created_by,s.source_owner_id,s.approved_by,s.recording_approved_by) OR EXISTS(SELECT 1 FROM live_relays lr JOIN live_channel_accounts ch ON ch.id=lr.channel_id WHERE lr.session_id=s.id AND ch.created_by=$1)) ORDER BY s.id FOR UPDATE NOWAIT`,
        [userId],
      )
    ).rows;
    const jobs = (
      await c.query<{ id: string }>(
        "SELECT id FROM live_media_jobs WHERE created_by=$1 AND (status IN('QUEUED','RUNNING') OR error_code='WORKER_RESULT_UNKNOWN') ORDER BY id FOR UPDATE NOWAIT",
        [userId],
      )
    ).rows;
    return [
      ...(sessions.some((s) => s.blocked)
        ? [
            {
              code: 'STREAMING_STOP_UNCONFIRMED',
              message:
                '请先停止本人负责或批准的直播，等待云入口和全部频道确认停流；未知结果仍保留占用。',
            },
          ]
        : []),
      ...(jobs.length
        ? [
            {
              code: 'MEDIA_JOBS_PENDING',
              message: '请先取消或等待本人创建的录像与媒体作业处理结束。',
            },
          ]
        : []),
    ];
  } catch (e) {
    if ((e as { code?: string }).code === '55P03') throw conflict();
    throw e;
  }
}
export async function revokeStreamingPrivacy(c: PoolClient, userId: string) {
  if ((await readStreamingClosureBlockers(c, userId)).length)
    throw new ApiError(409, 'STREAMING_CLOSURE_BLOCKED', '直播停流或媒体作业尚未核对完成');
  try {
    await c.query(
      'SELECT id FROM live_media_artifacts WHERE published_by=$1 AND revoked_at IS NULL ORDER BY id FOR UPDATE NOWAIT',
      [userId],
    );
    await c.query(
      'SELECT id FROM live_channel_accounts WHERE created_by=$1 AND revoked_at IS NULL ORDER BY id FOR UPDATE NOWAIT',
      [userId],
    );
  } catch (e) {
    if ((e as { code?: string }).code === '55P03') throw conflict();
    throw e;
  }
  await c.query(
    `UPDATE broadcast_sessions s SET rights_revoked_at=COALESCE(rights_revoked_at,clock_timestamp()),desired='STOPPED',observed='ENDED',ended_at=COALESCE(ended_at,clock_timestamp()),source_token_hash=NULL,source_expires_at=NULL,epoch=epoch+1,version=version+1 WHERE $1 IN(s.created_by,s.source_owner_id,s.approved_by,s.recording_approved_by) AND s.rights_revoked_at IS NULL AND s.source_stopped AND NOT EXISTS(SELECT 1 FROM live_relays r WHERE r.session_id=s.id AND r.slot_held)`,
    [userId],
  );
  await c.query(
    'UPDATE live_media_artifacts SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE published_by=$1 AND revoked_at IS NULL',
    [userId],
  );
  await c.query(
    'UPDATE live_channel_accounts SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE created_by=$1 AND revoked_at IS NULL',
    [userId],
  );
}
