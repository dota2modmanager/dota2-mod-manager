/**
 * Mods brought in by hand: .vpk files picked in the system dialog, a folder of them, and the
 * dialog cancelled. The files are real catalog mods renamed the way they sit in a Downloads
 * folder, so the app has to recognise them by their contents and offer to link them to the
 * catalog; linking must give them their catalog names. After each step the game's reading is
 * checked, and at the end the language folder must be as it was found.
 *
 * The system dialog is outside the page, so the choice made in it is played by
 * steps.answerNextDialog; the button, the app's handler and its import code all run for real.
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const steps = require('../steps');

const FILES = ['Emblem of the Diretide Green', 'Aghanim Labyrinth'];
const IN_FOLDER = 'Winter Versus Screen';

const toastsText = (sim) => sim.js(`[...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent.trim()).join(' | ')`);

module.exports = async function importMods(sim) {
  const where = await steps.gameOf(sim);
  if (!where) return;
  const { game, folder, langDir } = where;
  const pristine = steps.listing(langDir);

  // a Downloads folder: the mods under names nobody chose for the catalog
  const downloads = fs.mkdtempSync(path.join(app.getPath('temp'), 'mm-sim-import-'));
  const picked = [];
  for (const [i, name] of FILES.entries()) {
    const file = await steps.modFile(sim, name);
    if (!file) continue;
    const to = path.join(downloads, `download (${i + 1}).vpk`);
    fs.copyFileSync(file, to);
    picked.push({ name, file: to });
  }
  const folderMod = await steps.modFile(sim, IN_FOLDER);
  const packFolder = path.join(downloads, 'some pack');
  fs.mkdirSync(packFolder);
  if (folderMod) fs.copyFileSync(folderMod, path.join(packFolder, 'versus.vpk'));
  if (!sim.check('the files the import run needs are available', picked.length === FILES.length && folderMod)) return;

  try {
    await steps.openSection(sim, 'library');

    // ---- cancelled: nothing happens ----
    const before = steps.listing(langDir);
    const cancel = steps.answerNextDialog({ canceled: true });
    await sim.click('#importVpkBtn');
    for (let t = 0; t < 50 && !cancel.asked.length; t++) await new Promise((r) => setTimeout(r, 100));
    await sim.settle(800);
    cancel.restore();
    sim.check('the Import VPK button opens the file dialog', cancel.asked.length === 1 && cancel.asked[0].properties.includes('multiSelections'),
      JSON.stringify(cancel.asked));
    sim.check('a cancelled import dialog changes nothing', !steps.listingDiff(before, steps.listing(langDir)),
      steps.listingDiff(before, steps.listing(langDir)));

    // ---- two files picked ----
    const pick = steps.answerNextDialog({ filePaths: picked.map((p) => p.file) });
    await sim.click('#importVpkBtn');
    const said = await sim.until(`/Импортировано: 2|Imported: 2/.test([...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' '))`, 20000);
    pick.restore();
    sim.check('picking two .vpk files imports two mods, and says so', said, `toasts: ${await toastsText(sim)}`);
    await sim.until(`document.querySelectorAll('.lib-row[data-row]').length >= 2`, 8000);
    await sim.settle(600);
    let rows = await steps.libraryRows(sim);
    // the words of the banner that carries "Link all", not the icon's ligature beside them
    const recognised = await sim.until(`document.getElementById('adoptAllBtn')?.closest('.banner')?.querySelector('.banner-body')?.textContent.replace(/\\s+/g, ' ').trim()`, 8000);
    sim.check('the imported files are recognised as catalog mods, and the app offers to link them', recognised && /\b2\b/.test(recognised),
      `banner: ${recognised || 'none'}`);
    for (const r of rows) {
      const who = r.pak ? steps.whoServes(game, folder, r.pak) : null;
      sim.check(`imported ${r.pak || r.text.slice(0, 30)}: the game reads it`, who && who.served > 0, JSON.stringify(who));
    }
    steps.gameLoads(sim, game, 'after importing two files');
    await sim.shot('imported');

    // ---- linked to the catalog: their catalog names ----
    // A press that lands while My mods is drawn again (a banner arriving, the list re-listing) goes
    // to a button that is gone by the time the mouse comes up, and nothing happens: on Windows CI
    // on 2026-09-26 the banner and the button were still there afterwards. A person presses again,
    // and so does this, while the button is there and nothing said it linked. The app runs one
    // link at a time, so a second press on a slow one changes nothing.
    let linked = null;
    for (let i = 0; i < 3 && !linked; i++) {
      if (!(await sim.js(`!!document.getElementById('adoptAllBtn')`))) break;
      await sim.click('#adoptAllBtn');
      linked = await sim.until(`/Привязано: 2|Linked: 2/.test([...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' '))`, 8000);
    }
    // the offer to link goes once there is nothing left to link: a recognised file already shows
    // its catalog name as a chip, so the names alone passed while nothing had been linked
    const offerGone = await sim.until(`!document.getElementById('adoptAllBtn')`, 8000);
    await sim.settle(600);
    rows = await steps.libraryRows(sim);
    const named = FILES.filter((n) => steps.rowOf(rows, n));
    sim.check('"Link all" gives both their catalog names', linked && offerGone && named.length === FILES.length,
      `named: ${named.join(', ') || 'none'}; offer gone: ${!!offerGone}; last press: ${JSON.stringify(sim.lastClick)}; rows: ${rows.map((r) => r.text.slice(0, 40)).join(' | ')}; toasts: ${await toastsText(sim)}`);
    for (const n of named) {
      const r = steps.rowOf(rows, n);
      sim.check(`${n}, linked: the game still reads it`, steps.whoServes(game, folder, r.pak).served > 0);
    }
    await sim.shot('linked');

    // ---- a folder ----
    const count = rows.length;
    const dir = steps.answerNextDialog({ filePaths: [packFolder] });
    await sim.click('#importFolderBtn');
    const one = await sim.until(`document.querySelectorAll('.lib-row[data-row]').length > ${count}`, 20000);
    dir.restore();
    sim.check('Import folder opens a folder dialog', dir.asked.length === 1 && dir.asked[0].properties.includes('openDirectory'), JSON.stringify(dir.asked));
    sim.check('importing a folder brings in the mod inside it', one, `rows: ${(await steps.libraryRows(sim)).length}, toasts: ${await toastsText(sim)}`);
    steps.gameLoads(sim, game, 'after importing a folder');

    // ---- everything removed, the folder as it was ----
    // by the text each row shows: the folder's mod may or may not have been linked to its name
    for (const r of await steps.libraryRows(sim)) {
      sim.check(`removed from My mods: ${r.pak}`, await steps.removeFromLibrary(sim, r.text));
    }
    await sim.settle(600);
    const diff = steps.listingDiff(pristine, steps.listing(langDir));
    sim.check('after removing everything, the language folder is as it was found', !diff, diff);
  } finally {
    fs.rmSync(downloads, { recursive: true, force: true });
  }
};
