#!/usr/bin/env node
/**
 * Installs a mod, switches it off and on, and removes it, by clicking through the real window.
 *
 * 2.6.5 and 2.6.6 shipped with Install dead. Splitting the IPC handlers left a call to a function
 * that no longer existed in that file, every test passed, and the Linux job started the app and
 * photographed a window that came up perfectly. Nothing ever pressed the button, so four releases
 * went out in an evening while nobody could install a mod. Issue #19.
 *
 * This presses it. It uses the sandbox game tree from tools/sandbox.js and writes a fixture
 * catalog and a fixture archive straight into the app's own caches (catalog-cache/, downloads/),
 * so the run needs no network and no live catalog. The catalog changes by itself every day, and
 * a required check that goes red over a commit in somebody else's repository gets switched off
 * within a week. The cached catalog is data the app would have written after checking its
 * signature; nothing here weakens that check.
 *
 * test/fixtures/e2e holds that catalog: the upstream constants.json with its categories, hero
 * list and translations kept and its authors, notes and sources emptied, an empty guides.json,
 * and a mods.json in the real shape with every category empty except one hero mod.
 *
 * Two launches of the app, with the disk checked after each:
 *   1. Open the fixture mod's card, press Install, wait for the installed state, then switch it
 *      off in My mods. On disk: exactly one new pakNN_dir.vpk.off in the language folder.
 *   2. A fresh start. The mod is still listed and still off; switch it on, press Remove, confirm.
 *      On disk: the language folder is byte for byte what it was before the first launch.
 * The app's log must not contain an unresolved name at any point.
 *
 * Usage:
 *   node tools/e2e.mjs            # under `xvfb-run -a` on Linux
 *   node tools/e2e.mjs --keep     # leave the sandbox as the run left it
 *   node tools/e2e.mjs --app <p>  # a packaged build: the installed exe, or an unpacked AppImage's AppRun
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { crc32 } from 'node:zlib';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const SANDBOX = path.join(root, 'sandbox');
const USERDATA = path.join(SANDBOX, 'userdata');
const LANG_DIR = path.join(SANDBOX, 'steamapps', 'common', 'dota 2 beta', 'game', 'dota_russian');
const FIXTURES = path.join(root, 'test', 'fixtures', 'e2e');
const OUT = path.join(root, 'e2e-output');
// the app's note of which files in the language folder are its own, rewritten on every change
const OWNERSHIP = 'dota2modmanager.json';
// --app <path>: a packaged build instead of this source tree. release.yml passes the installed
// exe and the unpacked AppImage from the draft release, so what gets clicked is what goes out.
const appAt = process.argv.indexOf('--app');
const APP = appAt > 0 && process.argv[appAt + 1] ? path.resolve(process.argv[appAt + 1]) : null;

export const MOD = { categoryId: 'heroes', hero: 'Brewmaster', name: 'Brewmaster E2E Fixture', file: 'Brewmaster E2E Fixture.zip' };

/** A zip holding one pak01_dir.vpk with one small file in it: the shape most catalog mods have. */
export function fixtureArchive() {
  const { buildVpk } = require('../src/vpk.ts');
  const AdmZip = require('adm-zip');
  const data = Buffer.from('dota2-mod-manager end-to-end fixture\n');
  const vpk = buildVpk([{
    ext: 'txt',
    folder: 'materials/e2e',
    name: 'fixture_marker',
    data,
    preload: Buffer.alloc(0),
    crc: crc32(data) >>> 0,
  }]);
  const zip = new AdmZip();
  zip.addFile('pak01_dir.vpk', vpk);
  // a fixed date, so the same fixture is the same bytes on every run and every machine
  zip.getEntries()[0].header.time = new Date(2026, 0, 1);
  return zip.toBuffer();
}

/** Writes the fixture catalog and the fixture archive where the app looks for its caches. */
export function seedCaches({ userData = USERDATA, fixtures = FIXTURES, now = Date.now() } = {}) {
  const cache = path.join(userData, 'catalog-cache');
  fs.mkdirSync(cache, { recursive: true });
  for (const name of ['mods.json', 'constants.json', 'guides.json']) {
    fs.copyFileSync(path.join(fixtures, name), path.join(cache, name));
  }
  const archive = fixtureArchive();
  const sha256 = crypto.createHash('sha256').update(archive).digest('hex');
  fs.writeFileSync(path.join(cache, 'mod-hashes.json'), JSON.stringify({ [`${MOD.categoryId}/${MOD.file}`]: sha256 }));
  // fresh, so the catalog view does not go and replace the fixture with the live catalog
  fs.writeFileSync(path.join(cache, 'meta.json'), JSON.stringify({ fetchedAt: now }));
  const downloads = path.join(userData, 'downloads', MOD.categoryId);
  fs.mkdirSync(downloads, { recursive: true });
  fs.writeFileSync(path.join(downloads, MOD.file), archive);
  return { sha256, bytes: archive.length };
}

/**
 * Every file in a folder with its hash, so "unchanged" means unchanged. The ownership note is
 * left out: it carries a timestamp, so it differs after every write, and its contents get their
 * own check.
 */
export function snapshot(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return {}; }
  const out = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === OWNERSHIP || !entry.isFile()) continue;
    // read once, no stat before it: a check and then a read is two looks at a file that can change between them
    const data = readIfThere(path.join(dir, entry.name), null);
    if (data) out[entry.name] = crypto.createHash('sha256').update(data).digest('hex');
  }
  return out;
}

/** A file's contents, or null when it is not there. One read instead of an existence check and a read. */
function readIfThere(file, encoding = 'utf8') {
  try { return fs.readFileSync(file, encoding); } catch { return null; }
}

/** What changed between two snapshots. */
export function difference(before, after) {
  return {
    added: Object.keys(after).filter((n) => !(n in before)),
    removed: Object.keys(before).filter((n) => !(n in after)),
    changed: Object.keys(after).filter((n) => n in before && before[n] !== after[n]),
  };
}

const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(250); } };
  const out = { steps: [] };
  const step = (name, ok, detail) => { out.steps.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail || '') }); return Boolean(ok); };
  const toasts = () => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent.trim()).join(' | ');
  const row = () => [...document.querySelectorAll('.lib-row')].find((r) => r.textContent.includes(NAME)) || null;
  // a player cannot click past a dialog, and a script that does ends up pressing its buttons
  const dialogs = () => [...document.querySelectorAll('.confirm-overlay, .lang-pick-overlay')].map((d) => d.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120));
`;

/** Runs in the window on the first launch, with the catalog open on heroes. */
export const EVAL_INSTALL = `
  const NAME = ${JSON.stringify(MOD.name)};
  ${HELPERS}
  await sleep(1000);
  if (!step('no dialog stands in front of the catalog', !dialogs().length, dialogs().join(' | '))) return out;
  // Heroes opens on a grid of heroes (renderer/views/hero-grid.js): the mod is behind its hero
  const tile = await until(() => document.querySelector('.hero-tile[data-hero=' + JSON.stringify(${JSON.stringify(MOD.hero)}) + ']'), 20000);
  if (!step('its hero is on the heroes grid', tile, 'tiles on screen: ' + document.querySelectorAll('.hero-tile').length)) return out;
  tile.click();
  const card = await until(() => [...document.querySelectorAll('.grid .card')].find((c) => c.textContent.includes(NAME)), 20000);
  if (!step('the fixture mod is in the catalog', card, 'cards on screen: ' + document.querySelectorAll('.grid .card').length)) return out;
  card.click();
  const install = await until(() => document.getElementById('installBtn'), 10000);
  if (!step('its card opens with an Install button', install, toasts())) return out;
  install.click();
  const installed = await until(() => document.getElementById('uninstallBtn'), 90000);
  if (!step('Install finishes and the card shows the installed state', installed, toasts() || 'no error toast; the button never changed')) return out;
  document.getElementById('modalCloseBtn')?.click();
  await sleep(400);
  document.querySelector('[data-view="library"]')?.click();
  const listed = await until(row, 15000);
  if (!step('My mods lists it, switched on', listed && !listed.classList.contains('disabled'), listed ? 'listed but switched off' : 'not listed')) return out;
  listed.querySelector('.toggle[data-id]').click();
  const off = await until(() => { const r = row(); return r && r.classList.contains('disabled') ? r : null; }, 30000);
  step('switching it off takes effect', off, toasts());
  return out;
`;

/** Runs in the window on the second launch, with My mods open. */
export const EVAL_REMOVE = `
  const NAME = ${JSON.stringify(MOD.name)};
  ${HELPERS}
  const listed = await until(row, 20000);
  if (!step('after a restart My mods still lists it, switched off', listed && listed.classList.contains('disabled'), listed ? 'listed but switched on' : 'not listed')) return out;
  if (!step('no dialog stands in front of My mods', !dialogs().length, dialogs().join(' | '))) return out;
  listed.querySelector('.toggle[data-id]').click();
  const on = await until(() => { const r = row(); return r && !r.classList.contains('disabled') ? r : null; }, 30000);
  if (!step('switching it back on takes effect', on, toasts())) return out;
  on.querySelector('[data-del]').click();
  const confirm = await until(() => [...document.querySelectorAll('.confirm-overlay')].find((d) => d.textContent.includes(NAME)), 5000);
  if (!step('Remove asks for confirmation, naming the mod', confirm, dialogs().join(' | ') || 'no dialog opened')) return out;
  confirm.querySelector('[data-c="yes"]').click();
  const gone = await until(() => (row() ? null : true), 30000);
  step('confirming removes it from My mods', gone, toasts());
  return out;
`;

/* Runs in the removal window, which is a different window with a different preload.
 *
 * The window is opened by the uninstaller, so nothing a player does reaches it and no other
 * check here comes near it. It opened once where it should not have - in the middle of an
 * update, with the destructive boxes ticked, for everybody who updated to 2.6.1 - and what
 * made that frightening rather than merely wrong was the ticks. So this reads the boxes. */
export const EVAL_UNINSTALL_WINDOW = `
  ${HELPERS}
  await sleep(500);
  const opts = [...document.querySelectorAll('.uninstall-opt input[type=checkbox]')];
  if (!step('the removal window is up, with its questions', opts.length >= 2, 'checkboxes on screen: ' + opts.length)) return out;
  const box = (id) => document.getElementById(id);
  step('deleting the mods is not ticked for the person', box('optMods') && !box('optMods').checked, box('optMods') ? 'it was ticked' : 'the question is missing');
  step('deleting the app data is not ticked for the person', box('optData') && !box('optData').checked, box('optData') ? 'it was ticked' : 'the question is missing');
  if (box('optRevert')) step('putting the game back is ticked, because nothing else can do it later', box('optRevert').checked, 'it was not ticked');
  // the numbers come from the main process reading the real library and the real folder,
  // so a window that draws but is told nothing shows up here rather than looking fine
  const notes = [...document.querySelectorAll('.uninstall-opt small')].map((n) => n.textContent).join(' | ');
  step('it says how much it is talking about', /[0-9]/.test(notes), notes || '(no notes drawn)');
  return out;
`;

/* Runs in whatever window an update's command line brings up, which must be the ordinary one. */
export const EVAL_NOT_THE_REMOVAL_WINDOW = `
  ${HELPERS}
  await sleep(500);
  const removal = document.querySelectorAll('.uninstall-opt').length;
  step('an update does not get the removal window', removal === 0, 'the removal window came up with ' + removal + ' questions');
  step('it gets the ordinary window', Boolean(document.querySelector('[data-view]')), 'neither window is on screen');
  return out;
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stop(child) {
  if (child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

/** One launch of the app with the screenshot harness, returning what the window script returned. */
async function launch(label, env, timeoutMs = 180000, extraArgs = []) {
  const shot = path.join(OUT, `${label}.png`);
  for (const f of [shot, `${shot}.eval.json`, `${shot}.err.txt`]) fs.rmSync(f, { force: true });
  const log = fs.openSync(path.join(OUT, `${label}.electron.log`), 'w');
  const args = [`--user-data-dir=${USERDATA}`, ...extraArgs];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const child = spawn(APP || require('electron'), APP ? args : ['.', ...args], {
    cwd: root,
    env: { ...process.env, MM_SHOT: shot, ...env },
    stdio: ['ignore', log, log],
    detached: process.platform !== 'win32',
  });
  // a path that is not there fails at once, not after three minutes of waiting for a window
  let startError = null;
  child.on('error', (e) => { startError = e; });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !startError && !fs.existsSync(shot) && !fs.existsSync(`${shot}.err.txt`)) await sleep(1000);
  await sleep(1500);
  stop(child);
  await sleep(2500); // let Windows release the files before the disk is read
  fs.closeSync(log);
  const evaluated = readIfThere(`${shot}.eval.json`);
  return {
    result: evaluated ? JSON.parse(evaluated) : null,
    error: startError ? `could not start ${APP || 'electron'}: ${startError.message}` : readIfThere(`${shot}.err.txt`),
    timedOut: Date.now() >= deadline,
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const keep = process.argv.includes('--keep');
  const node = process.execPath;
  const report = { steps: [] };
  const check = (name, ok, detail = '') => {
    report.steps.push({ name, ok: Boolean(ok), detail: ok ? '' : detail });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `: ${detail}` : ''}`);
    return Boolean(ok);
  };
  const windowSteps = (launched, label) => {
    if (!launched.result) return check(`${label}: the window script ran`, false, launched.error || (launched.timedOut ? 'the window never finished' : 'no result was written'));
    let ok = true;
    for (const s of launched.result.steps) ok = check(s.name, s.ok, s.detail) && ok;
    return ok;
  };

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  report.app = APP || 'this source tree';
  console.log(`the app under test: ${report.app}`);
  // seed adds to whatever game tree and userdata are already there, and a pak or a manifest left
  // by an earlier run would put mods in My mods that this run never installed
  fs.rmSync(USERDATA, { recursive: true, force: true });
  fs.rmSync(path.join(SANDBOX, 'steamapps'), { recursive: true, force: true });
  execFileSync(node, ['tools/sandbox.js', 'seed', '--no-mods'], { cwd: root, stdio: 'inherit' });
  const seeded = seedCaches();
  console.log(`fixture archive ${seeded.bytes} bytes, sha256 ${seeded.sha256.slice(0, 12)}`);
  const before = snapshot(LANG_DIR);

  const langChosen = () => {
    try { return JSON.parse(fs.readFileSync(path.join(USERDATA, 'settings.json'), 'utf8')).langSuffix; } catch { return null; }
  };
  const claims = () => {
    try { return JSON.parse(fs.readFileSync(path.join(LANG_DIR, OWNERSHIP), 'utf8')).files || []; } catch { return ['(no ownership note)']; }
  };

  let passed = false;
  const first = await launch('1-install', { MM_CAT: MOD.categoryId, MM_EVAL: EVAL_INSTALL });
  if (windowSteps(first, 'first launch')
    && check('the app installed into the sandbox language folder, dota_russian', langChosen() === 'russian',
      `it chose dota_${langChosen()}: a -language in Steam launch options outside the sandbox decides that`)) {
    const d = difference(before, snapshot(LANG_DIR));
    const pak = d.added.length === 1 && /^pak\d+_dir\.vpk\.off$/i.test(d.added[0]) ? d.added[0] : null;
    if (check('on disk: one new pak, renamed .off, and none of the files already there touched', pak && !d.removed.length && !d.changed.length, JSON.stringify(d))
      && check('the ownership note claims that pak and nothing else', JSON.stringify(claims()) === JSON.stringify([pak.replace(/\.off$/i, '')]), JSON.stringify(claims()))) {
      const second = await launch('2-remove', { MM_VIEW: 'library', MM_EVAL: EVAL_REMOVE });
      if (windowSteps(second, 'second launch')) {
        const back = difference(before, snapshot(LANG_DIR));
        passed = check('on disk: the language folder is exactly as it was before', !back.added.length && !back.removed.length && !back.changed.length, JSON.stringify(back))
          && check('the ownership note claims nothing any more', claims().length === 0, JSON.stringify(claims()));
      }
    }
  }

  /* The removal window, which nothing else here reaches.
     Last, because it must not disturb the run above it, and because by now the language folder
     is back to what it was: if merely opening this window touches the game, that shows. */
  if (passed) {
    // the command line electron-builder uses when it replaces a version, flags and all
    const update = await launch('3-update', { MM_EVAL: EVAL_NOT_THE_REMOVAL_WINDOW }, 180000,
      ['--uninstall', '/S', '/KEEP_APP_DATA', '--updated']);
    passed = windowSteps(update, 'an update') && passed;

    const removal = await launch('4-uninstall', { MM_EVAL: EVAL_UNINSTALL_WINDOW }, 180000, ['--uninstall']);
    passed = windowSteps(removal, 'the removal window') && passed;

    const after = difference(before, snapshot(LANG_DIR));
    passed = check('opening the removal window changed nothing in the game folder',
      !after.added.length && !after.removed.length && !after.changed.length, JSON.stringify(after)) && passed;
  }

  const appLog = path.join(USERDATA, 'logs', 'app.log');
  const logText = readIfThere(appLog);
  const unresolved = (logText || '').split('\n').filter((l) => /unhandledrejection|is not defined|is not a function/.test(l));
  passed = check('the app log has no unresolved name in it', !unresolved.length, unresolved.slice(0, 3).join(' / ')) && passed;
  if (logText !== null) fs.writeFileSync(path.join(OUT, 'app.log'), logText);

  report.passed = passed;
  fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (!keep) execFileSync(node, ['tools/sandbox.js', 'reset'], { cwd: root, stdio: 'ignore' });
  console.log(passed ? 'end-to-end: a mod was installed, switched off and on, and removed through the window, and the removal window opens only for a removal' : 'end-to-end: FAILED, see e2e-output/');
  process.exitCode = passed ? 0 : 1;
}
