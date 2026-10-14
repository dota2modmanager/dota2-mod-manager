import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDownloadProxy } from '../src/download-proxy.ts';
import * as net from '../src/net.ts';

const realFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = realFetch;
  net.closeDownloadProxy();
});

test('accepts blank input as direct downloads', () => {
  assert.deepEqual(validateDownloadProxy(''), { ok: true, value: null });
  assert.deepEqual(validateDownloadProxy('   '), { ok: true, value: null });
});

test('accepts HTTP and HTTPS proxy URLs', () => {
  assert.deepEqual(validateDownloadProxy('http://127.0.0.1:8080'), {
    ok: true, value: 'http://127.0.0.1:8080',
  });
  assert.deepEqual(validateDownloadProxy('https://proxy.example:8443'), {
    ok: true, value: 'https://proxy.example:8443',
  });
});

test('rejects proxy URLs that are outside the supported safe format', () => {
  for (const value of [
    'ftp://proxy.example:21',
    'http:///missing-host:8080',
    'http://proxy.example:0',
    'http://proxy.example:65536',
    'http://user:pass@proxy.example:8080',
    'http://proxy.example:8080/path',
    'http://proxy.example:8080?secret=true',
    'http://proxy.example:8080#fragment',
    'not a URL',
  ]) {
    const result = validateDownloadProxy(value);
    assert.equal(result.ok, false, value);
    if (!result.ok) assert.equal(result.error.includes(value), false, 'does not echo proxy input');
  }
});

test('shared fetch uses the configured proxy and returns to direct fetch after clearing it', async () => {
  const seen: RequestInit[] = [];
  globalThis.fetch = (async (_url, init) => {
    seen.push(init || {});
    return new Response('ok', { status: 200 });
  }) as typeof fetch;

  net.setDownloadProxy('http://127.0.0.1:8080');
  assert.equal(await net.fetchText('https://example.com/file'), 'ok');
  assert.ok((seen[0] as RequestInit & { dispatcher?: unknown }).dispatcher, 'proxy dispatcher is used');

  net.setDownloadProxy(null);
  assert.equal(await net.fetchText('https://example.com/file'), 'ok');
  assert.equal('dispatcher' in seen[1], false, 'direct fetch has no stale dispatcher');
});
