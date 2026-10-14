const test = require('node:test');
const assert = require('node:assert/strict');

const load = async () => import('../renderer/catalog/download-error.ts');

test('recognises timeout, DNS, connection, and socket failures', async () => {
  const { isNetworkDownloadError } = await load();
  for (const message of ['download timeout', 'ETIMEDOUT', 'getaddrinfo ENOTFOUND host', 'ECONNRESET', 'socket hang up', 'fetch failed']) {
    assert.equal(isNetworkDownloadError(message), true, message);
  }
});

test('does not classify HTTP, checksum, or cancellation messages as network failures', async () => {
  const { isNetworkDownloadError } = await load();
  for (const message of ['HTTP 404', 'checksum mismatch', 'cancelled by user', 'archive is damaged']) {
    assert.equal(isNetworkDownloadError(message), false, message);
  }
});
