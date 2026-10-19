/**
 * The pictures of the app the site's guides show (site/src/i18n/docs.ts, "shot" blocks), taken in
 * the sandbox by the app itself, in English and in Russian.
 *
 * Not a test of anything: tools/guide-shots.mjs runs only this scenario (run.mjs leaves it out of
 * every other run), crops each picture to the part of the window its guide talks about, the
 * rectangle written beside it, and writes them into site/public/guides/. A guide that says "press
 * Install" then shows the Install button as it looks today, and when the window changes, one
 * command takes them all again.
 *
 * A few of the sandbox's own mods are installed first, so My mods has something in it.
 */
const fs = require('fs');
const path = require('path');
const { lit } = require('../driver');
const steps = require('../steps');

// small, and different enough to make My mods look like somebody's
const PICK = ['IO Purple', 'Aghanim Labyrinth', 'Winter Versus Screen', 'Pumpkin Trees'];
// the mod whose window the install guide shows: one that is not installed, so its button says Install
const SHOWN = 'Bare Brewmaster';

/* Where on the window a part lies, in CSS pixels, worked out in the page. `part` is the element;
   `last` ends it at the bottom of the last element matching it (My mods ends at its last row);
   a part never runs under the status bar unless it is in it. */
const RECT = `(sel, last) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  let bottom = b.bottom;
  if (last) { const all = document.querySelectorAll(last); if (all.length) bottom = Math.min(bottom, all[all.length - 1].getBoundingClientRect().bottom + 24); }
  const bar = document.getElementById('statusbar');
  if (bar && !bar.contains(el) && !el.closest('.safe-box')) bottom = Math.min(bottom, bar.getBoundingClientRect().top);
  return { x: b.x, y: b.y, w: b.width, h: bottom - b.y, vw: innerWidth, vh: innerHeight };
}`;

module.exports = async function guideShots(sim) {
  const where = await steps.gameOf(sim);
  if (!where) return;
  const picked = await steps.readyMods(sim, [...PICK, SHOWN]);
  for (const m of picked.filter((x) => x.name !== SHOWN)) await steps.installFromCard(sim, m, where.langDir);

  const taken = {};
  const save = async (name, rect) => {
    const lang = await sim.js('document.documentElement.lang');
    const { file, image } = await sim.shot(`${name}-${lang}`);
    taken[`${name}-${lang}`] = { file: path.basename(file), rect, image: image.getSize() };
    sim.check(`${name} (${lang}): the part to show is on screen`, !!rect && rect.w > 0 && rect.h > 0, JSON.stringify(rect));
  };
  /** The window with nothing passing over it (a toast says what just happened, not what a guide shows). */
  const take = async (name, selector, last = null) => {
    await sim.settle(900);
    await sim.js(`document.querySelectorAll('#toasts > *').forEach((t) => t.remove())`);
    await sim.settle(200);
    await save(name, await sim.js(`(${RECT})(${lit(selector)}, ${lit(last)})`));
  };

  const pick = async (lang) => {
    await steps.openSection(sim, 'settings');
    const now = await sim.js('document.getElementById("uiLangSelect").value');
    if (now !== lang) {
      await sim.click('#uiLangSelect');
      await sim.key('Escape');
      await sim.key(lang === 'en' ? 'Home' : now === 'en' ? 'Down' : 'Up');
    }
    return sim.until(`document.documentElement.lang === ${lit(lang)}`, 10000);
  };
  const safeOn = () => sim.js('document.getElementById("safeModeBtn").getAttribute("aria-checked") === "true"');

  for (const lang of ['en', 'ru']) {
    if (!sim.check(`the interface is in ${lang}`, await pick(lang))) continue;

    // the install guide: a mod's window, its Install button in reach
    await steps.categoryList(sim, 'heroes');
    const at = await sim.until(`[...document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card .card-name')].findIndex((n) => n.textContent.trim() === ${lit(SHOWN)}) + 1`, 8000);
    if (sim.check(`${SHOWN} is in the heroes list to open`, !!at)) {
      await sim.click(`.view-pane[data-pane="catalog"] .grid .card .card-name@${at}`);
      await sim.until(`!document.getElementById('modalOverlay').classList.contains('hidden') && document.getElementById('installBtn')`, 8000);
      await sim.still();
      await take('mod-window', '#modalContent');
      await sim.key('Escape');
      await sim.until(`document.getElementById('modalOverlay').classList.contains('hidden')`, 3000);
    }

    // a category as a guide sends you to it
    for (const [name, cat] of [['terrains', 'terrains'], ['announcers', 'announcers'], ['tools', 'tools']]) {
      if (!(await steps.categoryList(sim, cat))) continue;
      await sim.js(`document.getElementById('main')?.scrollTo({ top: 0 })`);
      await take(name, '#main');
    }

    // My mods: the switches, the order, the way to delete
    await steps.openSection(sim, 'library');
    await sim.until(`document.querySelectorAll('.lib-row[data-row]').length >= ${Math.min(2, picked.length - 1)}`, 10000);
    await take('my-mods', '#main', '.lib-row[data-row]');

    // safe mode: the switch at the bottom, from it to Play
    await sim.settle(600);
    await sim.js(`document.querySelectorAll('#toasts > *').forEach((t) => t.remove())`);
    await save('safe-mode', await sim.js(`(() => {
      const bar = document.getElementById('statusbar').getBoundingClientRect();
      const from = document.getElementById('safeModeBtn').getBoundingClientRect();
      return { x: from.left - 14, y: bar.top, w: bar.right - from.left + 14, h: bar.height, vw: innerWidth, vh: innerHeight };
    })()`));

    // ... and what the app says before it turns it off, which is the whole of the second mechanism
    if (await safeOn()) {
      await sim.click('#safeModeBtn');
      if (await sim.until(`document.querySelector('.safe-box [data-c="yes"]')`, 5000)) {
        await sim.still();
        await take('safe-confirm', '.safe-box');
        await sim.click('.safe-box [data-c="yes"]');
      }
    }
    // free cosmetics, which need it off
    if (await sim.until(`document.getElementById('safeModeBtn').getAttribute('aria-checked') === 'false'`, 15000)) {
      await steps.openSection(sim, 'catalog');
      const slot = await sim.until(`document.querySelector('.rail-item[data-cat^="cos:"], .rail-item[data-cat^="cosmetic"]')?.dataset.cat || null`, 8000);
      if (sim.check('the catalog lists free cosmetics with safe mode off', !!slot)) {
        await sim.click(`.rail-item[data-cat="${slot}"]`);
        await sim.until(`document.querySelector('.rail-item.active')?.dataset.cat === ${lit(slot)}`, 8000);
        await sim.settle(1500);
        await take('cosmetics', '#main');
      }
      // and back on, as the sandbox was
      await sim.click('#safeModeBtn');
      await sim.until(`document.getElementById('safeModeBtn').getAttribute('aria-checked') === 'true'`, 15000);
    }
  }

  fs.writeFileSync(path.join(sim.out, 'guide-shots.json'), JSON.stringify(taken, null, 1));
};
