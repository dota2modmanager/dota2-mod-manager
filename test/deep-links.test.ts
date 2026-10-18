/* d2mm:// links (src/deep-links.ts): which argument is the link, what reaches the window, and the
 * .desktop file that lets Linux send one at all. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { desktopEntry, firstLink, handleDeepLink, installDesktopEntry, modLinkUrl, parseModLink } from '../src/deep-links.ts';

test('the link is found among the other arguments, and a missing command line is no link', () => {
  const argv = ['C:\\app\\Dota 2 Mod Manager.exe', '--allow-file-access', 'd2mm://preset/abc'];
  assert.equal(firstLink(argv), 'd2mm://preset/abc');
  assert.equal(firstLink(['app.exe', 'https://example.com']), undefined);
  assert.equal(firstLink(null), undefined);
});

function fakeWindow({ destroyed = false } = {}) {
  const log: unknown[][] = [];
  return {
    log,
    win: {
      isDestroyed: () => destroyed,
      show: () => log.push(['show']),
      focus: () => log.push(['focus']),
      webContents: { send: (...a: unknown[]) => log.push(['send', ...a]) },
    },
  };
}

test('a preset link is parked and the window comes forward with what arrived', () => {
  const w = fakeWindow();
  const asked: string[] = [];
  handleDeepLink('d2mm://preset/CODE', { importPresetLink: (c) => { asked.push(c); return { ok: true }; }, win: () => w.win });
  assert.deepEqual(asked, ['CODE'], 'the importer gets the code, not the scheme');
  assert.deepEqual(w.log, [['show'], ['focus'], ['send', 'preset-link', { ok: true }]]);
});

test('anything that is not a d2mm link is ignored, and a closed window is not touched', () => {
  const asked: string[] = [];
  const importPresetLink = (c: string) => { asked.push(c); return null; };
  handleDeepLink('https://dota2modmanager.com/', { importPresetLink, win: () => null });
  handleDeepLink(undefined, { importPresetLink, win: () => null });
  assert.deepEqual(asked, []);
  const gone = fakeWindow({ destroyed: true });
  handleDeepLink('d2mm://preset/X', { importPresetLink, win: () => gone.win });
  assert.deepEqual(gone.log, [], 'the preset is still parked, the window is not asked to show');
  assert.deepEqual(asked, ['X']);
});

test('a mod link names its category, the mod and the look, and survives the trip', () => {
  // a name with a slash, a space, Cyrillic and a quote: every part travels encoded
  const mod = { cat: 'heroes', name: 'Pudge / Мясник "Arcana"', style: 'Red' };
  const url = modLinkUrl(mod);
  assert.match(url, /^d2mm:\/\/mod\/heroes\/[^/]+\/Red$/);
  assert.deepEqual(parseModLink(url), mod);
  assert.equal(modLinkUrl({ cat: 'couriers', name: 'Golden Baby Roshan', style: null }), 'd2mm://mod/couriers/Golden%20Baby%20Roshan');
  assert.deepEqual(parseModLink('d2mm://mod/couriers/Golden%20Baby%20Roshan'), { cat: 'couriers', name: 'Golden Baby Roshan', style: null });
});

test('a mod link keeps its mod through what a browser or the shell does to it, and names nothing when broken', () => {
  const want = { cat: 'wards', name: 'Ward', style: null };
  assert.deepEqual(parseModLink('d2mm://mod/wards/Ward/'), want, 'a slash added at the end');
  assert.deepEqual(parseModLink('d2mm://mod/wards/Ward?from=site#x'), want, 'a query and a fragment');
  for (const bad of ['d2mm://mod/', 'd2mm://mod/wards', 'd2mm://mod/wards/%E0%A4%A', 'd2mm://mod/a/b/c/d', 'd2mm://mod/wards/%20', 'd2mm://preset/abc']) {
    assert.equal(parseModLink(bad), null, bad);
  }
});

test('a mod link goes to the window to open, and never reaches the preset importer', () => {
  const asked: string[] = [];
  const importPresetLink = (c: string) => { asked.push(c); return { ok: true }; };
  const w = fakeWindow();
  handleDeepLink('d2mm://mod/heroes/Arcana/Blue', { importPresetLink, win: () => w.win });
  assert.deepEqual(w.log, [['show'], ['focus'], ['send', 'mod-link', { cat: 'heroes', name: 'Arcana', style: 'Blue' }]]);
  // one that names nothing still arrives, so the window can say so instead of staying silent
  const broken = fakeWindow();
  handleDeepLink('d2mm://mod/heroes', { importPresetLink, win: () => broken.win });
  assert.deepEqual(broken.log, [['show'], ['focus'], ['send', 'mod-link', null]]);
  assert.deepEqual(asked, []);
});

function home(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-home-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('on Linux the desktop learns the program and its scheme, once', (t) => {
  const h = home(t);
  const refreshed: string[] = [];
  const opts = { platform: 'linux', exe: '/opt/My Apps/mm.AppImage', home: h, diag: () => {}, refresh: (d: string) => refreshed.push(d) };
  installDesktopEntry(opts);
  const file = path.join(h, '.local', 'share', 'applications', 'dota2-mod-manager.desktop');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^Exec="\/opt\/My Apps\/mm\.AppImage" %u$/m, 'quoted, with the link passed through');
  assert.match(text, /^MimeType=x-scheme-handler\/d2mm;application\/x-d2mm;$/m);
  assert.match(text, /^StartupWMClass=dota2-mod-manager$/m, 'the running window is matched to the entry');
  installDesktopEntry(opts);
  assert.equal(refreshed.length, 1, 'an entry that already says the same is left alone');
  installDesktopEntry({ ...opts, exe: '/new/place.AppImage' });
  assert.equal(fs.readFileSync(file, 'utf8'), desktopEntry('/new/place.AppImage'), 'a moved AppImage is followed');
});

test('the icon the entry names is put where the desktop looks for it', (t) => {
  const h = home(t);
  const src = path.join(h, 'icon.png');
  fs.writeFileSync(src, 'first');
  const opts = { platform: 'linux', exe: '/x.AppImage', home: h, diag: () => {}, icon: src, refresh: () => {} };
  installDesktopEntry(opts);
  const file = path.join(h, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps', 'dota2-mod-manager.png');
  assert.equal(fs.readFileSync(file, 'utf8'), 'first');
  fs.writeFileSync(src, 'second');
  installDesktopEntry(opts);
  assert.equal(fs.readFileSync(file, 'utf8'), 'second', 'a new release brings its new icon');
});

test('a missing icon still leaves the entry written', (t) => {
  const h = home(t);
  const said: string[] = [];
  installDesktopEntry({ platform: 'linux', exe: '/x.AppImage', home: h, diag: (m) => said.push(m), icon: path.join(h, 'none.png'), refresh: () => {} });
  assert.ok(fs.existsSync(path.join(h, '.local', 'share', 'applications', 'dota2-mod-manager.desktop')));
  assert.match(said[0], /^desktop icon skipped: /);
});

test('Windows and macOS are left to their installers', (t) => {
  const h = home(t);
  installDesktopEntry({ platform: 'win32', exe: 'x', home: h, diag: () => {} });
  assert.equal(fs.existsSync(path.join(h, '.local')), false);
});

test('a home that cannot be written to ends in a log line, not an error', (t) => {
  const h = home(t);
  const blocked = path.join(h, 'file');
  fs.writeFileSync(blocked, '');
  const said: string[] = [];
  assert.doesNotThrow(() => installDesktopEntry({ platform: 'linux', exe: 'x', home: blocked, diag: (m) => said.push(m) }));
  assert.match(said[0], /^desktop entry skipped: /);
});
