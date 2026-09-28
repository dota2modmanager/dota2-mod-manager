/**
 * Steps more than one scenario takes: getting real mods ready, installing one from its card,
 * reading My mods, removing a mod, and what is in a folder.
 *
 * Kept out of scenarios/ on purpose: run.mjs runs every file in that folder as a scenario.
 */
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { lit } = require('./driver');
const dota = require('./dota');
const { listVpkPathCrcsFile } = require('../../src/vpk.js');
const { isAppPak } = require('../../src/slot-zones.js');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST = require('../sandbox-mods.json').mods;

const calm = `!document.documentElement.classList.contains('vt-screen')`;
const modalOpen = `!document.getElementById('modalOverlay').classList.contains('hidden')
  && !document.getElementById('modalOverlay').classList.contains('closing')
  && document.querySelector('#modalContent .modal-title')?.textContent.trim()`;

/**
 * What is in a folder, enough to tell that nothing was touched: small files by their bytes,
 * Valve's big packs by size and time. The app's ownership note is compared by the files it
 * lists, since it records when it was last written and is rewritten on every change.
 */
function listing(dir) {
  const out = {};
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isFile()) continue;
    const fd = fs.openSync(path.join(dir, d.name), 'r');
    try {
      const st = fs.fstatSync(fd);
      if (d.name === 'dota2modmanager.json') {
        try { out[d.name] = JSON.stringify(JSON.parse(fs.readFileSync(fd, 'utf8')).files); } catch { out[d.name] = 'unreadable'; }
      } else if (st.size < 1 << 20) {
        out[d.name] = crypto.createHash('sha1').update(fs.readFileSync(fd)).digest('hex');
      } else {
        out[d.name] = `${st.size}:${Math.round(st.mtimeMs)}`;
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  return out;
}

/** Where a listing differs from an earlier one, in words, or '' when it does not. */
function listingDiff(before, now) {
  const extra = Object.keys(now).filter((n) => !(n in before));
  const missing = Object.keys(before).filter((n) => !(n in now));
  const changed = Object.keys(before).filter((n) => n in now && now[n] !== before[n]);
  if (!extra.length && !missing.length && !changed.length) return '';
  return `extra: ${extra.join(', ') || '-'}; missing: ${missing.join(', ') || '-'}; changed: ${changed.join(', ') || '-'}`;
}

/**
 * A mod from the sandbox, as tools/sandbox-mods.json recorded it: the sandbox's copy, or fetched
 * when the sandbox was seeded without mods (CI does, to skip ~110 MB it has no use for).
 * Either way the bytes must hash to what the list recorded.
 *
 * The catalog is somebody else's and its authors replace files. When one has been replaced since
 * the list was written, the answer is { replaced } and the run goes on without that mod: a check
 * that fails over a commit in another repository gets switched off within a week (tools/e2e.mjs
 * says the same about the live catalog).
 * @returns {Promise<{ file?: string, replaced?: string }>}
 */
async function sandboxMod(m) {
  const file = path.join(ROOT, 'sandbox', 'mods', `${m.categoryId}__${m.file}`);
  const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
  let bytes = null;
  try { bytes = fs.readFileSync(file); } catch { /* not in this sandbox */ }
  if (bytes && hash(bytes) === m.sha256) return { file };
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${m.url}: HTTP ${res.status}`);
  bytes = Buffer.from(await res.arrayBuffer());
  const got = hash(bytes);
  if (got !== m.sha256) return { replaced: got };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { file };
}

/**
 * Real mods put into the app's download cache the way a download leaves them, so installing
 * needs no network and gets the same bytes on every machine. Returns the ones that made it.
 */
async function readyMods(sim, names) {
  const dl = path.join(app.getPath('userData'), 'downloads');
  const indexFile = path.join(dl, 'index.json');
  let index = {};
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch { /* first download */ }
  const picked = [];
  for (const name of names) {
    const m = MANIFEST.find((x) => x.name === name);
    let got = null;
    let why = 'not in tools/sandbox-mods.json';
    if (m) { try { got = await sandboxMod(m); } catch (e) { why = e.message; } }
    if (got && got.replaced) {
      sim.check(`${name}: the catalog replaced it since tools/sandbox-mods.json was written, so it sits this run out`, true, '',
        { recorded: m.sha256, now: got.replaced });
      continue;
    }
    if (!sim.check(`${name} is in the sandbox`, got && got.file, why)) continue;
    fs.mkdirSync(path.join(dl, m.categoryId), { recursive: true });
    fs.copyFileSync(got.file, path.join(dl, m.categoryId, m.file));
    index[`${m.categoryId}/${m.file}`] = { size: m.bytes, sha256: m.sha256, at: Date.now() };
    picked.push(m);
  }
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
  return picked;
}

/** A sandbox mod's own file, as the list recorded it, or null (with the check saying why). */
async function modFile(sim, name) {
  const m = MANIFEST.find((x) => x.name === name);
  let got = null;
  let why = 'not in tools/sandbox-mods.json';
  if (m) { try { got = await sandboxMod(m); } catch (e) { why = e.message; } }
  if (got && got.replaced) why = 'the catalog replaced it since tools/sandbox-mods.json was written';
  return sim.check(`${name} is in the sandbox`, got && got.file, why) ? got.file : null;
}

/**
 * Plays the person at the other end of a system file dialog: the next one the app opens is
 * answered with `answer` ({ filePaths } or { canceled: true }) instead of a window. The app's
 * own handler, button and import code all run as they would; only the choosing is ours, since
 * a native dialog is outside the page and out of reach of input events.
 */
function answerNextDialog(answer) {
  const { dialog } = require('electron');
  const real = dialog.showOpenDialog;
  const asked = [];
  dialog.showOpenDialog = async (...args) => {
    dialog.showOpenDialog = real;
    const opts = args.find((a) => a && typeof a === 'object' && 'properties' in a) || {};
    asked.push({ title: opts.title, properties: opts.properties });
    return answer.canceled ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: answer.filePaths };
  };
  return { asked, restore: () => { dialog.showOpenDialog = real; } };
}

async function openSection(sim, view) {
  await sim.click(`.tb-tab[data-view="${view}"]`);
  return sim.until(`document.querySelector('.tb-tab.active')?.dataset.view === ${lit(view)}
    && !document.querySelector(${lit(`.view-pane[data-pane="${view}"]`)})?.hidden && ${calm}`, 10000);
}

/**
 * Heroes as the list of every hero mod, the biggest list there is. The category opens on a grid
 * of heroes, one tile each (renderer/views/hero-grid.ts), and remembers the switch; this presses
 * "all mods as a list" when the grid is up, after checking the grid came up with its heroes.
 * @returns {Promise<number|null>} how many cards the list shows, null when it never did
 */
async function heroesList(sim) {
  const cards = `document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card').length`;
  await sim.click('.rail-item[data-cat="heroes"]');
  const shown = await sim.until(`document.querySelector('.rail-item.active')?.dataset.cat === 'heroes'
    && (document.querySelectorAll('#heroGrid .hero-tile').length > 100 ? 'grid' : ${cards} > 100 ? 'list' : null)`, 15000);
  if (shown === 'grid') {
    sim.check('Heroes opens on a grid of heroes', true);
    await sim.click('.layout-toggle [data-layout="list"]');
  }
  return sim.until(`document.querySelector('.rail-item.active')?.dataset.cat === 'heroes' && ${cards} > 100 && ${cards}`, 15000);
}

/**
 * Installs a mod from its card: the category, the card, Install, and whatever the app asks on
 * the way answered yes and written down. Says what appeared in the language folder.
 * @returns {Promise<{ pak: string|null, added: string[], asked: string|null, ok: boolean }>}
 */
async function installFromCard(sim, m, langDir) {
  await openSection(sim, 'catalog');
  await sim.click(`.rail-item[data-cat="${m.categoryId}"]`);
  await sim.until(`document.querySelector('.rail-item.active')?.dataset.cat === ${lit(m.categoryId)} && ${calm}`, 8000);
  const at = await sim.until(`(() => {
    const names = [...document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card .card-name')];
    return names.findIndex((n) => n.textContent.trim() === ${lit(m.name)}) + 1;
  })()`, 8000);
  const none = { pak: null, added: [], asked: null, ok: false };
  // the catalog is live: a mod taken down upstream since the sandbox was seeded is not a fault here
  if (!at) { sim.check(`${m.name} is still in the catalog`, true); return none; }
  const clicked = await sim.click(`.view-pane[data-pane="catalog"] .grid .card .card-name@${at}`);
  const title = clicked && await sim.until(modalOpen, 5000);
  if (!sim.check(`${m.name}: its window opens`, title === m.name,
    `${!clicked ? 'its card could not be found to click' : title ? `the window is for ${title}` : 'the overlay stayed hidden'}; the last click: ${JSON.stringify(sim.lastClick)}`)) {
    await sim.shot(`no-window-${m.categoryId}`);
    await sim.key('Escape');
    return none;
  }
  await sim.still();
  const before = listing(langDir);
  await sim.click('#installBtn');
  let asked = null;
  const done = await sim.until(`document.getElementById('uninstallBtn') ? 'done'
    : document.querySelector('.confirm-overlay')?.textContent.replace(/\\s+/g, ' ').trim()`, 60000);
  if (done && done !== 'done') {
    asked = done;
    await sim.click('.confirm-overlay [data-c="yes"]');
    await sim.until(`document.getElementById('uninstallBtn')`, 60000);
  }
  const ok = await sim.js(`!!document.getElementById('uninstallBtn')`);
  const after = listing(langDir);
  const added = Object.keys(after).filter((n) => !(n in before));
  const paks = added.filter((n) => /^pak\d+_dir\.vpk$/i.test(n));
  sim.check(`${m.name}: installed from its window`, ok && paks.length === 1,
    `the window says ${ok ? 'installed' : 'not installed'}, new files: ${added.join(', ') || 'none'}`, { asked, added });
  await sim.key('Escape');
  await sim.until(`document.getElementById('modalOverlay').classList.contains('hidden')`, 3000);
  return { pak: paks[0] || null, added, asked, ok: ok && paks.length === 1 };
}

/** The rows of My mods as the screen shows them: order, the pack file, whether it is on. */
function libraryRows(sim) {
  return sim.js(`[...document.querySelectorAll('.lib-row[data-row]')].map((r) => ({
    id: r.dataset.row,
    order: r.dataset.order == null ? null : Number(r.dataset.order),
    pak: r.querySelector('.lib-pak')?.textContent.trim() || '',
    on: r.querySelector('.toggle[data-id]')?.getAttribute('aria-checked') === 'true',
    text: r.textContent.replace(/\\s+/g, ' ').trim(),
  }))`);
}

const rowOf = (rows, name) => rows.find((r) => r.text.includes(name));

/** Switches a mod in My mods to `on`, and waits for the switch to say so. */
async function setEnabled(sim, name, on) {
  const row = rowOf(await libraryRows(sim), name);
  if (!row) return false;
  if (row.on === on) return true;
  const toggle = `.lib-row[data-row="${row.id}"] .toggle[data-id]`;
  await sim.click(toggle);
  return sim.until(`document.querySelector(${lit(toggle)})?.getAttribute('aria-checked') === ${lit(String(on))}`, 8000);
}

/** Removes a mod from My mods, confirming the question the app asks. */
async function removeFromLibrary(sim, name) {
  const row = rowOf(await libraryRows(sim), name);
  if (!row) return false;
  await sim.click(`.lib-row[data-row="${row.id}"] [data-del]`);
  if (await sim.until(`document.querySelector('.confirm-overlay [data-c="yes"]')`, 5000)) {
    await sim.still();
    await sim.click('.confirm-overlay [data-c="yes"]');
  }
  return sim.until(`!document.querySelector(${lit(`.lib-row[data-row="${row.id}"]`)})`, 10000);
}

/** The app's game, and the language folder the engine mounts, as the app sees them. */
async function gameOf(sim) {
  const s = await sim.js('window.api.settings.get()');
  const game = s.dotaGamePath;
  if (!sim.check('the app has a game to work on', game && s.dotaPathValid, JSON.stringify({ game, valid: s.dotaPathValid }))) return null;
  const folder = `dota_${dota.mountedLanguage(game)}`;
  const langDir = path.join(game, folder);
  fs.mkdirSync(langDir, { recursive: true });
  return { game, folder, langDir };
}

/** A check that the game would load its folders at all: every pack opens, the schema holds. */
function gameLoads(sim, game, when) {
  const r = dota.checkGame(game);
  sim.check(`the game would load its folders ${when}`, r.ok, r.problems.join(' | '), { mounts: r.mounts });
  return r;
}

/** Our mods' packs the game mounts in the language folder right now. The app's own pak64 (the
 *  anti-cheat notice, src/notice-text.js) is not a mod: the master switch leaves it on by design. */
function mountedOurs(game, folder) {
  return dota.load(game).paks.filter((p) => p.folder === folder && !p.valve && !isAppPak(String(p.name).toLowerCase())).map((p) => p.name);
}

/** A pack's own files, and for each where the game would read it from. */
function whoServes(game, folder, pak) {
  const loaded = dota.load(game);
  const mine = [];
  const lost = {};
  for (const [rel] of listVpkPathCrcsFile(path.join(game, folder, pak))) {
    const w = loaded.resolve(rel);
    const by = w ? `${w.folder}/${w.pak || '(loose)'}` : 'nothing';
    if (w && w.folder === folder && w.pak === pak) mine.push(rel);
    else lost[by] = (lost[by] || 0) + 1;
  }
  return { files: mine.length + Object.values(lost).reduce((a, b) => a + b, 0), served: mine.length, lost };
}

module.exports = {
  calm, modalOpen, listing, listingDiff, readyMods, openSection, heroesList, installFromCard,
  libraryRows, rowOf, setEnabled, removeFromLibrary, gameOf, gameLoads, mountedOurs, whoServes,
  modFile, answerNextDialog,
};
