const api = require('./api');
const materials = require('./participant-materials');
const KEY = 'scb.e08.pending.v1';
const names = {
  INVITED: '待监护人确认必要资料处理',
  CONSENTED: '监护人已同意必要资料处理',
  DECLINED: '监护人已拒绝',
  AWAITING_GUARDIAN: '待监护人独立确认',
  AWAITING_REVIEW: '待独立关系审核',
  APPROVED: '监护关系审核通过',
  REJECTED: '审核未通过',
  WITHDRAWN: '已撤回',
};
const purposes = ['PARTICIPATION', 'PUBLICITY', 'PUBLIC_ARCHIVE', 'LIVE_RECORDING'];
const purposeNames = {
  PARTICIPATION: '本届参赛',
  PUBLICITY: '照片宣传',
  PUBLIC_ARCHIVE: '公开档案',
  LIVE_RECORDING: '直播、录像与集锦',
};
const blockerNames = {
  GUARDIAN_SOURCE_CHANGED: '本人资料、资格预审、名单或监护确认已变化，请重新核验。',
  GUARDIAN_INDEPENDENT_REVIEW_REQUIRED: '需要独立监护关系核验。',
  GUARDIAN_PURPOSE_CONSENT_REQUIRED: '本人及监护人须分别确认该用途。',
};
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const bool = (v) => typeof v === 'boolean';
function invalid() {
  throw new Error('监护资料返回不完整，请重新读取');
}
function requestView(v) {
  if (
    !object(v) ||
    !names[v.status] ||
    !['SUBJECT', 'GUARDIAN', 'REVIEWER'].includes(v.role) ||
    !Number.isInteger(v.version) ||
    v.version < 1 ||
    !bool(v.current) ||
    !object(v.capabilities) ||
    !['canConfirm', 'canReview', 'canWithdraw', 'canReadProof'].every((k) =>
      bool(v.capabilities[k]),
    ) ||
    !Array.isArray(v.blockers) ||
    !v.blockers.every((x) => typeof x === 'string') ||
    ![v.subjectPurposes, v.guardianPurposes].every(
      (p) => Array.isArray(p) && p.every((s) => purposes.includes(s)),
    )
  )
    invalid();
  return {
    id: materials.id(v.id),
    orgId: materials.id(v.orgId),
    eventId: materials.id(v.eventId),
    entryId: materials.id(v.entryId),
    memberId: materials.id(v.memberId),
    eventName: String(v.eventName),
    subjectName: String(v.subjectName),
    guardianName: String(v.guardianName),
    status: v.status,
    statusLabel: names[v.status],
    version: v.version,
    role: v.role,
    current: v.current,
    reviewReason: typeof v.reviewReason === 'string' ? v.reviewReason : '',
    blockerText: v.blockers.map((code) => blockerNames[code] || '当前授权需重新核验。').join('；'),
    subjectPurposeText: v.subjectPurposes.map((p) => purposeNames[p]).join('、') || '尚未确认',
    guardianPurposeText: v.guardianPurposes.map((p) => purposeNames[p]).join('、') || '尚未确认',
    subjectPurposes: v.subjectPurposes.slice(),
    guardianPurposes: v.guardianPurposes.slice(),
    capabilities: Object.fromEntries(
      ['canConfirm', 'canReview', 'canWithdraw', 'canReadProof'].map((k) => [k, v.capabilities[k]]),
    ),
  };
}
function preView(v) {
  if (
    !object(v) ||
    !['INVITED', 'CONSENTED', 'DECLINED', 'WITHDRAWN'].includes(v.status) ||
    !['SUBJECT', 'GUARDIAN'].includes(v.role) ||
    !Number.isInteger(v.version) ||
    v.version < 1
  )
    invalid();
  return {
    id: materials.id(v.id),
    orgId: materials.id(v.orgId),
    eventId: materials.id(v.eventId),
    eventName: String(v.eventName),
    subjectAlias: String(v.subjectAlias),
    guardianName: String(v.guardianName),
    status: v.status,
    statusLabel: names[v.status],
    version: v.version,
    role: v.role,
    dataTermsVersion: 'youth-data-processing-v1',
  };
}
function policyView(v) {
  const p = v?.policy;
  if (
    !object(p) ||
    !bool(p.enabled) ||
    !Number.isInteger(p.version) ||
    !Number.isInteger(p.guardianAgeThreshold) ||
    p.guardianAgeThreshold < 18 ||
    p.guardianAgeThreshold > 21 ||
    p.termsVersion !== 'youth-participation-v1' ||
    !object(v.capabilities)
  )
    invalid();
  return {
    eventName: String(v.event?.name || ''),
    enabled: p.enabled,
    version: p.version,
    guardianAgeThreshold: p.guardianAgeThreshold,
    termsVersion: p.termsVersion,
    canConfigure: v.capabilities.canConfigure === true,
    canInviteData: v.capabilities.canInviteData === true,
  };
}
function adultView(v) {
  if (
    !object(v) ||
    !Number.isInteger(v.expectedMaterialVersion) ||
    v.expectedMaterialVersion < 1 ||
    !Number.isInteger(v.expectedAdultVersion) ||
    v.expectedAdultVersion < 0 ||
    !Number.isInteger(v.policyVersion) ||
    v.policyVersion < 0 ||
    !bool(v.canConsent) ||
    !bool(v.canWithdraw) ||
    ![null, 'CONSENT', 'WITHDRAW'].includes(v.lastDecision) ||
    v.termsVersion !== 'youth-adult-data-processing-v1' ||
    (v.canConsent && (v.policyVersion < 1 || v.evidenceQualificationId === null)) ||
    (v.canWithdraw && (v.lastDecision !== 'CONSENT' || v.expectedAdultVersion < 1))
  )
    invalid();
  const scope = {
    orgId: materials.id(v.orgId),
    eventId: materials.id(v.eventId),
    entryId: materials.id(v.entryId),
    memberId: materials.id(v.memberId),
  };
  return {
    ...scope,
    key: [scope.orgId, scope.eventId, scope.entryId, scope.memberId].join(':'),
    eventName: String(v.eventName),
    expectedMaterialVersion: v.expectedMaterialVersion,
    expectedAdultVersion: v.expectedAdultVersion,
    policyVersion: v.policyVersion,
    evidenceQualificationId:
      v.evidenceQualificationId === null ? null : materials.id(v.evidenceQualificationId),
    termsVersion: v.termsVersion,
    canConsent: v.canConsent,
    canWithdraw: v.canWithdraw,
    lastDecision: v.lastDecision,
    blocker: typeof v.blocker === 'string' ? v.blocker : '',
  };
}
const query = (cursor) =>
  cursor ? '?cursor=' + encodeURIComponent(cursor) + '&limit=20' : '?limit=20';
function repository(orgId, eventId, client = api.getClient()) {
  const base =
    orgId && eventId
      ? '/v1/orgs/' + materials.id(orgId) + '/events/' + materials.id(eventId)
      : null;
  const get = async (path) => (await client.request(path)).data;
  const command = async (path, method, body) => {
    const d = (await client.request(path, method, body, false, 120000)).data;
    if (!object(d)) invalid();
    return d;
  };
  return {
    workspace: async (cursor) => {
      const d = await get('/v1/me/youth-guardians' + query(cursor));
      if (
        !Array.isArray(d?.requests) ||
        !Array.isArray(d.preconsents) ||
        (d.adultDataScopes !== undefined && !Array.isArray(d.adultDataScopes)) ||
        (d.nextCursor !== null && typeof d.nextCursor !== 'string')
      )
        invalid();
      return {
        requests: d.requests.map(requestView),
        preconsents: d.preconsents.map(preView),
        adultDataScopes: (d.adultDataScopes || []).map(adultView),
        nextCursor: d.nextCursor,
      };
    },
    queue: async (cursor) => {
      const d = await get(base + '/youth-guardian-requests' + query(cursor));
      if (
        !Array.isArray(d?.requests) ||
        (d.nextCursor !== null && typeof d.nextCursor !== 'string')
      )
        invalid();
      return { requests: d.requests.map(requestView), nextCursor: d.nextCursor };
    },
    policy: async () => policyView(await get(base + '/youth-policy')),
    adultCapability: async (scope) => {
      const target =
        '/v1/orgs/' +
        materials.id(scope.orgId) +
        '/events/' +
        materials.id(scope.eventId) +
        '/youth-adult-data-consent';
      const current = adultView(
        await get(
          target +
            '?entryId=' +
            materials.id(scope.entryId) +
            '&memberId=' +
            materials.id(scope.memberId),
        ),
      );
      if (
        ['orgId', 'eventId', 'entryId', 'memberId'].some(
          (key) => current[key] !== materials.id(scope[key]),
        )
      )
        invalid();
      return current;
    },
    adultData: (scope, body) =>
      command(
        '/v1/orgs/' +
          materials.id(scope.orgId) +
          '/events/' +
          materials.id(scope.eventId) +
          '/youth-adult-data-consent',
        'POST',
        body,
      ),
    detail: async (id) => requestView(await get('/v1/youth-guardian-requests/' + materials.id(id))),
    private: async (id) => {
      const d = await get('/v1/youth-guardian-requests/' + materials.id(id) + '/private');
      if (
        !object(d) ||
        !object(d.proof) ||
        !['PARENT', 'LEGAL_GUARDIAN'].includes(d.relationship) ||
        typeof d.identityNumber !== 'string'
      )
        invalid();
      return {
        realName: String(d.realName),
        identityNumber: d.identityNumber,
        relationship: d.relationship,
        relationshipExplanation: String(d.relationshipExplanation),
        proof: {
          fileName: String(d.proof.fileName),
          contentType: d.proof.contentType,
          byteLength: d.proof.byteLength,
        },
      };
    },
    download: (id) => client.download('/v1/youth-guardian-requests/' + materials.id(id) + '/proof'),
    receipt: async (id) => {
      const d = await get('/v1/me/youth-guardian-commands/' + materials.id(id));
      if (!object(d) || !bool(d.found)) invalid();
      return { found: d.found };
    },
    configure: (body) => command(base + '/youth-policy', 'PUT', body),
    invite: (body) => command(base + '/youth-data-invitations', 'POST', body),
    propose: (body) => command(base + '/youth-guardian-requests', 'POST', body),
    data: (id, body) =>
      command('/v1/youth-data-invitations/' + materials.id(id) + '/commands', 'POST', body),
    act: (id, action, body) => {
      if (!['confirm', 'review', 'withdraw'].includes(action)) throw new Error('操作入口无效');
      return command(
        '/v1/youth-guardian-requests/' + materials.id(id) + '/' + action,
        'POST',
        body,
      );
    },
  };
}
function readPending(wxApi, userId) {
  const value = wxApi.getStorageSync(KEY + ':' + materials.id(userId));
  if (value === undefined || value === null || value === '') return null;
  if (!object(value) || Object.keys(value).sort().join(',') !== 'clientRequestId,userId')
    throw new Error('原请求保护记录损坏，请修复本机存储后继续');
  materials.id(value.userId);
  materials.id(value.clientRequestId);
  return value.userId === userId ? value : null;
}
function writePending(wxApi, record) {
  try {
    wxApi.setStorageSync(KEY + ':' + materials.id(record.userId), record);
    return (
      JSON.stringify(wxApi.getStorageSync(KEY + ':' + materials.id(record.userId))) ===
      JSON.stringify(record)
    );
  } catch {
    return false;
  }
}
function clearPending(wxApi, record) {
  try {
    const key = KEY + ':' + materials.id(record.userId);
    const stored = wxApi.getStorageSync(key);
    if (stored?.userId !== record.userId || stored?.clientRequestId !== record.clientRequestId)
      return false;
    wxApi.removeStorageSync(key);
    return !wxApi.getStorageSync(key);
  } catch {
    return false;
  }
}
module.exports = { repository, requestView, readPending, writePending, clearPending };
