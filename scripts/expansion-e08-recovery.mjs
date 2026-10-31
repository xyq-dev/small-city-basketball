import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { syntheticPdf } from './c05-media-fixtures.mjs';

// Generated solid image and deliberately non-real district prefix; no real child or document.
const portrait =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAO0lEQVRIiWMQCeihKWIYtSBgNIh6RlORyGhG6xktKkRGS9OA0QpHZLTKDBhtVfSMNrwCRpuOPYO6dQ0AgRXALm9rtrMAAAAASUVORK5CYII=';
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (v) =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
function identity(birth, sequence = 1) {
  const first = `990000${birth.replaceAll('-', '')}${String(sequence).padStart(3, '0')}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  return first + '10X98765432'[[...first].reduce((n, d, i) => n + Number(d) * weights[i], 0) % 11];
}
function references(saved) {
  for (const k of [
    'orgId',
    'eventId',
    'teamId',
    'entryId',
    'guardianId',
    'reviewerId',
    'activeRequestId',
    'withdrawnRequestId',
    'activePreconsentId',
    'withdrawnPreconsentId',
    'adultSubjectId',
    'adultCurrentConsentId',
  ])
    assert.ok(uuid(saved?.[k]), `E08 requires exact ${k}`);
  for (const k of [
    'userIds',
    'memberIds',
    'materialIds',
    'qualificationIds',
    'preconsentIds',
    'requestIds',
    'historyIds',
    'prehistoryIds',
    'commandIds',
    'adultConsentIds',
  ])
    assert.ok(
      Array.isArray(saved?.[k]) && saved[k].length && saved[k].every(uuid),
      `E08 requires nonempty ${k}`,
    );
  for (const k of [
    'policy',
    'requests',
    'requestIdentity',
    'ciphertexts',
    'preconsents',
    'preconsentIdentity',
    'history',
    'prehistory',
    'commands',
    'adultFacts',
    'adultSource',
  ])
    assert.match(saved.hashes?.[k] ?? '', /^[a-f0-9]{64}$/);
}
/** SQL emits only IDs, status/version fences, and SHA256 digests; no private payload leaves SQL. */
async function retained(readPool, saved) {
  const c = await readPool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    const policy = (
      await c.query(
        `SELECT encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') AS hash FROM youth_event_policies p WHERE org_id=$1 AND event_id=$2`,
        [saved.orgId, saved.eventId],
      )
    ).rows;
    const requests = (
      await c.query(
        `SELECT r.id,r.status,r.version,r.guardian_payload_ciphertext IS NOT NULL AS proof_retained,
      encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash,
      encode(sha256(convert_to((to_jsonb(r)-ARRAY['status','version','updated_at'])::text,'UTF8')),'hex') AS identity_hash,
      encode(sha256(convert_to(r.guardian_payload_ciphertext,'UTF8')),'hex') AS ciphertext_hash,
      (SELECT max(h.version) FROM youth_guardian_history h WHERE h.request_id=r.id AND h.id=ANY($2::uuid[])) AS retained_history_version,
      (SELECT max(h.version) FROM youth_guardian_history h WHERE h.request_id=r.id) AS current_history_version
      FROM youth_guardian_requests r WHERE r.id=ANY($1::uuid[]) ORDER BY r.id`,
        [saved.requestIds, saved.historyIds],
      )
    ).rows;
    const preconsents = (
      await c.query(
        `SELECT p.id,p.status,p.version,
      encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') AS hash,
      encode(sha256(convert_to((to_jsonb(p)-ARRAY['status','version','updated_at'])::text,'UTF8')),'hex') AS identity_hash,
      (SELECT max(h.version) FROM youth_preconsent_history h WHERE h.preconsent_id=p.id AND h.id=ANY($2::uuid[])) AS retained_history_version,
      (SELECT max(h.version) FROM youth_preconsent_history h WHERE h.preconsent_id=p.id) AS current_history_version
      FROM youth_guardian_preconsents p WHERE p.id=ANY($1::uuid[]) ORDER BY p.id`,
        [saved.preconsentIds, saved.prehistoryIds],
      )
    ).rows;
    const history = (
      await c.query(
        `SELECT id,encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex') AS hash FROM youth_guardian_history h WHERE id=ANY($1::uuid[]) ORDER BY id`,
        [saved.historyIds],
      )
    ).rows;
    const prehistory = (
      await c.query(
        `SELECT id,encode(sha256(convert_to(to_jsonb(h)::text,'UTF8')),'hex') AS hash FROM youth_preconsent_history h WHERE id=ANY($1::uuid[]) ORDER BY id`,
        [saved.prehistoryIds],
      )
    ).rows;
    const commands = (
      await c.query(
        `SELECT actor_id,client_request_id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS hash FROM youth_guardian_commands r WHERE org_id=$1 AND event_id=$2 AND client_request_id=ANY($3::uuid[]) ORDER BY actor_id,client_request_id`,
        [saved.orgId, saved.eventId, saved.commandIds],
      )
    ).rows;
    const adultFacts = (
      await c.query(
        `SELECT id,version,encode(sha256(convert_to(to_jsonb(f)::text,'UTF8')),'hex') AS hash FROM youth_adult_data_consents f WHERE id=ANY($1::uuid[]) ORDER BY id`,
        [saved.adultConsentIds],
      )
    ).rows;
    const adultLatest = (
      await c.query(
        `SELECT id,decision,cause,version,encode(sha256(convert_to((to_jsonb(f)-ARRAY['id','client_request_id','performed_by','decision','cause','version','created_at'])::text,'UTF8')),'hex') AS source_hash FROM youth_adult_data_consents f WHERE actor_id=$1 AND org_id=$2 AND event_id=$3 AND entry_id=$4 AND member_id=$5 ORDER BY version DESC LIMIT 1`,
        [saved.adultSubjectId, saved.orgId, saved.eventId, saved.entryId, saved.memberIds[2]],
      )
    ).rows[0];
    const liveSessions = (
      await c.query(
        'SELECT count(*)::int AS n FROM sessions WHERE user_id=ANY($1::uuid[]) AND revoked_at IS NULL AND expires_at>clock_timestamp()',
        [saved.userIds],
      )
    ).rows[0].n;
    await c.query('COMMIT');
    assert.equal(policy.length, 1);
    assert.equal(requests.length, saved.requestIds.length);
    assert.equal(preconsents.length, saved.preconsentIds.length);
    assert.equal(history.length, saved.historyIds.length);
    assert.equal(prehistory.length, saved.prehistoryIds.length);
    assert.equal(commands.length, saved.commandIds.length);
    assert.equal(adultFacts.length, saved.adultConsentIds.length);
    assert.ok(adultLatest);
    assert.ok(
      requests.every((r) => r.proof_retained && /^[a-f0-9]{64}$/.test(r.ciphertext_hash)),
      'E08 private evidence must remain retained',
    );
    const digests = {
      policy: policy[0].hash,
      requests: sha(requests.map((r) => ({ id: r.id, hash: r.hash }))),
      requestIdentity: sha(requests.map((r) => ({ id: r.id, hash: r.identity_hash }))),
      ciphertexts: sha(requests.map((r) => ({ id: r.id, hash: r.ciphertext_hash }))),
      preconsents: sha(preconsents.map((r) => ({ id: r.id, hash: r.hash }))),
      preconsentIdentity: sha(preconsents.map((r) => ({ id: r.id, hash: r.identity_hash }))),
      history: sha(history),
      prehistory: sha(prehistory),
      commands: sha(commands),
      adultFacts: sha(adultFacts.map((r) => ({ id: r.id, hash: r.hash }))),
      adultSource: adultLatest.source_hash,
    };
    return {
      digests,
      requests,
      preconsents,
      liveSessions,
      adultLatest,
      retainedAdultVersion: Math.max(...adultFacts.map((f) => f.version)),
    };
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {}
    throw e;
  } finally {
    c.release();
  }
}
/** Only the isolated source harness calls this. Real HTTP/services create all seven nonempty E08 tables. */
export async function captureExpansionGuardians({
  call,
  state,
  runtimePool,
  readPool,
  databaseUrl,
  appOrigin,
  participantDataKey,
  suffix,
  registerSynthetic,
}) {
  const parsed = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.match(
    decodeURIComponent(parsed.pathname.slice(1)),
    /^scb_test_[A-Za-z0-9_]+$/,
    'E08 capture refuses non-isolated databases',
  );
  assert.ok(uuid(state.orgId) && uuid(state.userId) && typeof state.cookie === 'string');
  assert.ok(typeof appOrigin === 'string' && typeof participantDataKey === 'string');
  assert.equal(
    (await readPool.query('SELECT current_database() AS db')).rows[0].db,
    decodeURIComponent(parsed.pathname.slice(1)),
  );
  async function actor(label) {
    if (registerSynthetic) {
      const a = await registerSynthetic('合成E08恢复' + label);
      assert.ok(uuid(a.userId ?? a.id) && a.cookie);
      return { id: a.userId ?? a.id, cookie: a.cookie };
    }
    const a = await call('/v1/auth/register-participant', {
      method: 'POST',
      body: {
        email: `e08-${label}-${suffix}@example.test`,
        password: randomBytes(24).toString('base64url'),
        displayName: '合成E08恢复' + label,
      },
    });
    const cookie = a.response.headers
      .getSetCookie()
      .find((v) => v.startsWith('scb.sid='))
      ?.split(';')[0];
    assert.ok(cookie);
    return { id: a.data.user.id, cookie };
  }
  const [child1, child2, guardian, reviewer] = await Promise.all(
    ['child1', 'child2', 'guardian', 'reviewer'].map(actor),
  );
  const org = `/v1/orgs/${state.orgId}`;
  await call(`${org}/members/${reviewer.id}`, {
    method: 'PUT',
    cookie: state.cookie,
    body: { role: 'REVIEWER', status: 'ACTIVE' },
  });
  const event = (
    await call(`${org}/events`, {
      method: 'POST',
      cookie: state.cookie,
      body: {
        name: `合成青年恢复-${suffix}`,
        startDate: '2028-02-28',
        endDate: '2028-02-29',
        timezone: 'Asia/Shanghai',
        format: 'ROUND_ROBIN',
      },
    })
  ).data;
  const eventPath = `${org}/events/${event.id}`;
  await call(`${eventPath}/staff/${reviewer.id}`, {
    method: 'PUT',
    cookie: state.cookie,
    body: { role: 'REVIEWER', status: 'ACTIVE' },
  });
  let reg = (
    await call(`${eventPath}/registration-rules`, {
      method: 'PUT',
      cookie: state.cookie,
      body: {
        expectedVersion: event.version,
        minPlayers: 2,
        maxPlayers: 3,
        zeroAndDoubleZeroDistinct: false,
        requireIdentity: true,
        requireInsurance: false,
        requireParticipantMaterials: true,
      },
    })
  ).data;
  await call(`${eventPath}/youth-policy`, {
    method: 'PUT',
    cookie: state.cookie,
    body: {
      clientRequestId: randomUUID(),
      expectedVersion: null,
      enabled: true,
      guardianAgeThreshold: 18,
    },
  });
  reg = (
    await call(`${eventPath}/registration-commands`, {
      method: 'POST',
      cookie: state.cookie,
      body: { type: 'OPEN_REGISTRATION', expectedVersion: reg.event.version },
    })
  ).data;
  const team = (
    await call(`${org}/teams`, {
      method: 'POST',
      cookie: state.cookie,
      body: { name: `合成青年恢复球队-${suffix}` },
    })
  ).data;
  await call(`${org}/teams/${team.id}/grants/${child1.id}`, {
    method: 'PUT',
    cookie: state.cookie,
    body: { status: 'ACTIVE' },
  });
  const members = [];
  for (const [n, child] of [child1, child2, guardian].entries()) {
    const code = (
      await call(`${org}/teams/${team.id}/join-codes`, {
        method: 'POST',
        cookie: state.cookie,
        body: { expiresInHours: 1, maxUses: 1 },
      })
    ).data;
    const joined = (
      await call('/v1/team-joins', {
        method: 'POST',
        cookie: child.cookie,
        body: { code: code.code, displayName: '合成青年恢复' + (n + 1) },
      })
    ).data;
    members.push({ actor: child, memberId: joined.memberId });
  }
  let entry = (
    await call(`${eventPath}/entries`, {
      method: 'POST',
      cookie: child1.cookie,
      body: { teamId: team.id },
    })
  ).data;
  const entryPath = `${org}/entries/${entry.id}`;
  entry = (
    await call(`${entryPath}/roster`, {
      method: 'PUT',
      cookie: child1.cookie,
      body: {
        expectedVersion: entry.version,
        players: members.map((m, n) => ({ memberId: m.memberId, jerseyNo: String(n + 1) })),
      },
    })
  ).data;
  const preconsentIds = [],
    requestIds = [],
    qualificationIds = [],
    materialIds = [];
  for (const [n, m] of members.slice(0, 2).entries()) {
    const pre = (
      await call(`${eventPath}/youth-data-invitations`, {
        method: 'POST',
        cookie: m.actor.cookie,
        body: {
          clientRequestId: randomUUID(),
          expectedPolicyVersion: 1,
          guardianUserId: guardian.id,
          subjectAlias: '合成青年恢复别名' + (n + 1),
          declaredYouth: true,
        },
      })
    ).data;
    await call(`/v1/youth-data-invitations/${pre.preconsentId}/commands`, {
      method: 'POST',
      cookie: guardian.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedVersion: pre.version,
        decision: 'CONSENT',
        acceptedDataProcessing: true,
        dataTermsVersion: 'youth-data-processing-v1',
      },
    });
    preconsentIds.push(pre.preconsentId);
    const material = (
      await call(`${entryPath}/participant-materials/mine`, {
        method: 'PUT',
        cookie: m.actor.cookie,
        body: {
          clientRequestId: randomUUID(),
          expectedVersion: 0,
          realName: '合成恢复青年' + (n + 1),
          identityNumber: identity('2015-01-01', n + 1),
          portrait: { fileName: 'synthetic-child.png', contentType: 'image/png', base64: portrait },
          acceptedTerms: true,
          publicityConsent: true,
        },
      })
    ).data.material;
    materialIds.push(material.id);
    const q = (
      await call(`${entryPath}/qualification-precheck/requests`, {
        method: 'POST',
        cookie: m.actor.cookie,
        body: {
          clientRequestId: randomUUID(),
          memberId: m.memberId,
          expectedMaterialVersion: material.version,
          acceptedTermsVersion: 'qualification-precheck-v1',
        },
      })
    ).data;
    const reviewed = (
      await call(`${entryPath}/qualification-precheck/reviews`, {
        method: 'POST',
        cookie: reviewer.cookie,
        body: {
          clientRequestId: randomUUID(),
          memberId: m.memberId,
          expectedMaterialVersion: material.version,
          requestId: q.requestId,
          decision: 'APPROVED',
          reason: '合成恢复资格独立人工核验',
          identityReviewed: true,
          portraitReviewed: true,
          signatureReviewed: true,
        },
      })
    ).data;
    qualificationIds.push(reviewed.qualificationId);
    const proposed = (
      await call(`${eventPath}/youth-guardian-requests`, {
        method: 'POST',
        cookie: m.actor.cookie,
        body: {
          clientRequestId: randomUUID(),
          entryId: entry.id,
          memberId: m.memberId,
          expectedPolicyVersion: 1,
          acceptedTerms: true,
          termsVersion: 'youth-participation-v1',
          publicityConsent: true,
          archiveConsent: true,
          liveConsent: true,
        },
      })
    ).data;
    const confirmed = (
      await call(`/v1/youth-guardian-requests/${proposed.requestId}/confirm`, {
        method: 'POST',
        cookie: guardian.cookie,
        body: {
          clientRequestId: randomUUID(),
          expectedVersion: proposed.version,
          acceptedTerms: true,
          termsVersion: 'youth-participation-v1',
          realName: '合成恢复监护人',
          identityNumber: identity('1990-01-01'),
          relationship: 'PARENT',
          relationshipExplanation: '合成隔离恢复关系核验资料',
          proof: {
            fileName: 'synthetic-relationship.pdf',
            contentType: 'application/pdf',
            base64: syntheticPdf.toString('base64'),
          },
          publicityConsent: true,
          archiveConsent: true,
          liveConsent: true,
        },
      })
    ).data;
    await call(`/v1/youth-guardian-requests/${proposed.requestId}/review`, {
      method: 'POST',
      cookie: reviewer.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedVersion: confirmed.version,
        decision: 'APPROVE',
        reason: '合成恢复监护身份成年关系核验',
        identityChecked: true,
        relationshipChecked: true,
      },
    });
    requestIds.push(proposed.requestId);
  }
  // The already-registered guardian is also a distinct adult subject in this synthetic roster.
  // Its former processing guardian is the owner; the independent reviewer remains unrelated.
  const adultMember = members[2],
    adultPath = `${eventPath}/youth-adult-data-consent`;
  const adultPre = (
    await call(`${eventPath}/youth-data-invitations`, {
      method: 'POST',
      cookie: guardian.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedPolicyVersion: 1,
        guardianUserId: state.userId,
        subjectAlias: '合成历史青年现成年本人',
        declaredYouth: true,
      },
    })
  ).data;
  const adultPreAccepted = (
    await call(`/v1/youth-data-invitations/${adultPre.preconsentId}/commands`, {
      method: 'POST',
      cookie: state.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedVersion: adultPre.version,
        decision: 'CONSENT',
        acceptedDataProcessing: true,
        dataTermsVersion: 'youth-data-processing-v1',
      },
    })
  ).data;
  let adultMaterial = (
    await call(`${entryPath}/participant-materials/mine`, {
      method: 'PUT',
      cookie: guardian.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedVersion: 0,
        realName: '合成恢复成年本人',
        identityNumber: identity('1990-01-01'),
        portrait: { fileName: 'synthetic-adult.png', contentType: 'image/png', base64: portrait },
        acceptedTerms: true,
        publicityConsent: true,
      },
    })
  ).data.material;
  materialIds.push(adultMaterial.id);
  async function qualifyAdult() {
    const requested = (
      await call(`${entryPath}/qualification-precheck/requests`, {
        method: 'POST',
        cookie: guardian.cookie,
        body: {
          clientRequestId: randomUUID(),
          memberId: adultMember.memberId,
          expectedMaterialVersion: adultMaterial.version,
          acceptedTermsVersion: 'qualification-precheck-v1',
        },
      })
    ).data;
    const result = (
      await call(`${entryPath}/qualification-precheck/reviews`, {
        method: 'POST',
        cookie: reviewer.cookie,
        body: {
          clientRequestId: randomUUID(),
          memberId: adultMember.memberId,
          expectedMaterialVersion: adultMaterial.version,
          requestId: requested.requestId,
          decision: 'APPROVED',
          reason: '合成恢复成年身份独立核验',
          identityReviewed: true,
          portraitReviewed: true,
          signatureReviewed: true,
        },
      })
    ).data;
    qualificationIds.push(result.qualificationId);
    return result.qualificationId;
  }
  const originalAdultAgeEvidence = await qualifyAdult();
  await call(`/v1/youth-data-invitations/${adultPre.preconsentId}/commands`, {
    method: 'POST',
    cookie: state.cookie,
    body: {
      clientRequestId: randomUUID(),
      expectedVersion: adultPreAccepted.version,
      decision: 'WITHDRAW',
    },
  });
  preconsentIds.push(adultPre.preconsentId);
  const adultConsentIds = [];
  async function renewAdult() {
    const cap = (
      await call(adultPath + '?entryId=' + entry.id + '&memberId=' + adultMember.memberId, {
        cookie: guardian.cookie,
      })
    ).data;
    assert.equal(cap.canConsent, true);
    assert.equal(cap.evidenceQualificationId, originalAdultAgeEvidence);
    const fact = (
      await call(adultPath, {
        method: 'POST',
        cookie: guardian.cookie,
        body: {
          clientRequestId: randomUUID(),
          entryId: entry.id,
          memberId: adultMember.memberId,
          expectedAdultVersion: cap.expectedAdultVersion,
          expectedMaterialVersion: cap.expectedMaterialVersion,
          expectedPolicyVersion: cap.policyVersion,
          evidenceQualificationId: cap.evidenceQualificationId,
          decision: 'CONSENT',
          acceptedDataProcessing: true,
          termsVersion: 'youth-adult-data-processing-v1',
        },
      })
    ).data;
    adultConsentIds.push(fact.adultConsentId);
    return fact;
  }
  await renewAdult();
  // A new revision with the same protected identity requires a fresh processing consent.
  // Normal current photo qualification is still requested and independently reviewed afterward.
  adultMaterial = (
    await call(`${entryPath}/participant-materials/mine`, {
      method: 'PUT',
      cookie: guardian.cookie,
      body: {
        clientRequestId: randomUUID(),
        expectedVersion: adultMaterial.version,
        portrait: {
          fileName: 'synthetic-adult-new.png',
          contentType: 'image/png',
          base64: portrait,
        },
        acceptedTerms: true,
        publicityConsent: false,
      },
    })
  ).data.material;
  const adultCurrent = await renewAdult();
  await qualifyAdult();
  const { createYouthQualificationReader } =
    await import('../apps/api/dist/qualification-precheck-service.js');
  const { createYouthDataConsentGuard, readYouthEligibility } =
    await import('../apps/api/dist/youth-guardians-eligibility.js');
  const reader = createYouthQualificationReader(participantDataKey, {
    dataConsentGuard: createYouthDataConsentGuard(participantDataKey),
  });
  const c = await runtimePool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT id FROM events WHERE org_id=$1 AND id=$2 FOR SHARE', [
      state.orgId,
      event.id,
    ]);
    for (const m of members)
      for (const purpose of ['PARTICIPATION', 'PUBLICITY', 'PUBLIC_ARCHIVE', 'LIVE_RECORDING'])
        assert.equal(
          (
            await readYouthEligibility(
              c,
              {
                orgId: state.orgId,
                eventId: event.id,
                entryId: entry.id,
                memberId: m.memberId,
                rosterRevisionId: entry.rosterRevisionId,
                rulesetId: entry.rules.id,
                policyDate: reg.event.startDate,
                purpose,
              },
              reader,
            )
          ).ready,
          true,
          'E08 source must contain a real current independent grant for each purpose',
        );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  const withdrawn = (
    await call(`/v1/youth-guardian-requests/${requestIds[1]}`, { cookie: child2.cookie })
  ).data;
  await call(`/v1/youth-guardian-requests/${requestIds[1]}/withdraw`, {
    method: 'POST',
    cookie: child2.cookie,
    body: { clientRequestId: randomUUID(), expectedVersion: withdrawn.version },
  });
  const workspace = (await call('/v1/me/youth-guardians', { cookie: child2.cookie })).data;
  const pre = workspace.preconsents.find((p) => p.id === preconsentIds[1]);
  assert.ok(pre);
  await call(`/v1/youth-data-invitations/${pre.preconsentId ?? pre.id}/commands`, {
    method: 'POST',
    cookie: child2.cookie,
    body: { clientRequestId: randomUUID(), expectedVersion: pre.version, decision: 'WITHDRAW' },
  });
  const historyIds = (
    await readPool.query(
      'SELECT id FROM youth_guardian_history WHERE request_id=ANY($1::uuid[]) ORDER BY id',
      [requestIds],
    )
  ).rows.map((r) => r.id);
  const prehistoryIds = (
    await readPool.query(
      'SELECT id FROM youth_preconsent_history WHERE preconsent_id=ANY($1::uuid[]) ORDER BY id',
      [preconsentIds],
    )
  ).rows.map((r) => r.id);
  const commandIds = (
    await readPool.query(
      'SELECT client_request_id FROM youth_guardian_commands WHERE org_id=$1 AND event_id=$2 ORDER BY actor_id,client_request_id',
      [state.orgId, event.id],
    )
  ).rows.map((r) => r.client_request_id);
  const saved = {
    orgId: state.orgId,
    eventId: event.id,
    teamId: team.id,
    entryId: entry.id,
    guardianId: guardian.id,
    adultSubjectId: guardian.id,
    adultConsentIds,
    adultCurrentConsentId: adultCurrent.adultConsentId,
    reviewerId: reviewer.id,
    userIds: [child1.id, child2.id, guardian.id, reviewer.id],
    memberIds: members.map((m) => m.memberId),
    materialIds,
    qualificationIds,
    preconsentIds,
    requestIds,
    historyIds,
    prehistoryIds,
    commandIds,
    activeRequestId: requestIds[0],
    withdrawnRequestId: requestIds[1],
    activePreconsentId: preconsentIds[0],
    withdrawnPreconsentId: preconsentIds[1],
  };
  const snapshot = await retained(readPool, saved);
  assert.equal(snapshot.requests.find((r) => r.id === saved.activeRequestId).status, 'APPROVED');
  assert.equal(
    snapshot.requests.find((r) => r.id === saved.withdrawnRequestId).status,
    'WITHDRAWN',
  );
  assert.equal(
    snapshot.preconsents.find((r) => r.id === saved.activePreconsentId).status,
    'CONSENTED',
  );
  assert.equal(
    snapshot.preconsents.find((r) => r.id === saved.withdrawnPreconsentId).status,
    'WITHDRAWN',
  );
  saved.hashes = snapshot.digests;
  references(saved);
  return saved;
}
/** Exact data before quarantine; no HTTP writes, audit mutations or key reads during fingerprint checks. */
export async function verifyExpansionGuardians({ readPool, saved }) {
  references(saved);
  const now = await retained(readPool, saved);
  assert.deepEqual(now.digests, saved.hashes);
  assert.equal(now.adultLatest.id, saved.adultCurrentConsentId);
  assert.equal(now.adultLatest.decision, 'CONSENT');
}
/** Restore quarantine retains private facts, fences both current authorities, and revokes old sessions. */
export async function verifyExpansionGuardiansQuarantine({ readPool, saved }) {
  references(saved);
  const now = await retained(readPool, saved);
  for (const k of [
    'policy',
    'requestIdentity',
    'ciphertexts',
    'preconsentIdentity',
    'history',
    'prehistory',
    'commands',
    'adultFacts',
    'adultSource',
  ])
    assert.equal(now.digests[k], saved.hashes[k], `E08 quarantine must retain ${k}`);
  for (const r of now.requests) {
    assert.equal(r.status, 'WITHDRAWN');
    assert.equal(r.version, r.current_history_version);
    assert.ok(
      r.id === saved.activeRequestId
        ? r.version > r.retained_history_version
        : r.version >= r.retained_history_version,
    );
  }
  for (const p of now.preconsents) {
    assert.equal(p.status, 'WITHDRAWN');
    assert.equal(p.version, p.current_history_version);
    assert.ok(
      p.id === saved.activePreconsentId
        ? p.version > p.retained_history_version
        : p.version >= p.retained_history_version,
    );
  }
  assert.equal(now.adultLatest.decision, 'WITHDRAW');
  assert.equal(now.adultLatest.cause, 'RESTORE_QUARANTINE');
  assert.ok(now.adultLatest.version > now.retainedAdultVersion);
  assert.equal(
    now.liveSessions,
    0,
    'E08 old actor sessions must be revoked after isolated restore',
  );
}
