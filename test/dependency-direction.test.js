/* Which way the code is allowed to depend.
 *
 * The modules that read files strangers wrote and write into the game folder - vpk, safe-zip,
 * the installer, the importer, the schema - are the ones the tests can load and exercise in
 * plain Node. That is only true while none of them reaches Electron: the day vpk.js needs
 * `app` for a path, every test of the VPK reader stops being runnable, and the parsers that
 * most need testing quietly become the ones that cannot be.
 *
 * The same goes the other way for the window. renderer/ is ES modules in a browser; a path from
 * it into src/ would bundle main-process code into the page, or fail to load and
 * leave the screen blank.
 *
 * Measured on 2026-09-16: thirteen modules in src/ reach Electron, every one of them directly
 * (the ipc-* modules, discord-auth, mod-preview, presets-service, uninstall-window), and no
 * module reaches it through another. The list below is that measurement. It may shrink - a
 * module that stops needing Electron should come off it - and it may not grow without somebody
 * editing it and saying why.
 *
 * Since 2026-09-30 the ipc-* modules ask for Electron through src/electron.ts, when a channel is
 * registered rather than when the file loads, so each of them reaches it through that one
 * neighbour. The chain check below follows it there. src/main-window.ts joined the list the same
 * day: it is the window main.js used to build itself, moved out so its navigation lock and its
 * zoom keys could be tested, and a window cannot be made without Electron. src/main.ts is the
 * main process itself, the file Electron starts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const ELECTRON_USERS = [
  'src/discord-auth.ts',
  'src/electron.ts',
  'src/ipc-diagnostics.ts',
  'src/ipc-foreign.ts',
  'src/ipc-game.ts',
  'src/ipc-library.ts',
  'src/ipc-misc.ts',
  'src/ipc-mods.ts',
  'src/ipc-packs.ts',
  'src/ipc-presets.ts',
  'src/ipc-settings.ts',
  'src/ipc-window.ts',
  'src/ipc.ts',
  'src/main-window.ts',
  'src/main.ts',
  'src/mod-preview.ts',
  'src/presets-service.ts',
  'src/uninstall-window.ts',
];

// require('x'), and the ESM forms the TypeScript modules use: import ... from 'x', import('x')
const REQUIRE = /(?:require\(\s*|\bfrom\s+|\bimport\s*\(\s*|^import\s+)['"]([^'"]+)['"]/gm;
// Types are erased before the code runs: `import type` and `typeof import('x')` load nothing.
const TYPE_ONLY = /^import type [^;]+;|typeof import\(\s*['"][^'"]+['"]\s*\)/gm;
// Electron through a require made by hand (createRequire, src/electron.ts): a call with its name.
const ELECTRON_CALL = /\(\s*['"]electron['"]\s*\)/;

// Comments load nothing: a JSDoc type such as {import('electron').BrowserWindow} is not a require.
// A "//" right after a colon is a URL, not a comment, and stays.
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g;

/** What one file requires: 'electron', or repository-relative paths of local modules. */
function requiresOf(root, file) {
  const out = [];
  const text = fs.readFileSync(path.join(root, file), 'utf8').replace(COMMENTS, '$1').replace(TYPE_ONLY, '');
  if (ELECTRON_CALL.test(text)) out.push('electron');
  for (const m of text.matchAll(REQUIRE)) {
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
    // a type names Electron and loads nothing; a require made by hand loads it all the same
    fs.writeFileSync(path.join(dir, 'src', 'shape.ts'), "import type { BrowserWindow } from 'electron';\nexport type E = typeof import('electron');\n");
    fs.writeFileSync(path.join(dir, 'src', 'door.ts'), "const load = createRequire(import.meta.url);\nexport const e = () => load('electron');\n");
    fs.writeFileSync(path.join(dir, 'src', 'user.ts'), "import { e } from './door.ts';\n");
    // Electron named only in a JSDoc type: nothing is loaded
    fs.writeFileSync(path.join(dir, 'src', 'typed.js'), "/** @param {import('electron').BrowserWindow} win */\nconst fs = require('fs');\n");

    assert.deepEqual(pathToElectron(dir, 'src/parser.js'), ['src/parser.js', 'src/paths.js', 'electron']);
    assert.equal(pathToElectron(dir, 'src/plain.js'), null);
    assert.equal(pathToElectron(dir, 'src/shape.ts'), null, 'types only');
    assert.deepEqual(pathToElectron(dir, 'src/user.ts'), ['src/user.ts', 'src/door.ts', 'electron']);
    assert.equal(pathToElectron(dir, 'src/typed.js'), null, 'a type in a comment is not a require');
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
  const core = ['src/vpk.ts', 'src/vpk-read.ts', 'src/vpk-write.ts', 'src/vpk-pack.ts', 'src/vpk-analyze.ts', 'src/safe-zip.ts', 'src/installer.ts', 'src/installer-write.ts', 'src/installer-files.ts', 'src/installer-downloads.ts', 'src/installer-slots.ts',
    'src/installer-packs.ts', 'src/installer-repack.ts', 'src/installer-folder.ts', 'src/import.ts', 'src/schema.ts',
    'src/patcher.ts', 'src/patcher-gameinfo.ts', 'src/patcher-signatures.ts', 'src/gamelang.ts', 'src/gamelang-steam.ts',
    'src/gamelang-folders.ts', 'src/file-tx.ts', 'src/net.ts', 'src/net-mirrors.ts', 'src/net-fetch.ts', 'src/net-download.ts',
    'src/adopt.ts', 'src/cursors.ts',
    'src/game-upkeep.ts'];
  for (const file of core) {
    assert.ok(!ELECTRON_USERS.includes(file), `${file} is on the Electron list`);
    assert.equal(pathToElectron(ROOT, file), null, `${file} reaches Electron`);
  }
});

test('the window never reaches into the main process', () => {
  /* renderer/ is ES modules loaded by the page. An import that leaves renderer/ lands in code
     written for Node: at best the screen stays blank, at worst main-process code runs in it.
     TypeScript too: reading only .js, this looked at fewer files with every screen that moved,
     until it found almost nothing to read. */
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|ts|tsx)$/.test(e.name)) files.push(p);
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
