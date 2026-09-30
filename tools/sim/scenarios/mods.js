/**
 * Real mods in and out of the game, through the window, with the game's own reading checked
 * after every step.
 *
 * tools/e2e.mjs already presses Install, the switch and Remove on one fixture mod and compares
 * the folder byte for byte. This asks the question that test cannot: what would the game show?
 * After each step tools/sim/dota.js mounts the folders the way the engine does and says which
 * file comes from which pack, so "installed" means "the game reads it", "off" means "the game
 * does not", and the order in My mods means the order the game uses.
 *
 * The mods are the sandbox's real ones (tools/sandbox-mods.json), put into the app's download
 * cache the way a download leaves them (tools/sim/steps.js).
 *
 * Steps: seven mods installed from their cards; two emblems that replace the same files, so the
 * one listed first must be the one the game shows, and moving the other up must flip it; a mod
 * switched off and on; the master switch off and on; everything removed, and the language folder
 * left as it was found.
 */
const fs = require('fs');
const path = require('path');
const dota = require('../dota');
const { lit } = require('../driver');
const { listVpkPathCrcsFile } = require('../../../src/vpk.ts');
const steps = require('../steps');

// small, different kinds, and two that fight over the same files
const PICK = [
  'Bare Brewmaster', 'IO Purple', 'Aghanim Labyrinth', 'Remove Seasonal Effects',
  'Winter Versus Screen', 'Emblem of the Diretide Green', 'Emblem of the Diretide Blue',
];
const RIVALS = ['Emblem of the Diretide Green', 'Emblem of the Diretide Blue'];

module.exports = async function mods(sim) {
  const where = await steps.gameOf(sim);
  if (!where) return;
  const { game, folder, langDir } = where;
  const pristine = steps.listing(langDir);

  const picked = await steps.readyMods(sim, PICK);
  if (!sim.check('enough of the picked mods are available to mean something', picked.length >= 5,
    `${picked.length} of ${PICK.length}: refresh tools/sandbox-mods.json (npm run sandbox:seed)`)) return;

  // ---- install, from the card, each checked by the game ----
  const installed = [];
  for (const m of picked) {
    const r = await steps.installFromCard(sim, m, langDir);
    if (!r.pak) continue;
    const who = steps.whoServes(game, folder, r.pak);
    // A pack in the language folder can lose a file only to one loaded before it: another of
    // our mods the list puts higher, which is the list working (the rivals below check exactly
    // that), or Valve's own pak01 there, which would mean the mod never shows at all.
    const ourEarlier = (k) => installed.some((x) => `${folder}/${x.pak}` === k);
    const foreign = Object.keys(who.lost).filter((k) => !ourEarlier(k));
    sim.check(`${m.name}: every file of it reaches the game, or loses only to a mod listed before it`,
      who.files > 0 && !foreign.length, `${who.served} of ${who.files} served, lost: ${JSON.stringify(who.lost)}`, who);
    installed.push({ ...m, pak: r.pak });
    steps.gameLoads(sim, game, `after installing ${m.name}`);
  }

  // ---- My mods: the order on screen is the order in the game ----
  await steps.openSection(sim, 'library');
  await sim.until(`document.querySelectorAll('.lib-row[data-row]').length >= ${installed.length}`, 10000);
  await sim.settle(600);
  await sim.shot('library-installed');
  let list = await steps.libraryRows(sim);
  sim.check('My mods lists every mod installed', installed.every((m) => steps.rowOf(list, m.name)),
    `missing: ${installed.filter((m) => !steps.rowOf(list, m.name)).map((m) => m.name).join(', ')}`, list);

  const rivals = RIVALS.map((n) => installed.find((m) => m.name === n)).filter(Boolean);
  if (rivals.length === 2) {
    // which rival My mods lists first, and which pack the game takes their shared files from
    const standing = async () => {
      list = await steps.libraryRows(sim);
      const [a, b] = rivals.map((m) => ({ name: m.name, row: steps.rowOf(list, m.name) }));
      const [top, other] = a.row.order < b.row.order ? [a, b] : [b, a];
      const loaded = dota.load(game);
      const theirs = new Set([...listVpkPathCrcsFile(path.join(langDir, other.row.pak))].map(([rel]) => rel));
      const shared = [...listVpkPathCrcsFile(path.join(langDir, top.row.pak))].map(([rel]) => rel).filter((rel) => theirs.has(rel));
      const winners = [...new Set(shared.map((rel) => loaded.resolve(rel)?.pak))];
      return { top: top.name, topPak: top.row.pak, other: other.name, otherPak: other.row.pak, shared: shared.length, winners };
    };
    const shows = (r) => r.shared > 0 && r.winners.length === 1 && r.winners[0] === r.topPak;
    const first = await standing();
    sim.check('two mods that replace the same files: the game shows the one My mods lists first', shows(first), JSON.stringify(first), first);

    // The one below is moved up from its row's menu, one step at a time, the way the list offers
    // it, until it is above the other: that has to change what the game shows.
    const mover = first.other;
    let menuSeen = false;
    for (let step = 0; step < installed.length; step++) {
      const row = steps.rowOf(await steps.libraryRows(sim), mover);
      await sim.rightClick(`.lib-row[data-row="${row.id}"] .lib-pak`);
      const menu = await sim.until(`[...document.querySelectorAll('.ctx-menu .ctx-item')].map((b) => b.textContent.trim()).join(' | ')`, 3000);
      const upAt = await sim.js(`[...document.querySelectorAll('.ctx-menu .ctx-item')].findIndex((b) => /Загружать раньше|Load earlier/.test(b.textContent)) + 1`);
      if (!menuSeen && !sim.check('the row menu offers to load a mod earlier', upAt > 0, `menu: ${menu}`)) break;
      menuSeen = true;
      await sim.click(`.ctx-menu .ctx-item@${upAt}`);
      await sim.until(`(() => { const r = [...document.querySelectorAll('.lib-row[data-row]')].find((x) => x.textContent.includes(${lit(mover)})); return r && Number(r.dataset.order) < ${row.order}; })()`, 10000);
      await sim.settle(400);
      if ((await standing()).top === mover) break;
    }
    const after = await standing();
    sim.check(`after moving ${mover} above ${first.top}, the game shows ${mover} instead`,
      after.top === mover && shows(after), JSON.stringify(after), after);
    steps.gameLoads(sim, game, 'after changing the order');
    await sim.shot('library-reordered');
  }

  // ---- one mod off and on ----
  const one = installed.find((m) => m.name === 'Bare Brewmaster') || installed[0];
  if (one) {
    const row = steps.rowOf(await steps.libraryRows(sim), one.name);
    await steps.setEnabled(sim, one.name, false);
    await sim.settle(400);
    const mounted = steps.mountedOurs(game, folder).includes(row.pak);
    sim.check(`${one.name} switched off: the game no longer loads its pack`, !mounted && fs.existsSync(path.join(langDir, `${row.pak}.off`)),
      `pack still mounted: ${mounted}, files: ${Object.keys(steps.listing(langDir)).filter((n) => n.startsWith(row.pak)).join(', ')}`);
    await steps.setEnabled(sim, one.name, true);
    await sim.settle(400);
    const back = steps.whoServes(game, folder, row.pak);
    sim.check(`${one.name} switched on again: the game reads it again`, back.served > 0, JSON.stringify(back));
  }

  // ---- the master switch ----
  const ours = () => steps.mountedOurs(game, folder);
  await sim.click('#modsMasterBtn');
  await sim.until(`document.getElementById('modsMasterBtn')?.getAttribute('aria-checked') === 'false'`, 15000);
  await sim.settle(600);
  sim.check('mods switched off at the master switch: the game loads none of them', ours().length === 0, `still mounted: ${ours().join(', ')}`);
  steps.gameLoads(sim, game, 'with every mod off');
  await sim.shot('library-master-off');
  await sim.click('#modsMasterBtn');
  await sim.until(`document.getElementById('modsMasterBtn')?.getAttribute('aria-checked') === 'true'`, 15000);
  await sim.settle(600);
  sim.check('mods switched back on: the game loads all of them again', ours().length === installed.length,
    `${ours().length} of ${installed.length} mounted`);

  // ---- everything removed, the folder as it was ----
  for (const m of installed) {
    sim.check(`${m.name}: removed from My mods`, await steps.removeFromLibrary(sim, m.name), 'the row is still there');
  }
  await sim.settle(600);
  const diff = steps.listingDiff(pristine, steps.listing(langDir));
  sim.check('after removing everything, the language folder is as it was found', !diff, diff);
  steps.gameLoads(sim, game, 'after removing everything');
};
