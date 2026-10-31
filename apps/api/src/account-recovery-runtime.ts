import { readRequiredSecret } from './env.js';
import { emailInput } from './validation.js';
import { ResendAccountMailProvider } from './account-mail-provider.js';
import { deliveryKey } from './account-recovery-domain.js';
import type { AccountRecoveryOptions } from './account-recovery-service.js';

export function accountRecoveryRuntime(): AccountRecoveryOptions {
  const enabled = process.env.SCB_ACCOUNT_MAIL_ENABLED;
  if (enabled !== undefined && !['true', 'false'].includes(enabled))
    throw new Error('Account mail enabled flag must be boolean');
  if (enabled !== 'true') return {};
  const from = emailInput(process.env.SCB_ACCOUNT_MAIL_FROM);
  const key = readRequiredSecret('SCB_ACCOUNT_MAIL_DATA_KEY');
  deliveryKey(key);
  return {
    encryptionKey: key,
    provider: new ResendAccountMailProvider(readRequiredSecret('SCB_ACCOUNT_MAIL_API_KEY'), from),
  };
}
