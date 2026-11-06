import type { Pool } from 'pg';
import { ApplicationService } from './service.js';
import type { ApiOptions } from './service.js';
import { ApiError } from './errors.js';
import { parseBootstrapOwnerInput } from './bootstrap-owner.js';
import { hashPassword, hashToken } from './security.js';
import { objectInput } from './validation.js';
import {
  assertEmptyFirstRun,
  createFirstOwner,
  lockFirstRunSetup,
  setupOrigin,
} from './first-run-setup.js';

const rejected = () =>
  new ApiError(403, 'SETUP_TOKEN_REJECTED', '初始化链接无效或已过期，请联系部署人员');
export class FirstRunSetupService extends ApplicationService {
  constructor(
    pool: Pool,
    options: ApiOptions,
    private readonly enabled: boolean,
  ) {
    super(pool, options);
  }
  async initialize(raw: unknown, peer: string): Promise<{ status: 'initialized' }> {
    if (!this.enabled) throw new ApiError(403, 'SETUP_DISABLED', '部署初始化未开启');
    setupOrigin(this.options.appOrigin);
    await this.rateLimit(`first-run:${hashToken(peer)}`, 10, 900);
    const data = objectInput(raw, [
      'token',
      'email',
      'password',
      'confirmPassword',
      'displayName',
      'organizationName',
    ]);
    if (typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw rejected();
    const tokenHash = hashToken(data.token);
    const pre = await this.pool.query(
      `SELECT 1 FROM first_run_setup WHERE singleton=true AND initialized_at IS NULL AND token_used_at IS NULL AND token_hash=$1 AND token_expires_at>clock_timestamp()`,
      [tokenHash],
    );
    if (!pre.rowCount) throw rejected();
    const input = parseBootstrapOwnerInput({
      email: data.email,
      password: data.password,
      displayName: data.displayName,
      organizationName: data.organizationName,
    });
    if (data.confirmPassword !== input.password)
      throw new ApiError(422, 'VALIDATION_ERROR', '两次输入的密码不一致', {
        fieldErrors: { confirmPassword: '请再次输入相同密码' },
      });
    const passwordHash = await hashPassword(input.password);
    await this.transaction(async (client) => {
      const state = await lockFirstRunSetup(client);
      await assertEmptyFirstRun(client, state);
      // Use the database clock after every lock wait; restart cannot extend expiry.
      const valid = await client.query(
        `SELECT 1 FROM first_run_setup WHERE singleton=true AND initialized_at IS NULL AND token_used_at IS NULL AND token_hash=$1 AND token_expires_at>clock_timestamp()`,
        [tokenHash],
      );
      if (!valid.rowCount) throw rejected();
      await createFirstOwner(client, input, passwordHash);
    });
    return { status: 'initialized' };
  }
}
