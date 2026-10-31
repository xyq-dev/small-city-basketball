import type { PoolClient } from 'pg';
import type {
  YouthEligibility,
  YouthPurpose,
} from '../../../packages/contracts/youth-guardians.js';
import { createYouthQualificationReader } from './qualification-precheck-service.js';
import {
  createYouthDataConsentGuard,
  readYouthEligibility,
} from './youth-guardians-eligibility.js';
import type { YouthQualificationReader } from './youth-guardians-eligibility.js';
import { guardianThresholdDate } from './youth-guardians-domain.js';

type MemberPurposeInput = {
  orgId: string;
  eventId: string;
  teamId: string;
  memberId: string;
  entryId?: string;
  rosterRevisionId?: string;
  rulesetId?: string;
};
export type YouthPublicationDecision = YouthEligibility & {
  trustedAdult: boolean;
  qualificationId: string | null;
  adultConsentAfter?: string | null;
};
export type YouthPublicationGuard = (
  c: PoolClient,
  input: MemberPurposeInput,
  purpose: YouthPurpose,
) => Promise<YouthPublicationDecision>;
const denied = (code: string): YouthPublicationDecision => ({
  required: true,
  ready: false,
  blockers: [code],
  snapshot: null,
  trustedAdult: false,
  qualificationId: null,
});
/** Caller holds this event's SHARE/UPDATE lock. Only current independent qualification can exempt an adult. */
export function createYouthPublicationGuard(
  participantDataKey?: string,
  injected?: YouthQualificationReader,
): YouthPublicationGuard {
  let reader = injected;
  return async (c, input, purpose) => {
    const policy = (
      await c.query(
        'SELECT enabled,guardian_age_threshold FROM youth_event_policies WHERE org_id=$1 AND event_id=$2',
        [input.orgId, input.eventId],
      )
    ).rows[0];
    if (!policy?.enabled)
      return {
        required: false,
        ready: true,
        blockers: [],
        snapshot: null,
        trustedAdult: false,
        qualificationId: null,
      };
    if (!reader) {
      if (!participantDataKey) return denied('YOUTH_QUALIFICATION_UNAVAILABLE');
      reader = createYouthQualificationReader(participantDataKey, {
        dataConsentGuard: createYouthDataConsentGuard(participantDataKey),
      });
    }
    const entry = (
      await c.query(
        `SELECT en.id,en.roster_revision_id,en.ruleset_id,ev.start_date::text FROM entries en JOIN events ev ON ev.org_id=en.org_id AND ev.id=en.event_id WHERE en.org_id=$1 AND en.event_id=$2 AND en.team_id=$3 AND en.status NOT IN('WITHDRAWN','REJECTED')`,
        [input.orgId, input.eventId, input.teamId],
      )
    ).rows[0];
    if (
      !entry ||
      !entry.roster_revision_id ||
      (input.entryId && entry.id !== input.entryId) ||
      (input.rosterRevisionId && entry.roster_revision_id !== input.rosterRevisionId) ||
      (input.rulesetId && entry.ruleset_id !== input.rulesetId)
    )
      return denied('GUARDIAN_SOURCE_CHANGED');
    const scope = {
      orgId: input.orgId,
      eventId: input.eventId,
      entryId: entry.id,
      memberId: input.memberId,
      rosterRevisionId: entry.roster_revision_id,
      rulesetId: entry.ruleset_id,
      policyDate: entry.start_date,
      purpose,
    };
    const q = await reader(c, scope);
    const result = await readYouthEligibility(c, scope, async () => q);
    return {
      ...result,
      trustedAdult: result.ready && !result.required && q.ready,
      qualificationId: q.qualificationId,
      adultConsentAfter:
        result.ready && !result.required && q.ready && q.birthDate
          ? guardianThresholdDate(q.birthDate, policy.guardian_age_threshold)
          : null,
    };
  };
}
/** Declared youth contexts stay protected after withdrawal/closure; a client toggle cannot erase this product boundary. */
export async function knownYouthAccount(c: PoolClient, userId: string): Promise<boolean> {
  return Boolean(
    (
      await c.query(
        `SELECT EXISTS(SELECT 1 FROM youth_guardian_preconsents p JOIN youth_event_policies policy ON policy.org_id=p.org_id AND policy.event_id=p.event_id AND policy.enabled WHERE p.subject_user_id=$1) OR EXISTS(SELECT 1 FROM participant_materials m JOIN youth_event_policies policy ON policy.org_id=m.org_id AND policy.event_id=m.event_id AND policy.enabled WHERE m.user_id=$1) AS known`,
        [userId],
      )
    ).rows[0]?.known,
  );
}
/** Root/E01 callback: gate every frozen participant on both sides before a new live/recording action. */
export function createYouthLiveConsentGuard(
  participantDataKey?: string,
  injected?: YouthQualificationReader,
) {
  const guard = createYouthPublicationGuard(participantDataKey, injected);
  return async (
    c: PoolClient,
    input: { orgId: string; eventId: string; matchId: string },
  ): Promise<{ ready: boolean }> => {
    const policy = (
      await c.query('SELECT enabled FROM youth_event_policies WHERE org_id=$1 AND event_id=$2', [
        input.orgId,
        input.eventId,
      ])
    ).rows[0];
    if (!policy?.enabled) return { ready: true };
    const m = (
      await c.query('SELECT * FROM published_matches WHERE org_id=$1 AND event_id=$2 AND id=$3', [
        input.orgId,
        input.eventId,
        input.matchId,
      ])
    ).rows[0];
    if (!m) return { ready: false };
    for (const side of ['home', 'away']) {
      const players = (
        await c.query(
          'SELECT member_id FROM entry_roster_players WHERE org_id=$1 AND entry_id=$2 AND revision_id=$3 ORDER BY member_id',
          [input.orgId, m[side + '_entry_id'], m[side + '_roster_revision_id']],
        )
      ).rows;
      if (!players.length) return { ready: false };
      for (const p of players) {
        const result = await guard(
          c,
          {
            orgId: input.orgId,
            eventId: input.eventId,
            teamId: m[side + '_team_id'],
            entryId: m[side + '_entry_id'],
            rosterRevisionId: m[side + '_roster_revision_id'],
            memberId: p.member_id,
          },
          'LIVE_RECORDING',
        );
        if (!result.ready) return { ready: false };
      }
    }
    return { ready: true };
  };
}
