function eventServicePathAllowed(base, method, query, uuid) {
  if (!query || Object.keys(query).length) return false;
  const org = uuid;
  const order = uuid;
  if (method === 'GET' && new RegExp('^/v1/orgs/' + org + '/commerce$', 'i').test(base))
    return true;
  if (method === 'GET' && new RegExp('^/v1/orgs/' + org + '/software-membership$', 'i').test(base))
    return true;
  if (method === 'POST' && new RegExp('^/v1/orgs/' + org + '/commerce/orders$', 'i').test(base))
    return true;
  if (
    method === 'POST' &&
    new RegExp('^/v1/orgs/' + org + '/commerce/orders/' + order + '/commands$', 'i').test(base)
  )
    return true;
  return false;
}

module.exports = { eventServicePathAllowed };
