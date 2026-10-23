import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

/** A new non-login audit identity, created in the caller's financial transaction. */
export async function createCommerceSystemActor(
  client: PoolClient,
  kind: 'PLATFORM_MAINTENANCE' | 'LEDGER',
): Promise<string> {
  const id = randomUUID();
  // Deliberately incompatible with verifyPassword and disabled independently.
  // Never reuse a human account, or let this identity acquire a platform role.
  const sentinel = `!SCB_DISABLED_COMMERCE_ACTOR!${randomBytes(64).toString('base64url')}`;
  await client.query(
    `INSERT INTO users(id,email,display_name,password_hash,status)
     VALUES($1,$2,$3,$4,'DISABLED')`,
    [
      id,
      `commerce-system-${id}@system.invalid`,
      kind === 'PLATFORM_MAINTENANCE' ? '离线平台权限维护系统主体' : '商业账本系统主体',
      sentinel,
    ],
  );
  return id;
}
