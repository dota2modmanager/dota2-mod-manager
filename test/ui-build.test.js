/* Starting a checkout after a renderer patch must not silently show yesterday's bundle. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('changing only the local loadout package makes the built page stale', async (t) => {
  const { isStale } = await import('../tools/ui-build.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ui-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, time) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'fixture');
    fs.utimesSync(file, time, time);
  };
  for (const name of ['renderer/index.ts', 'vite.config.mjs', 'package-lock.json']) put(name, 1000);
  assert.equal(isStale(root), true, 'a fresh checkout needs its first build');
  put('out/renderer/index.html', 2000);
  assert.equal(isStale(root), false, 'the bundle is newer than all sources');
  put('vendor/dota-loadout/src/fx.js', 3000);
  assert.equal(isStale(root), true, 'a particle engine patch must rebuild even if React did not change');
  put('out/renderer/index.html', 4000);
  assert.equal(isStale(root), false, 'the rebuilt bundle consumes the patch');
});
