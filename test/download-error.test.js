const test = require('node:test');
const assert = require('node:assert/strict');

test('network download failures suggest configuring a proxy or VPN', async () => {
  const { suggestsProxy } = await import('../renderer/catalog/download-error.ts');

  for (const error of [
    'download timeout',
    'The operation was aborted due to timeout',
    'UND_ERR_CONNECT_TIMEOUT',
    'getaddrinfo ENOTFOUND raw.githubusercontent.com',
    'ECONNREFUSED',
  ]) {
    assert.equal(suggestsProxy(error), true, error);
  }
});

test('non-network download failures do not suggest a proxy or VPN', async () => {
  const { suggestsProxy } = await import('../renderer/catalog/download-error.ts');

  for (const error of ['checksum mismatch', 'not enough disk space', 'Dota 2 is running']) {
    assert.equal(suggestsProxy(error), false, error);
  }
});
