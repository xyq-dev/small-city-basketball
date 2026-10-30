import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  PARTICIPANT_TERMS_VERSION,
  decryptParticipantPayload,
  encryptParticipantPayload,
  maskParticipantIdentity,
  mergeParticipantDraft,
  parseParticipantDraft,
  parseParticipantReview,
  participantEligibility,
  participantIdentityDigest,
  participantIdentityNumber,
  participantKey,
  participantKeyId,
  participantRequestFingerprint,
  sanitizeParticipantFile,
} from './participant-materials-domain.js';
import type {
  ParticipantEligibilityContext,
  ParticipantFileInput,
  ParticipantPrivatePayload,
  ParticipantResource,
} from './participant-materials-domain.js';

const syntheticIdentity = (birthday = '20000229', sequence = '123') => {
  const prefix = `990000${birthday}${sequence}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(prefix[index]) * weight, 0);
  return prefix + '10X98765432'[sum % 11];
};
const resource = (): ParticipantResource => ({
  orgId: randomUUID(),
  eventId: randomUUID(),
  entryId: randomUUID(),
  memberId: randomUUID(),
  userId: randomUUID(),
  revisionId: randomUUID(),
});
const blank = (): ParticipantPrivatePayload => ({
  realName: null,
  identityNumber: null,
  portrait: null,
  insurance: null,
  acceptedTerms: false,
  termsVersion: null,
  publicityConsent: false,
});
const pngInput = async (): Promise<ParticipantFileInput> => ({
  fileName: 'private-source.png',
  contentType: 'image/png',
  base64: (
    await sharp({ create: { width: 24, height: 32, channels: 4, background: '#f0c080' } })
      .png()
      .toBuffer()
  ).toString('base64'),
});
const draft = (extra: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  expectedVersion: 0,
  ...extra,
});
const ready = (): ParticipantEligibilityContext => ({
  required: true,
  requireInsurance: true,
  keyAvailable: true,
  bindingActive: true,
  rulesetId: 'rules-current',
  rosterRevisionId: 'roster-current',
  jerseyNo: '00',
  eventStartDate: '2026-11-01',
  eventEndDate: '2026-11-05',
  material: {
    status: 'APPROVED',
    rulesetId: 'rules-current',
    rosterRevisionId: 'roster-current',
    jerseyNo: '00',
    termsVersion: PARTICIPANT_TERMS_VERSION,
    hasIdentity: true,
    hasRealName: true,
    hasPortrait: true,
    hasInsurance: true,
    insuranceStartDate: '2026-11-01',
    insuranceEndDate: '2026-11-05',
    reviewedStartDate: '2026-11-01',
    reviewedEndDate: '2026-11-05',
  },
});
const codes = (context: ParticipantEligibilityContext) =>
  participantEligibility(context).blockers.map((b) => b.code);

describe('participant data encryption and domain separation', () => {
  it('roundtrips private data without plaintext and uses fresh nonces', () => {
    const key = participantKey(Buffer.alloc(32, 7).toString('base64'));
    const aad = resource();
    const payload = { ...blank(), realName: '合成测试球员', identityNumber: syntheticIdentity() };
    const first = encryptParticipantPayload(payload, key, aad);
    const second = encryptParticipantPayload(payload, key, aad);
    expect(first).not.toBe(second);
    expect(first).not.toContain(payload.identityNumber);
    expect(first).not.toContain(payload.realName);
    expect(decryptParticipantPayload(first, key, aad)).toEqual(payload);
  });

  it.each([
    undefined,
    '',
    'secret',
    'A'.repeat(44),
    Buffer.alloc(31).toString('base64'),
    Buffer.alloc(33).toString('base64'),
  ])('rejects missing or noncanonical key without echoing it', (raw) => {
    try {
      participantKey(raw);
      throw new Error('accepted');
    } catch (error) {
      expect(error).toMatchObject({
        status: 503,
        code: 'PARTICIPANT_DATA_UNAVAILABLE',
        message: '本人资料服务暂不可用',
      });
    }
  });

  it('fails identically on wrong keys and authenticated ciphertext changes', () => {
    const key = Buffer.alloc(32, 7),
      aad = resource();
    const envelope = encryptParticipantPayload(blank(), key, aad);
    const parts = envelope.split('.');
    const ciphertext = Buffer.from(parts[4]!, 'base64url');
    ciphertext[0] = ciphertext[0]! ^ 1;
    parts[4] = ciphertext.toString('base64url');
    for (const [value, selectedKey] of [
      [parts.join('.'), key],
      [envelope, Buffer.alloc(32, 8)],
    ] as const)
      expect(() => decryptParticipantPayload(value, selectedKey, aad)).toThrow(
        '本人资料服务暂不可用',
      );
  });

  it.each(['orgId', 'eventId', 'entryId', 'memberId', 'userId', 'revisionId'] as const)(
    'binds ciphertext to exact %s',
    (field) => {
      const key = Buffer.alloc(32, 3),
        aad = resource();
      const envelope = encryptParticipantPayload(blank(), key, aad);
      expect(() =>
        decryptParticipantPayload(envelope, key, { ...aad, [field]: randomUUID() }),
      ).toThrow('本人资料服务暂不可用');
    },
  );

  it('rejects malformed envelope and authenticated incompatible payload', () => {
    const key = Buffer.alloc(32, 3),
      aad = resource();
    expect(() => decryptParticipantPayload('anything', key, aad)).toThrow('本人资料服务暂不可用');
    const envelope = encryptParticipantPayload(
      { ...blank(), acceptedTerms: 'true' } as unknown as ParticipantPrivatePayload,
      key,
      aad,
    );
    expect(() => decryptParticipantPayload(envelope, key, aad)).toThrow('本人资料服务暂不可用');
  });

  it('derives keyed, event-scoped identities and distinct deterministic request fingerprints', () => {
    const key = Buffer.alloc(32, 3),
      other = Buffer.alloc(32, 5),
      org = randomUUID(),
      event = randomUUID();
    const identity = syntheticIdentity();
    expect(participantIdentityDigest(identity, key, org, event)).toBe(
      participantIdentityDigest(identity, key, org, event),
    );
    expect(participantIdentityDigest(identity, key, org, event)).not.toBe(
      participantIdentityDigest(identity, other, org, event),
    );
    expect(participantIdentityDigest(identity, key, org, event)).not.toBe(
      participantIdentityDigest(identity, key, org, randomUUID()),
    );
    expect(participantKeyId(key)).not.toBe(participantKeyId(other));
    const scope = [org, event, 'PUT_DRAFT'];
    expect(participantRequestFingerprint({ a: 1, b: { y: 2, x: true } }, key, scope)).toBe(
      participantRequestFingerprint({ b: { x: true, y: 2 }, a: 1 }, key, scope),
    );
    expect(participantRequestFingerprint({ a: null }, key, scope)).not.toBe(
      participantRequestFingerprint({}, key, scope),
    );
    expect(participantRequestFingerprint({}, key, scope)).not.toBe(
      participantRequestFingerprint({}, key, [...scope, 'another-member']),
    );
  });
});

describe('participant draft validation', () => {
  it('validates synthetic identity checksum and actual birthday without promising real verification', () => {
    const number = syntheticIdentity();
    expect(participantIdentityNumber(` ${number.toLowerCase()} `)).toBe(number);
    expect(maskParticipantIdentity(number)).toBe(
      number.slice(0, 3) + '***********' + number.slice(-4),
    );
    expect(maskParticipantIdentity(null)).toBeNull();
  });

  it.each(['20010229', '20001301', '20000001', '18991231', '20990101'])(
    'rejects impossible/out-of-policy birthday %s',
    (birthday) => {
      const number = syntheticIdentity(birthday);
      expect(() => participantIdentityNumber(number, '2026-10-31')).toThrow('请填写有效身份证号码');
    },
  );

  it('rejects altered checksum or empty serial without returning private number', () => {
    const number = syntheticIdentity();
    expect(() =>
      participantIdentityNumber(number.slice(0, -1) + (number.at(-1) === '0' ? '1' : '0')),
    ).toThrow('请填写有效身份证号码');
    expect(() => participantIdentityNumber(syntheticIdentity('20000229', '000'))).toThrow(
      '请填写有效身份证号码',
    );
  });

  it('preserves omitted versus explicitly cleared fields', () => {
    const parsed = parseParticipantDraft(
      draft({
        identityNumber: null,
        portrait: null,
        insurance: { document: null },
        acceptedTerms: false,
      }),
    );
    expect(parsed.identityNumber).toBeNull();
    expect(parsed.portrait).toBeNull();
    expect(parsed).not.toHaveProperty('realName');
    expect(parsed.insurance).toEqual({ document: null });
    expect(parsed.acceptedTerms).toBe(false);
  });

  it.each([
    { clientRequestId: 'not-a-request' },
    { clientRequestId: randomUUID().toUpperCase() },
    { expectedVersion: -1 },
    { expectedVersion: 0.1 },
    { expectedVersion: 2147483648 },
    { acceptedTerms: 'true' },
    { publicityConsent: 1 },
    { ownerUserId: randomUUID() },
    { insurance: { unknown: 'ignored?' } },
    { insurance: { startDate: '2026-11-10', endDate: '2026-11-01' } },
  ])('rejects invalid/unexpected fields', (fields) =>
    expect(() => parseParticipantDraft(draft(fields))).toThrow(),
  );

  it('requires explicit manual review acknowledgments rather than truthy coercion', () => {
    expect(() =>
      parseParticipantReview({
        expectedVersion: 1,
        decision: 'APPROVE',
        reason: '已核对',
        identityChecked: 'true',
      }),
    ).toThrow();
    expect(
      parseParticipantReview({
        expectedVersion: 2,
        decision: 'REQUEST_CHANGES',
        reason: '照片遮挡',
      }),
    ).toMatchObject({
      expectedVersion: 2,
      identityChecked: false,
      portraitChecked: false,
      insuranceChecked: false,
    });
  });
});

describe('safe participant files and merging', () => {
  it('fully decodes PNG and emits one bounded metadata-free JPEG with a nonprivate name', async () => {
    const source = await pngInput();
    const result = await sanitizeParticipantFile(source, 'portrait');
    const metadata = await sharp(Buffer.from(result.base64, 'base64')).metadata();
    expect(result.fileName).toBe('portrait.jpg');
    expect(result.contentType).toBe('image/jpeg');
    expect(result.byteLength).toBe(Buffer.from(result.base64, 'base64').length);
    expect(metadata).toMatchObject({ format: 'jpeg', width: 24, height: 32 });
    for (const field of ['exif', 'icc', 'xmp', 'iptc', 'orientation'])
      expect(metadata).not.toHaveProperty(field);
  });

  it('applies orientation then strips EXIF and XMP, including location-like source metadata', async () => {
    const bytes = await sharp({
      create: { width: 18, height: 27, channels: 3, background: '#f0c080' },
    })
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { ImageDescription: 'private location data' } },
      })
      .toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const result = await sanitizeParticipantFile(
      { fileName: 'private.jpg', contentType: 'image/jpeg', base64: bytes.toString('base64') },
      'portrait',
    );
    const safe = Buffer.from(result.base64, 'base64');
    expect(safe.toString('latin1')).not.toContain('private location data');
    const metadata = await sharp(safe).metadata();
    expect(metadata).toMatchObject({ width: 27, height: 18 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it('rejects apparently structured PNG whose compressed pixels cannot be decoded', async () => {
    const bytes = Buffer.from((await pngInput()).base64, 'base64');
    const idat = bytes.indexOf(Buffer.from('IDAT'));
    bytes[idat + 4] = bytes[idat + 4]! ^ 0xff;
    await expect(
      sanitizeParticipantFile(
        { fileName: 'fake.png', contentType: 'image/png', base64: bytes.toString('base64') },
        'portrait',
      ),
    ).rejects.toThrow('图片无法完整读取');
  });

  it('rejects portrait PDF, extension mismatches, paths, noncanonical bytes and empty files', async () => {
    const pdf = Buffer.from('%PDF-1.7\nsynthetic\n%%EOF').toString('base64');
    expect(() =>
      parseParticipantDraft(
        draft({ portrait: { fileName: 'x.pdf', contentType: 'application/pdf', base64: pdf } }),
      ),
    ).toThrow('本人照片仅支持JPEG或PNG');
    const png = await pngInput();
    for (const wrong of [
      { ...png, fileName: '../photo.png' },
      { ...png, fileName: 'photo.jpg' },
      { ...png, base64: png.base64 + '\n' },
      { ...png, base64: '' },
    ])
      expect(() => parseParticipantDraft(draft({ portrait: wrong }))).toThrow();
  });

  it('retains private PDF bytes only as an insurance download attachment', async () => {
    const bytes = Buffer.from('%PDF-1.7\nsynthetic test proof\n%%EOF');
    const proof = await sanitizeParticipantFile(
      {
        fileName: 'private-policy.pdf',
        contentType: 'application/pdf',
        base64: bytes.toString('base64'),
      },
      'insurance',
    );
    expect(proof).toMatchObject({
      fileName: 'insurance.pdf',
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
    });
  });

  it('preserves omitted fields and invalidates implicit consent for a replacement portrait', async () => {
    const image = await pngInput();
    const old = await mergeParticipantDraft(
      null,
      parseParticipantDraft(
        draft({
          realName: '合成球员',
          identityNumber: syntheticIdentity(),
          portrait: image,
          acceptedTerms: true,
          publicityConsent: true,
        }),
      ),
    );
    const unchanged = await mergeParticipantDraft(
      old,
      parseParticipantDraft(draft({ realName: '新合成名称' })),
    );
    expect(unchanged.identityNumber).toBe(old.identityNumber);
    expect(unchanged.portrait).toEqual(old.portrait);
    expect(unchanged.publicityConsent).toBe(true);
    const replaced = await mergeParticipantDraft(
      old,
      parseParticipantDraft(draft({ portrait: image })),
    );
    expect(replaced.publicityConsent).toBe(false);
    expect(old.publicityConsent).toBe(true);
    const cleared = await mergeParticipantDraft(
      old,
      parseParticipantDraft(draft({ portrait: null, acceptedTerms: false })),
    );
    expect(cleared.portrait).toBeNull();
    expect(cleared.publicityConsent).toBe(false);
    expect(cleared.termsVersion).toBeNull();
  });

  it('rechecks insurance period after merging a partial update', async () => {
    const old = {
      ...blank(),
      insurance: {
        insurer: '合成保险机构',
        policyNumber: 'SYNTHETIC-POLICY',
        startDate: '2026-11-01',
        endDate: '2026-11-05',
        document: null,
      },
    };
    await expect(
      mergeParticipantDraft(
        old,
        parseParticipantDraft(draft({ insurance: { startDate: '2026-11-06' } })),
      ),
    ).rejects.toThrow('保单结束日期不能早于开始日期');
    expect(old.insurance.startDate).toBe('2026-11-01');
  });
});

describe('current participant qualification gates', () => {
  it('accepts exact approved current material including boundary insurance dates', () =>
    expect(participantEligibility(ready())).toEqual({ eligible: true, blockers: [] }));

  it('does not impose new participant requirements on legacy rules', () =>
    expect(
      participantEligibility({
        ...ready(),
        required: false,
        keyAvailable: false,
        bindingActive: false,
        material: null,
      }),
    ).toEqual({ eligible: true, blockers: [] }));

  it('does not let approval substitute for missing signature, photo or identity', () => {
    const context = ready();
    Object.assign(context.material!, {
      hasPortrait: false,
      hasIdentity: false,
      termsVersion: null,
    });
    expect(codes(context)).toEqual(
      expect.arrayContaining(['PORTRAIT_REQUIRED', 'IDENTITY_REQUIRED', 'TERMS_REQUIRED']),
    );
  });

  it.each(['rulesetId', 'rosterRevisionId', 'jerseyNo'] as const)(
    'invalidates an approved snapshot after %s changes',
    (field) => {
      const context = ready();
      context.material![field] = 'old';
      expect(codes(context)).toContain('MATERIALS_OUTDATED');
    },
  );

  it('requires current binding and usable encryption key even when the old record was approved', () =>
    expect(codes({ ...ready(), keyAvailable: false, bindingActive: false })).toEqual(
      expect.arrayContaining(['PARTICIPANT_DATA_UNAVAILABLE', 'BINDING_REQUIRED']),
    ));

  it('requires a saved record rather than upload selection or payment', () =>
    expect(codes({ ...ready(), material: null })).toContain('MATERIALS_REQUIRED'));

  it.each(['DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED'] as const)(
    'blocks final qualification for %s',
    (status) => {
      const context = ready();
      context.material!.status = status;
      expect(participantEligibility(context).eligible).toBe(false);
      expect(participantEligibility({ ...context, requireApproval: false }).eligible).toBe(true);
    },
  );

  it('rejects expired/insufficient insurance even if someone previously approved it', () => {
    const context = ready();
    context.material!.insuranceEndDate = '2026-11-04';
    expect(codes(context)).toContain('INSURANCE_PERIOD_INVALID');
    context.material!.hasInsurance = false;
    expect(codes(context)).toContain('INSURANCE_REQUIRED');
  });

  it('invalidates date-bound approval after rescheduling, without blocking fresh review itself', () => {
    const context = ready();
    context.eventEndDate = '2026-11-04';
    expect(codes(context)).toContain('REVIEW_OUTDATED');
    expect(participantEligibility({ ...context, requireApproval: false }).eligible).toBe(true);
  });

  it('blocks a purged private revision instead of reviving old approval', () => {
    const context = ready();
    context.material!.purged = true;
    expect(codes(context)).toContain('MATERIALS_EXPIRED');
  });

  it('does not couple eligibility to publicity permission or nonexistent payment facts', () => {
    const context = ready();
    expect(
      participantEligibility({
        ...context,
        material: {
          ...context.material!,
          publicityConsent: false,
          paymentSucceeded: false,
        } as typeof context.material,
      }).eligible,
    ).toBe(true);
  });
});
