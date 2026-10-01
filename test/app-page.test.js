/* The page the main window loads (src/app-page.js), and the three places that have to agree on
 * where it lives: the loader, Vite's build and the list of files the installer packs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { appPage, loadAppPage } = require('../src/app-page');

const root = path.join(__dirname, '..');
const DEV = 'http://127.0.0.1:5173/';

test('a packaged app loads its own page whatever MM_DEV_URL says', () => {
  const where = appPage({ root, isPackaged: true, devUrl: DEV, exists: () => true });
  assert.equal(where.kind, 'file');
  assert.equal(where.page, path.join(root, 'out', 'renderer', 'index.html'));
  assert.match(where.url, /^file:\/\/.*\/out\/renderer\/index\.html$/);
});

test('npm run dev serves the page from this machine and nowhere else', () => {
  assert.equal(appPage({ root, isPackaged: false, devUrl: DEV, exists: () => false }).kind, 'url');
  assert.equal(appPage({ root, isPackaged: false, devUrl: 'http://localhost:5173/', exists: () => false }).url, 'http://localhost:5173/');
  for (const devUrl of ['http://example.com:5173/', 'https://127.0.0.1:5173/', 'http://127.0.0.1:5173/page', 'http://127.0.0.1.example.com:5173/', 'file:///x']) {
    assert.notEqual(appPage({ root, isPackaged: false, devUrl, exists: () => true }).kind, 'url', devUrl);
  }
});

test('a checkout nobody built says so and quits instead of opening a blank window', () => {
  const calls = [];
  const win = { loadURL: (u) => calls.push(['url', u]), loadFile: (f) => calls.push(['file', f]) };
  const app = { isPackaged: false, quit: () => calls.push(['quit']) };
  const dialog = { showErrorBox: (title, text) => calls.push(['error', text]) };
  const deps = { app, dialog, root: path.join(root, 'no-such-dir'), env: {} };
  assert.equal(loadAppPage(win, deps), null);
  assert.deepEqual(calls.map((c) => c[0]), ['error', 'quit']);
  assert.match(calls[0][1], /npm run build:ui/);

  calls.length = 0;
  assert.equal(loadAppPage(win, { ...deps, env: { MM_DEV_URL: DEV } }), DEV);
  assert.deepEqual(calls, [['url', DEV]]);
});

test('the loader, the Vite build and the installer agree on out/renderer', () => {
  const vite = fs.readFileSync(path.join(root, 'vite.config.mjs'), 'utf8');
  assert.match(vite, /outDir: path\.join\(here, 'out', 'renderer'\)/, 'Vite builds somewhere main.js does not look');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('out/renderer/**/*'), 'the installer would ship without the page');
  assert.equal(pkg.build.beforePack, './tools/before-pack.cjs', 'an installer could pack a stale page');
  assert.ok(fs.existsSync(path.join(root, 'tools', 'before-pack.cjs')));
  // devDependencies: Vite bundles them into the page, and the installer should not carry them twice
  for (const name of ['react', 'react-dom', 'motion']) assert.ok(!pkg.dependencies[name], `${name} is packed as a module as well as bundled`);
});

test('the licences of what is compiled into the page ship beside it, and NOTICE says where', () => {
  /* A bundle keeps none of the licence headers of the code inside it, and MIT asks for the notice
     to travel with every copy. Vite writes them out (build.license); NOTICE, which the installer
     carries, names the file. */
  const vite = fs.readFileSync(path.join(root, 'vite.config.mjs'), 'utf8');
  assert.match(vite, /license: \{ fileName: 'THIRD-PARTY-LICENSES\.md' \}/);
  assert.match(fs.readFileSync(path.join(root, 'NOTICE'), 'utf8'), /THIRD-PARTY-LICENSES\.md/);
});
