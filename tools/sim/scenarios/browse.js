/**
 * Everywhere a person can get to, reached the way they reach it.
 *
 * The four sections by their tabs and by Ctrl+1..4, every category in the rail, the search box,
 * and the mod window: opened from a card, its looks switched, closed by Escape, by its button
 * and by a click beside it. At each stop the run asks the same things - did it open, does it
 * fit the window, is what is on screen what the page would draw from scratch - and keeps a
 * picture, so a report shows every screen of the app on the machine it ran on.
 *
 * It installs nothing and changes no setting: it can run first, on any machine, and leave the
 * sandbox as it found it.
 */
const { lit } = require('../driver');
const steps = require('../steps');

const SECTIONS = ['catalog', 'library', 'presets', 'settings'];

const paneShown = (view) => `(() => {
  const p = document.querySelector('.view-pane[data-pane="${view}"]');
  return !!p && !p.hidden && p.childElementCount > 0;
})()`;

const modalOpen = `!document.getElementById('modalOverlay').classList.contains('hidden')
  && !document.getElementById('modalOverlay').classList.contains('closing')
  && document.querySelector('#modalContent .modal-title')?.textContent.trim()`;
const modalClosed = `document.getElementById('modalOverlay').classList.contains('hidden')`;

// a screen change animates for about 300 ms; a person rarely clicks inside it, a script always does
const calm = `!document.documentElement.classList.contains('vt-screen')`;

// a playing preview changes between two frames on its own, which is not the page drawing wrong
const stopVideos = `document.querySelectorAll('video').forEach((v) => v.pause()), true`;

module.exports = async function browse(sim) {
  // ---- the four sections, by their tabs ----
  for (const view of SECTIONS) {
    await sim.click(`.tb-tab[data-view="${view}"]`);
    const shown = await sim.until(`${paneShown(view)} && ${calm}`, 15000);
    if (!sim.check(`the ${view} section opens from its tab`, shown, 'its pane stayed hidden or empty for 15 s')) continue;
    await sim.move(sim.x, 8); // off anything that lifts on hover
    await sim.settle(700);
    await sim.layout(view);
    await sim.integrity(`section-${view}`);
    await sim.shot(`section-${view}`);
  }

  // ---- and by the keyboard ----
  for (const [i, view] of SECTIONS.entries()) {
    await sim.key(String(i + 1), ['control']);
    const on = await sim.until(`document.querySelector('.tb-tab.active')?.dataset.view === '${view}' && ${paneShown(view)} && ${calm}`, 8000);
    sim.check(`Ctrl+${i + 1} opens the ${view} section`, on, `the active tab is ${await sim.js(`document.querySelector('.tb-tab.active')?.dataset.view`)}`);
  }

  // ---- two tabs in a row, faster than the screen change between them ----
  // The browser aimed every click at the page root while it animated, and the second tab did
  // nothing (2026-09-24). Three presses as fast as a hand makes them.
  await sim.click('.tb-tab[data-view="catalog"]');
  await sim.until(calm, 3000);
  await sim.click('.tb-tab[data-view="settings"]');
  await sim.click('.tb-tab[data-view="library"]');
  await sim.click('.tb-tab[data-view="presets"]');
  const last = await sim.until(`document.querySelector('.tb-tab.active')?.dataset.view === 'presets' && ${paneShown('presets')}`, 5000);
  sim.check('tabs pressed in quick succession all land', last,
    `the window ended on ${await sim.js(`document.querySelector('.tb-tab.active')?.dataset.view`)}`);

  // ---- a search typed on another section ----
  // The catalog draws the results, and it came back as it was left: the home screen, with the
  // query in the box and no results (2026-09-24).
  await sim.until(calm, 3000);
  await sim.key('f', ['control']);
  await sim.type('Pudge');
  const results = await sim.until(`document.querySelector('.tb-tab.active')?.dataset.view === 'catalog'
    && /Pudge/.test(document.querySelector('.view-pane[data-pane="catalog"] .view-title')?.textContent || '')`, 5000);
  sim.check('a search typed on another section opens its results', results,
    `the catalog shows "${await sim.js(`document.querySelector('.view-pane[data-pane="catalog"] .view-title')?.textContent || 'the home screen'`)}"`);
  await sim.key('Escape');
  await sim.until(`document.getElementById('globalSearch').value === ''`, 3000);
  await sim.key('Escape');

  // ---- every category in the rail ----
  await sim.click('.tb-tab[data-view="catalog"]');
  await sim.until(paneShown('catalog'), 8000);
  await sim.until(calm, 3000);
  const cats = await sim.js(`[...document.querySelectorAll('.rail-item[data-cat]')].map((b) => b.dataset.cat)`);
  sim.check('the rail lists categories', cats.length > 3, `only ${cats.length}`, { cats });
  // mods tagged adult are left out until the user said yes to them (renderer/core/adult.js)
  const counted = await sim.js(`(async () => {
    const c = await window.api.catalog.load(false);
    const adult = (await window.api.settings.get()).showAdult === true;
    const data = (c && c.mods && c.mods.modsData) || {};
    const out = {};
    for (const [id, v] of Object.entries(data)) {
      out[id] = Array.isArray(v) ? v.filter((m) => adult || !(m && m.tags && m.tags.adult)).length : null;
    }
    return out;
  })()`);
  for (const cat of cats) {
    if (!await sim.click(`.rail-item[data-cat="${cat}"]`)) {
      sim.check(`category ${cat} can be clicked`, false, 'the rail item has no box');
      continue;
    }
    const active = await sim.until(`document.querySelector('.rail-item[data-cat="${cat}"]')?.classList.contains('active')`, 8000);
    sim.check(`category ${cat} opens`, active, 'its rail item never became the active one');
    await sim.settle(500);
    const shown = await sim.js(`(() => {
      const pane = document.querySelector('.view-pane[data-pane="catalog"]');
      return {
        cards: pane.querySelectorAll('.grid .card').length,
        // Heroes opens on one tile per hero, each saying how many mods it holds
        tiles: pane.querySelector('#heroGrid')
          ? [...pane.querySelectorAll('#heroGrid .hero-count')].reduce((n, t) => n + Number(t.textContent), 0) : null,
        title: pane.querySelector('.view-title')?.textContent.trim() || '',
        empty: pane.querySelector('.empty-note, .empty-state')?.textContent.trim() || '',
      };
    })()`);
    // "all" is the home screen and "favorites" is empty on a fresh profile; the others are the
    // catalog's own lists, and a card missing from one is a mod nobody can find
    const expected = counted[cat];
    if (typeof expected === 'number' && !['tools', 'packs'].includes(cat)) {
      const got = shown.tiles ?? shown.cards;
      sim.check(`category ${cat} shows every mod the catalog has in it`, got === expected,
        `${got} ${shown.tiles === null ? 'cards' : 'mods on the hero tiles'} for ${expected} mods`, shown);
    }
    await sim.move(sim.x, 8);
    await sim.settle(400);
    await sim.layout(`category ${cat}`);
    await sim.integrity(`category-${cat}`);
    await sim.shot(`category-${cat}`);
  }

  // ---- the search box ----
  await sim.click('.rail-item[data-cat="all"]');
  await sim.until(calm, 3000);
  await sim.key('f', ['control']);
  const focused = await sim.until(`document.activeElement?.id === 'globalSearch'`, 3000);
  sim.check('Ctrl+F puts the cursor in the search box', focused, `focus is on ${await sim.js(`document.activeElement?.id || document.activeElement?.tagName`)}`);
  // the first word of a real mod's name, so the search has something to find on any catalog
  const word = await sim.js(`(async () => {
    const c = await window.api.catalog.load(false);
    const heroes = c?.mods?.modsData?.heroes || [];
    const m = heroes.find((x) => /^[A-Za-z]{4,}/.test(x.name || ''));
    return m ? /^[A-Za-z]+/.exec(m.name)[0] : 'Pudge';
  })()`);
  await sim.type(word);
  // the results screen, not the cards of the screen it replaces
  const found = await sim.until(`document.querySelector('.view-pane[data-pane="catalog"] .view-title')?.textContent.includes(${lit(word)})
    && document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card').length`, 8000);
  const wrong = await sim.js(`[...document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card')]
    .filter((c) => !c.textContent.toLowerCase().includes(${lit(word.toLowerCase())})).length`);
  sim.check(`searching "${word}" finds mods`, found > 0, 'no cards');
  sim.check(`every card the search shows has "${word}" on it`, wrong === 0, `${wrong} of ${found} do not`, { found, wrong });
  await sim.settle(500);
  await sim.shot('search');
  await sim.key('Escape');
  const cleared = await sim.until(`document.getElementById('globalSearch').value === ''`, 3000);
  sim.check('Escape in the search box empties it', cleared, `the box still says "${await sim.js(`document.getElementById('globalSearch').value`)}"`);
  await sim.key('Escape');

  // ---- the mod window ----
  // hundreds of cards: no other category has that many, so this is not the last one still showing
  const heroes = await steps.heroesList(sim);
  if (!sim.check('the heroes category opens for the mod windows', heroes, 'its grid never showed')) return;
  await sim.until(calm, 3000);
  const closers = [
    ['Escape', () => sim.key('Escape')],
    ['its close button', () => sim.click('#modalCloseBtn')],
    // the dim area beside the window: a corner of the overlay, never the window itself
    ['a click beside it', async () => {
      const at = await sim.js(`(() => { const b = document.getElementById('modalOverlay').getBoundingClientRect(); return { x: b.left + 12, y: b.bottom - 12 }; })()`);
      await sim.move(Math.round(at.x * sim.scale), Math.round(at.y * sim.scale));
      sim.win.webContents.sendInputEvent({ type: 'mouseDown', x: sim.x, y: sim.y, button: 'left', clickCount: 1 });
      sim.win.webContents.sendInputEvent({ type: 'mouseUp', x: sim.x, y: sim.y, button: 'left', clickCount: 1 });
    }],
  ];
  // the first card, one from the middle and one near the end (the end is where the window opens
  // from a card that had to be scrolled to), and one with more than one look to pick from
  const total = await sim.js(`document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card').length`);
  const withLooks = await sim.js(`(async () => {
    const c = await window.api.catalog.load(false);
    const names = new Set((c?.mods?.modsData?.heroes || []).filter((m) => (m.styles || []).length > 1).map((m) => m.name));
    const i = [...document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card .card-name')].findIndex((n) => names.has(n.textContent.trim()));
    return i + 1;
  })()`);
  sim.check('a hero with more than one look is in the grid', withLooks > 0, 'no hero the catalog gives several looks has a card');
  const picks = [1, Math.ceil(total / 2), withLooks, total - 1].filter((n, k, all) => n > 0 && all.indexOf(n) === k);
  for (const [i, n] of picks.entries()) {
    const sel = `.view-pane[data-pane="catalog"] .grid .card@${n}`;
    const name = await sim.js(`document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card')[${n - 1}]?.querySelector('.card-name')?.textContent.trim()`);
    await sim.js(`document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card')[${n - 1}]?.scrollIntoView({ block: 'center', behavior: 'instant' })`);
    await sim.settle(400);
    // the card's name, not its buttons: a click on its install button is a different action
    await sim.click(`${sel.replace(/@\d+$/, '')} .card-name@${n}`);
    const title = await sim.until(modalOpen, 5000);
    if (!sim.check(`the mod window opens from card ${n} (${name})`, title, 'the overlay stayed hidden')) continue;
    sim.check(`the mod window is about the card that opened it (${name})`, title === name, `it says "${title}"`);
    await sim.still();
    const looks = await sim.js(`document.querySelectorAll('#modalContent .style-btn').length`);
    for (let s = looks; s >= 1; s--) {
      await sim.click(`#modalContent .style-btn@${s}`);
      const picked = await sim.until(`document.querySelectorAll('#modalContent .style-btn')[${s - 1}]?.classList.contains('active')`, 3000);
      sim.check(`look ${s} of ${looks} can be picked in the ${name} window`, picked, 'the button never became the active one');
    }
    await sim.settle(900);
    await sim.js(stopVideos);
    await sim.move(sim.x, 8);
    await sim.settle(300);
    await sim.layout(`mod window ${i + 1}`);
    await sim.integrity(`mod-window-${i + 1}`);
    await sim.shot(`mod-window-${i + 1}`);
    const [how, close] = closers[i % closers.length];
    await close();
    const shut = await sim.until(modalClosed, 3000);
    sim.check(`the mod window closes by ${how}`, shut, 'still open 3 s later');
    if (!shut) { await sim.key('Escape'); await sim.until(modalClosed, 3000); }
  }

  sim.windowFits();
};
