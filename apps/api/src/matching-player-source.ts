import { ApiError } from './errors.js';
import { objectInput } from './validation.js';
import { expectedVersion } from './registration-validation.js';
import type { PlayerBookingService } from './player-booking/service.js';
import type { MatchingConversionInput, MatchingSourceHooks } from './matching-source-adapter.js';

const unavailable = (): never => {
  throw new ApiError(
    409,
    'MATCHING_PLAYER_SOURCE_CHANGED',
    '球员、需求或原预约条件已改变，请重新读取撮合候选',
  );
};
/** Only explicit declarations and reviewed pricing/terms may come from the client.
 * Source, owner, team, windows and venue always come from the pinned matching need. */
export function matchingPlayerOrderInput(input: MatchingConversionInput) {
  if (
    input.kind !== 'ADULT_PLAYER' ||
    !input.need.teamId ||
    input.candidate.sourceOrgId !== null ||
    input.candidate.sourceSlotId !== null ||
    !input.need.windows.length ||
    input.need.windows[0]!.reportAt !== input.need.startsAt ||
    input.need.windows.at(-1)!.endAt !== input.need.endsAt
  )
    unavailable();
  const raw = objectInput(input.sourceInput, [
    'eligibilityConfirmed',
    'reviewedSettingsVersion',
    'acceptedTermsId',
    'chargeConsent',
  ]);
  if (raw.eligibilityConfirmed !== true)
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      '请明确确认参赛资格声明；撮合不能代替赛事报名和资格审核',
    );
  if (raw.chargeConsent !== undefined && raw.chargeConsent !== true)
    throw new ApiError(422, 'VALIDATION_ERROR', '收费条款须明确确认');
  if (
    raw.acceptedTermsId !== undefined &&
    (typeof raw.acceptedTermsId !== 'string' || !/^[a-f0-9]{64}$/.test(raw.acceptedTermsId))
  )
    throw new ApiError(422, 'VALIDATION_ERROR', '收费条款编号无效');
  const settingsVersion = expectedVersion(raw.reviewedSettingsVersion);
  if (settingsVersion !== input.candidate.settingsVersion) unavailable();
  return {
    commandId: input.commandId,
    orgId: input.need.orgId,
    teamId: input.need.teamId,
    eventName: `撮合需求 ${input.need.id}`,
    scope: input.need.windows.length === 1 ? 'SINGLE' : 'MULTI',
    eligibilityConfirmed: true,
    reviewedSettingsVersion: settingsVersion,
    reviewedProfileVersions: { [input.candidate.sourceId]: input.candidate.sourceVersion },
    appearances: input.need.windows.map((w, index) => ({
      profileId: input.candidate.sourceId,
      label: `撮合场次 ${index + 1}`,
      conditional: false,
      reportAt: w.reportAt,
      startAt: w.startAt,
      endAt: w.endAt,
      venue: input.need.address,
    })),
    ...(raw.acceptedTermsId
      ? { acceptedTermsIds: { [input.candidate.sourceId]: raw.acceptedTermsId } }
      : {}),
    ...(raw.chargeConsent === true ? { chargeConsent: true } : {}),
  };
}
/** Compose this PLAYER branch with local-service/team adapters at the root. */
export function createMatchingPlayerSource(
  service: Pick<PlayerBookingService, 'prepareCreateOrder'>,
): MatchingSourceHooks {
  return {
    async prepare(c, actor, input) {
      const prepared = await service.prepareCreateOrder(c, actor, matchingPlayerOrderInput(input), {
        kind: 'MATCHING',
        needId: input.need.id,
      });
      if (
        prepared.players.length !== 1 ||
        prepared.players[0]!.id !== input.candidate.sourceId ||
        prepared.players[0]!.userId !== input.candidate.userId ||
        prepared.players[0]!.version !== input.candidate.sourceVersion
      )
        unavailable();
      return {
        execute: async () => {
          const order = await prepared.execute();
          if (
            order.orgId !== input.need.orgId ||
            order.teamId !== input.need.teamId ||
            order.buyerUserId !== actor.user.id ||
            order.appearances.length !== input.need.windows.length ||
            order.appearances.some(
              (a) =>
                a.profileId !== input.candidate.sourceId ||
                a.playerUserId !== input.candidate.userId,
            )
          )
            unavailable();
          for (const appearance of order.appearances) {
            const binding = (
              await c.query(
                "SELECT org_id,payer_user_id,beneficiary_user_id,total_fen FROM trade_orders WHERE kind='PLAYER_APPEARANCE' AND source_id=$1 FOR SHARE",
                [appearance.id],
              )
            ).rows[0];
            if (!binding)
              throw new ApiError(
                503,
                'MATCHING_TRADE_REQUIRED',
                '球员收费准备尚未完成，未创建预约，请重新核对',
              );
            if (
              binding.org_id !== input.need.orgId ||
              binding.payer_user_id !== actor.user.id ||
              binding.beneficiary_user_id !== input.candidate.userId ||
              binding.total_fen !== appearance.totalFen
            )
              throw new ApiError(
                409,
                'MATCHING_TRADE_CHANGED',
                '球员原预约收费对象或金额与确认内容不一致',
              );
          }
          return {
            sourceKind: 'PLAYER_ORDER',
            sourceId: order.id,
            totalFen: order.totals.confirmedTotalFen,
          };
        },
      };
    },
  };
}
