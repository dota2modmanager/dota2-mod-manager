/* Every relative require resolves from the file that holds it.
 *
 * src/ipc-library.js asked for './src/vpk' from inside src/. That resolves to src/src/vpk, which
 * is not there, and Node only says so when the line runs. Both lines sat inside a handler's
 * try/catch, so "adopt an external mod" and "adopt a cursor set" answered the window with
 * "Cannot find module" instead of adopting anything, for as long as they had existed.
 *
 * test/ipc-contract.test.js could not see it: it reads these files as text to check that channel
 * names line up, and never runs a handler body. Nothing else loaded those lines either, because a
 * require inside a function runs only when the function does. This test resolves every one of them
 * without running anything.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** What the app loads at run time, plus the tools CI runs. */
function sources() {
  const out = ['main.js', 'preload.js', 'preload-uninstall.js'];
  for (const dir of ['src', 'tools']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (/\.(js|mjs)$/.test(f)) out.push(`${dir}/${f}`);
    }
  }
  return out.filter((f) => fs.existsSync(path.join(ROOT, f)));
}

/* require('./x') and require("../x/y"), including the lazy ones inside a function, which are the
   ones that go unnoticed. A template literal or a variable is left alone: what it names is known
   only while running, and guessing would make this test lie in the other direction. */
const RELATIVE_REQUIRE = /require\(\s*(['"])(\.[^'"]*)\1\s*\)/g;

test('every relative require resolves from the file it is written in', () => {
  const broken = [];
  for (const rel of sources()) {
    const full = path.join(ROOT, rel);
    fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(RELATIVE_REQUIRE)) {
        try {
          require.resolve(path.resolve(path.dirname(full), m[2]));
        } catch {
          broken.push(`${rel}:${i + 1} require('${m[2]}') resolves to nothing`);
        }
      }
    });
  }
  assert.deepEqual(broken, [], broken.join('\n'));
});

test('the check would have caught the one that shipped', () => {
  /* The bug was a path written as if the file sat in the repository root. Held here as a shape
     rather than as a memory: a require from inside src/ that starts with './src/' cannot resolve,
     whatever else changes around it. */
  const fromSrc = path.resolve(ROOT, 'src');
  assert.throws(
    () => require.resolve(path.resolve(fromSrc, './src/vpk.ts')),
    /Cannot find module/,
    'src/src/vpk resolves, so this test no longer describes the mistake it was written for',
  );
  assert.ok(require.resolve(path.resolve(fromSrc, './vpk.ts')), 'and the right path still resolves');
});
