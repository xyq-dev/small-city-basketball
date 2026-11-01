// The shared API allowlist calls this predicate; no free-form endpoints are accepted.
function trainingPathAllowed(base, method, query, uuidPattern) {
  if (Object.keys(query).length) return false;
  const match = (p) => new RegExp('^' + p + '$', 'i').test(base),
    root = '/v1/training',
    org = '/v1/orgs/' + uuidPattern + '/training';
  if (method === 'GET')
    return (
      [root + '/catalog', root + '/mine'].includes(base) ||
      match(root + '/(cohorts|enrollments|receipts)/' + uuidPattern) ||
      match(root + '/sessions/' + uuidPattern + '/roster') ||
      match(root + '/entitlements/' + uuidPattern + '/makeup-options') ||
      match(org)
    );
  if (method !== 'POST') return false;
  return (
    match(root + '/cohorts/' + uuidPattern + '/enrollments') ||
    match(root + '/enrollments/' + uuidPattern + '/refunds') ||
    match(
      root +
        '/(cohorts|enrollments|entitlements|sessions|consumptions|refunds|coaches)/' +
        uuidPattern +
        '/commands',
    ) ||
    match(org + '/(provider|provider/commands|coaches|courses|cohorts)')
  );
}
module.exports = { trainingPathAllowed };
