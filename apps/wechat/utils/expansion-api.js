// Exact native client paths for the eight commercial expansion features.
function expansionPathAllowed(base, method, query, uuidPattern) {
  const noQuery = Object.keys(query).length === 0;
  const keys = (...names) => Object.keys(query).every((key) => names.includes(key));
  const match = (path) => new RegExp('^' + path + '$', 'i').test(base);
  const uuid = (value) => new RegExp('^' + uuidPattern + '$', 'i').test(value || '');
  const org = '/v1/orgs/' + uuidPattern;
  const event = org + '/events/' + uuidPattern;
  const order = '/v1/trades/orders/' + uuidPattern;
  if (['/v1/account-closure/capabilities', '/v1/account-closure/me'].includes(base))
    return method === 'GET' && noQuery;
  if (['/v1/account-closure/requests', '/v1/account-closure/cancel'].includes(base))
    return method === 'POST' && noQuery;
  if (['/v1/insurance', '/v1/insurance/capabilities'].includes(base))
    return method === 'GET' && noQuery;
  if (
    match('/v1/insurance/(requests|orders)/' + uuidPattern) ||
    match('/v1/insurance/orders/' + uuidPattern + '/checkout')
  )
    return method === 'GET' && noQuery;
  if (
    ['/v1/insurance/quotes', '/v1/insurance/purchases'].includes(base) ||
    match('/v1/insurance/orders/' + uuidPattern + '/commands')
  )
    return method === 'POST' && noQuery;
  const precheck = org + '/entries/' + uuidPattern + '/qualification-precheck';
  if (match(precheck) || match(precheck + '/requests/' + uuidPattern + '/receipt'))
    return method === 'GET' && noQuery;
  if (match(precheck + '/(requests|reviews)')) return method === 'POST' && noQuery;
  if (base === '/v1/me/notifications') return method === 'GET' && keys('cursor');
  if (
    base === '/v1/me/notifications/settings' ||
    match('/v1/me/notifications/intents/' + uuidPattern)
  )
    return method === 'GET' && noQuery;
  if (
    [
      '/v1/me/notifications/intents',
      '/v1/me/notifications/confirmations',
      '/v1/me/notifications/subscriptions/revoke',
    ].includes(base) ||
    match('/v1/me/notifications/' + uuidPattern + '/(read|retry)')
  )
    return method === 'POST' && noQuery;
  if (base === '/v1/me/youth-guardians' || match(event + '/youth-guardian-requests'))
    return (
      (method === 'GET' && keys('cursor', 'limit')) ||
      (base !== '/v1/me/youth-guardians' && method === 'POST' && noQuery)
    );
  if (
    match('/v1/me/youth-guardian-commands/' + uuidPattern) ||
    match('/v1/youth-guardian-requests/' + uuidPattern + '(?:/private)?')
  )
    return method === 'GET' && noQuery;
  if (match(event + '/youth-policy')) return ['GET', 'PUT'].includes(method) && noQuery;
  if (match(event + '/youth-adult-data-consent'))
    return (
      (method === 'GET' &&
        keys('entryId', 'memberId') &&
        uuid(query.entryId) &&
        uuid(query.memberId)) ||
      (method === 'POST' && noQuery)
    );
  if (
    match(event + '/youth-data-invitations') ||
    match('/v1/youth-data-invitations/' + uuidPattern + '/commands') ||
    match('/v1/youth-guardian-requests/' + uuidPattern + '/(confirm|review|withdraw|purge)')
  )
    return method === 'POST' && noQuery;
  if (base === '/v1/trades/source')
    return (
      method === 'GET' &&
      keys('kind', 'sourceId') &&
      ['ENTRY_FEE', 'ENTRY_DEPOSIT', 'LOCAL_BOOKING', 'PLAYER_APPEARANCE'].includes(query.kind) &&
      uuid(query.sourceId)
    );
  if (base === '/v1/trades/orders')
    return (
      (method === 'GET' && keys('orgId') && (!query.orgId || uuid(query.orgId))) ||
      (method === 'POST' && noQuery)
    );
  if (['/v1/trades/preview', '/v1/trades/quote'].includes(base))
    return method === 'POST' && noQuery;
  if (match(order) || match('/v1/trades/receipts/' + uuidPattern))
    return method === 'GET' && noQuery;
  if (
    match(order + '/(payments|refunds|deductions|settlements)') ||
    match(order + '/payments/' + uuidPattern + '/query') ||
    match(order + '/reviews/(REFUND|DEDUCTION|SETTLEMENT)/' + uuidPattern) ||
    match(order + '/refunds/' + uuidPattern + '/(dispatch|query)') ||
    match(order + '/settlements/' + uuidPattern + '/(dispatch|query|return|return-query)')
  )
    return method === 'POST' && noQuery;
  const terms = '/v1/trades/orgs/' + uuidPattern + '/terms';
  if (match(terms)) return ['GET', 'POST'].includes(method) && noQuery;
  if (
    match(terms + '/' + uuidPattern + '/review') ||
    match('/v1/trades/orgs/' + uuidPattern + '/reconcile')
  )
    return method === 'POST' && noQuery;
  if (
    match(org + '/streaming-channels') ||
    match(org + '/matches/' + uuidPattern + '/streaming') ||
    match(org + '/matches/' + uuidPattern + '/streaming/receipts/' + uuidPattern) ||
    match(org + '/broadcasts/' + uuidPattern + '/media')
  )
    return method === 'GET' && noQuery;
  if (
    match(org + '/streaming-channels/commands') ||
    match(org + '/matches/' + uuidPattern + '/streaming/commands') ||
    match(org + '/broadcasts/' + uuidPattern + '/media/commands')
  )
    return method === 'POST' && noQuery;
  return false;
}
module.exports = { expansionPathAllowed };
