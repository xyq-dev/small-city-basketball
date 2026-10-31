import type { Pool } from 'pg';
import type { ApiOptions } from './service.js';
import type { WechatService } from './wechat-service.js';
import { TradeService } from './trade-service.js';
import type { TradeRuntime } from './trade-provider.js';
import { createTradePayerResolver } from './trade-payer.js';
import { NotificationService, revokeNotificationGrants } from './notification-service.js';
import type { NotificationOptions } from './notification-service.js';
import { StreamingService } from './streaming-service.js';
import type { StreamingOptions } from './streaming-service.js';
import { readStreamingOptions } from './streaming-runtime.js';
import { readStreamingClosureBlockers, revokeStreamingPrivacy } from './streaming-privacy.js';
import { InsuranceService, revokeInsuranceForClosure } from './insurance-service.js';
import type { InsuranceOptions } from './insurance-service.js';
import {
  QualificationPrecheckService,
  createYouthQualificationReader,
} from './qualification-precheck-service.js';
import { YouthGuardiansService } from './youth-guardians-service.js';
import {
  readYouthDataProcessingConsent,
  readYouthEligibility,
  revokeYouthForClosure,
} from './youth-guardians-eligibility.js';
import { createYouthLiveConsentGuard } from './youth-guardians-publication.js';
import { AccountClosureService } from './account-closure-service.js';
import type { AccountClosureOptions } from './account-closure-service.js';
import { createAccountClosureHooks } from './account-closure-hooks.js';

export interface ExpansionOptions {
  trade?: TradeRuntime;
  notifications?: NotificationOptions;
  streaming?: StreamingOptions;
  insurance?: InsuranceOptions;
  accountClosure?: Omit<AccountClosureOptions, 'hooks'>;
}
/** One composition root: live business services receive the same current authority readers. */
export async function createExpansionServices(
  pool: Pool,
  options: ApiOptions,
  input: ExpansionOptions,
  wechat: WechatService,
) {
  const dataConsentGuard = readYouthDataProcessingConsent;
  const workerOptions = options.backgroundWorkersEnabled === false ? { autoDispatch: false } : {};
  const qualificationOptions = { dataConsentGuard };
  const reader = options.participantDataKey
    ? createYouthQualificationReader(options.participantDataKey, qualificationOptions)
    : undefined;
  const participationGuard = (
    c: Parameters<typeof readYouthEligibility>[0],
    i: Parameters<typeof readYouthEligibility>[1],
  ) => readYouthEligibility(c, { ...i, purpose: 'PARTICIPATION' }, reader);
  const insurance = new InsuranceService(pool, options, {
    ...input.insurance,
    ...workerOptions,
    dataConsentGuard,
    participationGuard,
  });
  await insurance.assertConfiguration();
  const qualification = new QualificationPrecheckService(pool, options, qualificationOptions);
  const youth = new YouthGuardiansService(pool, { ...options, youthQualificationReader: reader });
  const materialGuards = {
    dataConsentGuard,
    participationGuard,
    onlineInsuranceGuard: insurance.readEligibility.bind(insurance),
  };
  const tradeRuntime = input.trade ?? {};
  const trade = new TradeService(pool, options, {
    ...tradeRuntime,
    resolvePayer:
      tradeRuntime.resolvePayer ??
      createTradePayerResolver(pool, wechat.configuration, wechat.exchange, {
        ...tradeRuntime.merchants,
        ...tradeRuntime.historicalMerchants,
      }),
  });
  const notifications = new NotificationService(pool, options, {
    ...input.notifications,
    ...workerOptions,
  });
  await notifications.assertConfiguration();
  const liveConsent = createYouthLiveConsentGuard(options.participantDataKey, reader);
  const authorizeRecording: NonNullable<StreamingOptions['authorizeRecording']> = async (c, i) =>
    (await liveConsent(c, i)).ready;
  const streaming = new StreamingService(pool, options, {
    ...(input.streaming ?? readStreamingOptions(authorizeRecording)),
    ...workerOptions,
    authorizeRecording,
  });
  const closure = new AccountClosureService(pool, options, {
    enabled: true,
    ...input.accountClosure,
    ...workerOptions,
    hooks: createAccountClosureHooks({
      streaming: { inspect: readStreamingClosureBlockers, revoke: revokeStreamingPrivacy },
      insurance: {
        inspect: insurance.closureBlockers.bind(insurance),
        revoke: revokeInsuranceForClosure,
      },
      trade: { assertSafe: trade.assertAccountClosureSafe.bind(trade) },
      notifications: { revoke: revokeNotificationGrants },
      guardians: { revoke: revokeYouthForClosure },
    }),
  });
  return {
    trade,
    notifications,
    streaming,
    insurance,
    qualification,
    youth,
    closure,
    materialGuards,
  };
}
