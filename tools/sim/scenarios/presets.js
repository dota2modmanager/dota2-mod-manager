/**
 * A preset saved, applied over a changed state, applied again after one of its mods was deleted,
 * and deleted, with the game's reading checked each time.
 *
 * What the app promises (src/ipc-presets.js, renderer/views/presets.js): a preset remembers which
 * mods are on; applying it switches those on and every other mod off; a member that is no longer
 * installed is fetched back from the catalog first, and the toast says how many were.
 *
 * Three real mods from the sandbox (tools/sim/steps.js): A and B go into the preset, C is the
 * one installed after it.
 */
const { lit } = require('../driver');
const steps = require('../steps');

const A = 'Bare Brewmaster';
const B = 'Aghanim Labyrinth';
const C = 'Winter Versus Screen';
// no space: the driver types one key at a time and a name is all this needs to be
const NAME = 'SimBuild';

module.exports = async function presets(sim) {
  const where = await steps.gameOf(sim);
  if (!where) return;
  const { game, folder, langDir } = where;
  const pristine = steps.listing(langDir);

  const picked = await steps.readyMods(sim, [A, B, C]);
  if (!sim.check('the three mods the preset run needs are available', picked.length === 3, `${picked.length} of 3`)) return;
  const mod = (name) => picked.find((m) => m.name === name);

  // the pack each mod has now, read off My mods, and what the game mounts, as names
  const state = async () => {
    await steps.openSection(sim, 'library');
    const rows = await steps.libraryRows(sim);
    const mounted = steps.mountedOurs(game, folder);
    const out = {};
    for (const name of [A, B, C]) {
      const r = steps.rowOf(rows, name);
      out[name] = !r ? 'absent' : mounted.includes(r.pak) ? 'loaded' : 'not loaded';
    }
    return out;
  };

  // ---- A and B on, saved as a preset ----
  for (const name of [A, B]) await steps.installFromCard(sim, mod(name), langDir);
  await steps.openSection(sim, 'presets');
  await sim.click('#presetName');
  await sim.type(NAME);
  await sim.click('#savePresetBtn');
  const saved = await sim.until(`(async () => {
    const p = (await window.api.presets.list()).find((x) => x.name === ${lit(NAME)});
    return p && [...document.querySelectorAll('.preset-card .preset-name')].some((n) => n.textContent.trim() === ${lit(NAME)}) && p;
  })()`, 8000);
  if (!sim.check('a preset is saved from the current state, with the two mods that are on', saved && saved.modIds.length === 2,
    saved ? `it holds ${saved.modIds.length} mod(s)` : 'no card for it after 8 s')) return;
  await sim.settle(500);
  await sim.shot('saved');

  // ---- the state moves on: B off, C installed ----
  await steps.openSection(sim, 'library');
  await steps.setEnabled(sim, B, false);
  await steps.installFromCard(sim, mod(C), langDir);
  const moved = await state();
  sim.check('before applying: A and C loaded, B not', moved[A] === 'loaded' && moved[B] === 'not loaded' && moved[C] === 'loaded',
    JSON.stringify(moved), moved);

  // ---- applied: exactly A and B ----
  /* Only a toast that appears after the click answers it. The second apply used to find the
     first one's "Preset applied" still on screen, read it before its own arrived, and fail
     for a missing "installed 1" on a run where the app had installed it (Windows CI, #175). */
  const apply = async () => {
    await steps.openSection(sim, 'presets');
    await sim.js(`document.querySelectorAll('#toasts .toast').forEach((t) => { t.dataset.simSeen = '1'; })`);
    await sim.click(`[data-apply="${saved.id}"]`);
    const fresh = `[...document.querySelectorAll('#toasts .toast:not([data-sim-seen])')]`;
    await sim.until(`/Пресет применён|Preset applied/.test(${fresh}.map((t) => t.textContent).join(' '))`, 60000);
    const said = await sim.js(`${fresh}.map((t) => t.textContent.trim()).join(' | ')`);
    await sim.settle(800);
    return said;
  };
  const said1 = await apply();
  const applied = await state();
  sim.check('applying the preset: the game loads A and B, and not C', applied[A] === 'loaded' && applied[B] === 'loaded' && applied[C] === 'not loaded',
    `${JSON.stringify(applied)}; toasts: ${said1}`, applied);
  steps.gameLoads(sim, game, 'after applying the preset');
  await sim.shot('applied');

  // ---- B deleted: applying fetches it back from the catalog ----
  await steps.removeFromLibrary(sim, B);
  sim.check('B deleted: the game no longer has it', (await state())[B] === 'absent');
  const said2 = await apply();
  const back = await state();
  sim.check('applying again installs the deleted member first, and says so',
    back[A] === 'loaded' && back[B] === 'loaded' && back[C] === 'not loaded' && /доустановлено 1|installed 1/i.test(said2),
    `${JSON.stringify(back)}; toasts: ${said2}`, back);
  steps.gameLoads(sim, game, 'after applying a preset with a deleted member');

  // ---- the preset deleted, from its menu ----
  await steps.openSection(sim, 'presets');
  const at = await sim.js(`[...document.querySelectorAll('.preset-card .preset-name')].findIndex((n) => n.textContent.trim() === ${lit(NAME)}) + 1`);
  await sim.rightClick(`.preset-card .preset-name@${at}`);
  await sim.until(`document.querySelector('.ctx-menu .ctx-item')`, 3000);
  const delAt = await sim.js(`[...document.querySelectorAll('.ctx-menu .ctx-item')].findIndex((b) => /Удалить|Delete/.test(b.textContent)) + 1`);
  if (sim.check('the preset menu offers to delete it', delAt > 0)) {
    await sim.click(`.ctx-menu .ctx-item@${delAt}`);
    if (await sim.until(`document.querySelector('.confirm-overlay [data-c="yes"]')`, 5000)) {
      await sim.still();
      await sim.click('.confirm-overlay [data-c="yes"]');
    }
    const gone = await sim.until(`(async () => !(await window.api.presets.list()).some((x) => x.name === ${lit(NAME)})
      && ![...document.querySelectorAll('.preset-card .preset-name')].some((n) => n.textContent.trim() === ${lit(NAME)}))()`, 8000);
    sim.check('the preset is deleted, and its card with it', gone);
  }

  // ---- everything removed, the folder as it was ----
  await steps.openSection(sim, 'library');
  for (const name of [A, B, C]) await steps.removeFromLibrary(sim, name);
  await sim.settle(600);
  const diff = steps.listingDiff(pristine, steps.listing(langDir));
  sim.check('after removing everything, the language folder is as it was found', !diff, diff);
};
