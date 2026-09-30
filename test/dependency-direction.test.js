/* Which way the code is allowed to depend.
 *
 * The modules that read files strangers wrote and write into the game folder - vpk, safe-zip,
 * the installer, the importer, the schema - are the ones the tests can load and exercise in
 * plain Node. That is only true while none of them reaches Electron: the day vpk.js needs
 * `app` for a path, every test of the VPK reader stops being runnable, and the parsers that
 * most need testing quietly become the ones that cannot be.
 *
 * The same goes the other way for the window. renderer/ is ES modules in a browser; a path from
 * it into src/ or main.js would bundle main-process code into the page, or fail to load and
 * leave the screen blank.
 *
 * Measured on 2026-09-16: thirteen modules in src/ reach Electron, every one of them directly
 * (the ipc-* modules, discord-auth, mod-preview, presets-service, uninstall-window), and no
 * module reaches it through another. The list below is that measurement. It may shrink - a
 * module that stops needing Electron should come off it - and it may not grow without somebody
 * editing it and saying why.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const ELECTRON_USERS = [
  'src/discord-auth.ts',
  'src/ipc-diagnostics.js',
  'src/ipc-game.js',
  'src/ipc-library.js',
  'src/ipc-misc.js',
  'src/ipc-mods.js',
  'src/ipc-packs.js',
  'src/ipc-presets.js',
  'src/ipc-settings.js',
  'src/ipc-window.js',
  'src/mod-preview.ts',
  'src/presets-service.ts',
  'src/uninstall-window.js',
];

// require('x'), and the ESM forms the TypeScript modules use: import ... from 'x', import('x')
const REQUIRE = /(?:require\(\s*|\bfrom\s+|\bimport\s*\(\s*|^import\s+)['"]([^'"]+)['"]/gm;

/** What one file requires: 'electron', or repository-relative paths of local modules. */
function requiresOf(root, file) {
  const out = [];
  for (const m of fs.readFileSync(path.join(root, file), 'utf8').matchAll(REQUIRE)) {
    const spec = m[1];
    if (spec === 'electron') { out.push('electron'); continue; }
    if (!spec.startsWith('.')) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    // named with its extension, or without one, which CommonJS resolves to the .js
    const target = /\.(js|ts)$/.test(base) ? base : `${base}.js`;
    if (fs.existsSync(path.join(root, target))) out.push(target);
  }
  return out;
}

/** The chain from a file to Electron, or null when there is none. */
function pathToElectron(root, file, seen = new Set()) {
  if (seen.has(file)) return null;
  seen.add(file);
  for (const dep of requiresOf(root, file)) {
    if (dep === 'electron') return [file, 'electron'];
    const via = pathToElectron(root, dep, seen);
    if (via) return [file, ...via];
  }
  return null;
}

const srcFiles = () => fs.readdirSync(path.join(ROOT, 'src'))
  .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.d.ts')).map((f) => `src/${f}`).sort();

test('the detection finds a chain two modules long, and reports it', () => {
  /* Proof that the check below is not empty: a module that reaches Electron only through a
     neighbour is still caught, and the message names the way it got there. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-direction-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'parser.js'), "const { save } = require('./paths');\n");
    fs.writeFileSync(path.join(dir, 'src', 'paths.js'), "const { app } = require('electron');\n");
    fs.writeFileSync(path.join(dir, 'src', 'plain.js'), "const fs = require('fs');\n");

    assert.deepEqual(pathToElectron(dir, 'src/parser.js'), ['src/parser.js', 'src/paths.js', 'electron']);
    assert.equal(pathToElectron(dir, 'src/plain.js'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nothing outside the list reaches Electron, directly or through a neighbour', () => {
  const allowed = new Set(ELECTRON_USERS);
  const leaks = [];
  for (const file of srcFiles()) {
    if (allowed.has(file)) continue;
    const chain = pathToElectron(ROOT, file);
    if (chain) leaks.push(chain.join(' -> '));
  }
  assert.deepEqual(leaks, [],
    `these modules now need Electron, which makes them untestable in plain Node: ${leaks.join('; ')}`);
});

test('the list only names modules that still need Electron', () => {
  // A module that stopped needing it should come off the list, or the list stops meaning anything
  const stale = ELECTRON_USERS.filter((file) => !fs.existsSync(path.join(ROOT, file))
    || !pathToElectron(ROOT, file));
  assert.deepEqual(stale, [], `take these off ELECTRON_USERS: ${stale.join(', ')}`);
});

test('the parsers and everything that writes the game folder are nowhere near the list', () => {
  /* The list could in principle grow to take one of these in. These are named so that it cannot
     happen by editing a single array: each of them reading or writing files is the reason the
     tests exist. */
  const core = ['src/vpk.ts', 'src/safe-zip.ts', 'src/installer.js', 'src/import.js', 'src/schema.ts',
    'src/patcher.ts', 'src/gamelang.ts', 'src/file-tx.ts', 'src/net.ts', 'src/adopt.ts', 'src/cursors.ts'];
  for (const file of core) {
    assert.ok(!ELECTRON_USERS.includes(file), `${file} is on the Electron list`);
    assert.equal(pathToElectron(ROOT, file), null, `${file} reaches Electron`);
  }
});

test('the window never reaches into the main process', () => {
  /* renderer/ is ES modules loaded by the page. An import that leaves renderer/ lands in code
     written for Node: at best the screen stays blank, at worst main-process code runs in it. */
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'renderer'));
  assert.ok(files.length > 10, 'the renderer walk found almost nothing, so this test stopped looking');

  const IMPORT = /(?:import\s[^'"]*?from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
  const escapes = [];
  let seen = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (/\brequire\s*\(/.test(src)) escapes.push(`${path.relative(ROOT, file)} calls require()`);
    for (const m of src.matchAll(IMPORT)) {
      if (!m[1].startsWith('.')) continue;
      seen += 1;
      const target = path.resolve(path.dirname(file), m[1]);
      if (!target.startsWith(path.join(ROOT, 'renderer') + path.sep)) {
        escapes.push(`${path.relative(ROOT, file)} imports ${m[1]}`);
      }
    }
  }
  // an import pattern that stopped matching would pass this test on nothing at all
  assert.ok(seen > 20, `only ${seen} relative imports found in renderer/, so the pattern no longer reads them`);
  assert.deepEqual(escapes, [], escapes.join('; '));
});
