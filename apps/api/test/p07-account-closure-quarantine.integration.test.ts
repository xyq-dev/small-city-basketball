import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { createApi } from '../src/app.js';
import { AccountClosureService } from '../src/account-closure-service.js';
import { SCB_ACCOUNT_CLOSURE } from '../src/account-closure-controller.js';
import type { InsuranceService } from '../src/insurance-service.js';
import { SCB_INSURANCE_SERVICE } from '../src/insurance-controller.js';
import type { InsuranceProvider } from '../src/insurance-provider.js';
import type { NotificationService } from '../src/notification-service.js';
import { SCB_NOTIFICATIONS } from '../src/notification-controller.js';
import type { AccountRecoveryService } from '../src/account-recovery-service.js';
import { SCB_ACCOUNT_RECOVERY } from '../src/account-recovery-controller.js';
import type { TradeService } from '../src/trade-service.js';
import { SCB_TRADE_SERVICE } from '../src/trade-controller.js';
import { hashPassword } from '../src/security.js';
import { quarantineRestoredDatabase } from '../../../ops/recovery/quarantine.mjs';
import { createOwnedRestoreDatabase } from './p07-support.js';
import { ORIGIN, PASSWORD, call, data, login } from './support.js';
import type { Api, User } from './support.js';

test('E07 owned restore expires the original closure authorization and restarts with all external configuration ignored', async () => {
  const target = await createOwnedRestoreDatabase();
  let before: Api | undefined, after: Api | undefined;
  const forbidden = vi.fn(async (): Promise<never> => {
    throw new Error('External execution forbidden in a restored database');
  });
  try {
    before = await createApi({
      databaseUrl: target.databaseUrl,
      appOrigin: ORIGIN,
      accountClosure: { autoDispatch: false },
    });
    const u: User = {
      id: randomUUID(),
      orgId: '',
      email: `e07-restore-${randomUUID()}@example.test`,
      cookie: '',
    };
    await before.pool.query(
      'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
      [u.id, u.email, '合成恢复隔离主体', await hashPassword(PASSWORD)],
    );
    u.cookie = await login(before, u);
    const request = data<{ id: string }>(
      await call(before, 'post', '/v1/account-closure/requests', {
        cookie: u.cookie,
        body: { clientRequestId: randomUUID(), password: PASSWORD, coolingOffDays: 7 },
      }),
    );
    const receipts = (
      await before.pool.query('SELECT * FROM account_closure_operations WHERE actor_id=$1', [u.id])
    ).rows;
    await before.app.close();
    await before.pool.end();
    before = undefined;
    const result = await quarantineRestoredDatabase(target);
    expect(result.status).toBe('quarantined');
    expect(
      (
        await target.pool.query(
          'SELECT status,lease_id FROM account_closure_requests WHERE id=$1',
          [request.id],
        )
      ).rows[0],
    ).toEqual({ status: 'EXPIRED_AUTH', lease_id: null });
    expect(
      (
        await target.pool.query('SELECT * FROM account_closure_operations WHERE actor_id=$1', [
          u.id,
        ])
      ).rows,
    ).toEqual(receipts);
    expect(
      (await target.pool.query('SELECT * FROM account_closure_tombstones WHERE user_id=$1', [u.id]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await target.pool.query(
          "SELECT count(*)::int AS n FROM audit_logs WHERE action='RESTORE_QUARANTINE' AND resource_type='restore'",
        )
      ).rows[0].n,
    ).toBe(1);
    const provider: InsuranceProvider = {
      id: 'synthetic-must-not-run',
      allowedOrigins: ['https://synthetic.invalid'],
      catalog: forbidden,
      quote: forbidden,
      apply: forbidden,
      query: forbidden,
      cancel: forbidden,
    };
    // Deliberately active caller configuration is replaced before provider constructors
    // validate it. This is a real restart, not a mocked marker or service capability.
    after = await createApi({
      databaseUrl: target.databaseUrl,
      appOrigin: ORIGIN,
      wechat: {
        configuration: {
          enabled: true,
          appId: 'wx1234567890abcdef',
          appSecret: 'synthetic-restored-secret',
        },
        exchange: { exchange: forbidden },
      },
      accountClosure: { enabled: true, autoDispatch: true },
      accountRecovery: {
        provider: { send: forbidden },
        encryptionKey: Buffer.alloc(32, 22).toString('base64'),
        autoDispatch: true,
      },
      insurance: { provider, autoDispatch: true },
      notifications: {
        provider: { send: forbidden },
        exchange: { exchange: forbidden },
        autoDispatch: true,
      },
      trade: { encryptionKey: Buffer.alloc(32, 44) },
      streaming: { autoDispatch: true },
    });
    expect(after.app.get<AccountClosureService>(SCB_ACCOUNT_CLOSURE).capabilities().enabled).toBe(
      false,
    );
    expect(after.app.get<InsuranceService>(SCB_INSURANCE_SERVICE).capabilities().enabled).toBe(
      false,
    );
    expect(after.app.get<NotificationService>(SCB_NOTIFICATIONS).capabilities().wechatEnabled).toBe(
      false,
    );
    expect(
      after.app.get<AccountRecoveryService>(SCB_ACCOUNT_RECOVERY).capabilities().canResetPassword,
    ).toBe(false);
    expect(after.app.get<TradeService>(SCB_TRADE_SERVICE).runtime.encryptionKey).toBeUndefined();
    expect(
      data<{ enabled: boolean }>(await call(after, 'get', '/v1/auth/wechat/capabilities')).enabled,
    ).toBe(false);
    expect(await after.app.get<AccountClosureService>(SCB_ACCOUNT_CLOSURE).drain()).toEqual({
      attempted: 0,
      closed: 0,
    });
    expect(forbidden).not.toHaveBeenCalled();
  } finally {
    if (before) {
      await before.app.close();
      await before.pool.end();
    }
    if (after) {
      await after.app.close();
      await after.pool.end();
    }
    await target.close();
  }
}, 120000);
