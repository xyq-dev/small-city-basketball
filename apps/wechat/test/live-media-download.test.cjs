const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient, API_ORIGIN } = require('../utils/api');
const id = '11111111-1111-4111-8111-111111111111';
const path = `/v1/orgs/${id}/broadcasts/${id}/media/artifacts/${id}/content`;
function fixture() {
  let callback,
    headers,
    aborted = false;
  const removed = [];
  const client = createClient({
    downloadFile(options) {
      callback = options;
      return {
        onHeadersReceived(fn) {
          headers = fn;
        },
        abort() {
          aborted = true;
        },
      };
    },
    getFileSystemManager() {
      return {
        unlink({ filePath }) {
          removed.push(filePath);
        },
      };
    },
  });
  return {
    client,
    removed,
    get callback() {
      return callback;
    },
    get aborted() {
      return aborted;
    },
    headers(mime) {
      headers({ header: { 'Content-Type': mime } });
    },
    done(statusCode = 200) {
      callback.success({ statusCode, tempFilePath: 'wxfile://tmp/recording.mp4' });
    },
  };
}
test('long recordings use native file download at the fixed private endpoint', async () => {
  const f = fixture();
  const pending = f.client.downloadLiveMedia(path);
  assert.equal(f.callback.url, API_ORIGIN + path);
  assert.equal(f.callback.timeout, 120000);
  f.headers('video/mp4');
  f.done();
  assert.deepEqual(await pending, { tempFilePath: 'wxfile://tmp/recording.mp4' });
  assert.deepEqual(f.removed, []);
});
test('account changes clear late temporary recordings', async () => {
  const f = fixture();
  const pending = f.client.downloadLiveMedia(path);
  f.headers('video/mp4');
  f.client.clearSession();
  f.done();
  await assert.rejects(pending, { code: 'SESSION_CHANGED' });
  assert.deepEqual(f.removed, ['wxfile://tmp/recording.mp4']);
});
test('wrong MIME aborts and deletes any late temporary file', async () => {
  const f = fixture();
  const pending = f.client.downloadLiveMedia(path);
  f.headers('text/html');
  assert.equal(f.aborted, true);
  f.done();
  await assert.rejects(pending, { code: 'FILE_UNAVAILABLE' });
  assert.equal(f.removed.length, 1);
});
test('a revoked download deletes its temporary file and foreign paths never start', async () => {
  const f = fixture();
  const pending = f.client.downloadLiveMedia(path);
  f.headers('video/mp4');
  f.done(403);
  await assert.rejects(pending, { code: 'FILE_UNAVAILABLE' });
  assert.equal(f.removed.length, 1);
  await assert.rejects(f.client.downloadLiveMedia('https://foreign.invalid/content'), {
    code: 'INVALID_PATH',
  });
});
