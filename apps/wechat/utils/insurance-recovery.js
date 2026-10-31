const api = require('./api');
const prefix = 'scb-insurance-command-v1:';
function valid(v) {
  if (
    !v ||
    !['QUOTE', 'PURCHASE', 'COMMAND', 'QUAL_REQUEST', 'QUAL_REVIEW'].includes(v.kind) ||
    typeof v.path !== 'string' ||
    !v.body ||
    Array.isArray(v.body)
  )
    return false;
  try {
    api.uuid(v.body.clientRequestId);
  } catch {
    return false;
  }
  const id = '[0-9a-f-]{36}',
    base = '/v1/orgs/' + id + '/entries/' + id + '/qualification-precheck';
  const paths = {
    QUOTE: /^\/v1\/insurance\/quotes$/,
    PURCHASE: /^\/v1\/insurance\/purchases$/,
    COMMAND: new RegExp('^/v1/insurance/orders/' + id + '/commands$'),
    QUAL_REQUEST: new RegExp('^' + base + '/requests$'),
    QUAL_REVIEW: new RegExp('^' + base + '/reviews$'),
  };
  const fields = {
    QUOTE: ['clientRequestId', 'entryId', 'memberId', 'productId'],
    PURCHASE: ['clientRequestId', 'quoteId', 'acceptedTermsVersion'],
    COMMAND: ['clientRequestId', 'expectedVersion', 'type'],
    QUAL_REQUEST: [
      'clientRequestId',
      'memberId',
      'expectedMaterialVersion',
      'acceptedTermsVersion',
    ],
    QUAL_REVIEW: [
      'clientRequestId',
      'memberId',
      'requestId',
      'expectedMaterialVersion',
      'decision',
      'reason',
      'identityReviewed',
      'portraitReviewed',
      'signatureReviewed',
    ],
  };
  if (
    !paths[v.kind].test(v.path) ||
    Object.keys(v.body).sort().join() !== fields[v.kind].sort().join()
  )
    return false;
  return Object.values(v.body).every(
    (x) =>
      typeof x === 'boolean' ||
      (typeof x === 'number' && Number.isSafeInteger(x) && x > 0) ||
      (typeof x === 'string' && x.length <= 500 && !/[0-9]{17}[0-9Xx]/.test(x)),
  );
}
function key(actor) {
  return prefix + api.uuid(actor);
}
function read(actor) {
  const v = wx.getStorageSync(key(actor));
  if (!v) return null;
  if (!valid(v)) throw Error('保险恢复记录损坏，请保留原编号并联系主办方核对');
  return JSON.parse(JSON.stringify(v));
}
function save(actor, v) {
  if (read(actor)) throw Error('请先核对原请求，不要创建重复投保');
  if (!valid(v)) throw Error('保险请求不完整');
  wx.setStorageSync(key(actor), JSON.parse(JSON.stringify(v)));
}
function clear(actor, v) {
  const current = read(actor);
  if (current && JSON.stringify(current) === JSON.stringify(v)) wx.removeStorageSync(key(actor));
}
function receipt(v) {
  if (v.kind.startsWith('QUAL_'))
    return (
      v.path.replace(/\/(requests|reviews)$/, '') +
      '/requests/' +
      v.body.clientRequestId +
      '/receipt'
    );
  return '/v1/insurance/requests/' + v.body.clientRequestId;
}
module.exports = { valid, read, save, clear, receipt };
