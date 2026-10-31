const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../utils/api');
const org = '/v1/orgs/11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222';
test('X03 template and optimization routes admit only their exact private method', () => {
  const routes = [
    ['GET', org + '/event-templates'],
    ['POST', org + '/event-template-commands'],
    ['GET', org + '/event-template-commands/' + id],
    ['GET', org + '/events/' + id + '/setup-guide'],
    ['POST', org + '/schedule-revisions/' + id + '/optimization-preview'],
    ['POST', org + '/events/' + id + '/knockout-optimization-preview'],
    ['POST', org + '/events/' + id + '/group-optimization-preview'],
  ];
  for (const [method, path] of routes) {
    assert.equal(api.pathAllowed(path, method), true, path);
    for (const wrong of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => m !== method))
      assert.equal(api.pathAllowed(path, wrong), false, path + ' ' + wrong);
    assert.equal(api.pathAllowed(path + '?actorId=' + id, method), false);
  }
});
test('anonymous transport refuses private template and guide lanes before touching wx', async () => {
  let requests = 0;
  const client = api.createClient({
    request() {
      requests++;
      throw new Error('Network must remain unused');
    },
  });
  for (const path of [
    org + '/event-templates',
    org + '/event-template-commands/' + id,
    org + '/events/' + id + '/setup-guide',
  ])
    await assert.rejects(client.requestPublic(path), (error) => error.code === 'INVALID_PATH');
  assert.equal(requests, 0);
});
