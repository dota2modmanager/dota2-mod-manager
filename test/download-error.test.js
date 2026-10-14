import test from 'node:test';
import assert from 'node:assert/strict';

import { isNetworkDownloadError } from '../renderer/catalog/download-error.ts';

test('recognises timeout, DNS, connection, and socket failures', () => {
  for (const message of ['download timeout', 'ETIMEDOUT', 'getaddrinfo ENOTFOUND host', 'ECONNRESET', 'socket hang up', 'fetch failed']) {
    assert.equal(isNetworkDownloadError(message), true, message);
  }
});

test('does not classify HTTP, checksum, or cancellation messages as network failures', () => {
  for (const message of ['HTTP 404', 'checksum mismatch', 'cancelled by user', 'archive is damaged']) {
    assert.equal(isNetworkDownloadError(message), false, message);
  }
});
