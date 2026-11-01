import type { PoolClient } from 'pg';
import { trainingId } from './training-domain.js';
export type TrainingGuardianPurpose = 'PARTICIPATION' | 'NECESSARY_DATA' | 'PICKUP' | 'PUBLICITY';
/** Scope-specific groundwork only: youth enrollment remains hard-disabled in TrainingService. */
export async function readTrainingGuardianAuthorization(
  c: PoolClient,
  input: {
    orgId: string;
    cohortId: string;
    learnerId: string;
    guardianId: string;
    purpose: TrainingGuardianPurpose;
    policyVersion: string;
    expectedEpoch: number;
  },
) {
  const org = trainingId(input.orgId),
    cohort = trainingId(input.cohortId),
    learner = trainingId(input.learnerId),
    guardian = trainingId(input.guardianId);
  if (
    learner === guardian ||
    !Number.isSafeInteger(input.expectedEpoch) ||
    input.expectedEpoch < 1 ||
    !input.policyVersion
  )
    return false;
  // No event/entry/member join: an event grant cannot authorize training, nor can a payer's identity.
  return !!(
    await c.query(
      `SELECT 1 FROM training_guardian_grants g JOIN users a ON a.id=g.guardian_user_id JOIN users l ON l.id=g.learner_user_id
 WHERE g.org_id=$1 AND g.cohort_id=$2 AND g.learner_user_id=$3 AND g.guardian_user_id=$4 AND g.purpose=$5 AND g.policy_version=$6
 AND g.epoch=$7 AND g.state='APPROVED' AND g.reviewed_by IS NOT NULL AND g.reviewed_by NOT IN(g.learner_user_id,g.guardian_user_id)
 AND g.valid_until>clock_timestamp() AND a.status='ACTIVE' AND l.status='ACTIVE' FOR SHARE OF g,a,l`,
      [org, cohort, learner, guardian, input.purpose, input.policyVersion, input.expectedEpoch],
    )
  ).rowCount;
}
