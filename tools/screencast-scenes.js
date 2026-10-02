/**
 * What the camera does. One export per scene, one webm per scene.
 *
 * A scene is a list of steps. A step is one of:
 *   { move: sel|[x,y], dur, after }      glide the pointer there
 *   { click: sel|[x,y], settle, after }  glide, then press
 *   { hover: sel|[x,y], hold }           glide, then stay put while the hover state plays
 *   { wheel: dy, steps, gap, after }     wheel ticks where the pointer already is
 *   { type: 'text', gap, after }         type into whatever has focus
 *   { wait: ms }                         hold the frame
 *   { eval: 'js', after }                escape hatch
 *
 * Selectors are CSS; coordinates are CSS pixels, and the rig converts them.
 *
 * A scene may be a function taking (cast, log) and returning steps, which is how the ones that
 * have to look at the real catalog first are built - the sandbox holds real mods with real
 * names, and hard-coding a name that may not be there is how a take ends up filming a pointer
 * moving to nothing.
 *
 * The order of the exports is the order of the story, and it matters: the library is empty
 * until the install scene fills it, exactly as it is for somebody who just downloaded this.
 */

/**
 * @typedef {{ move?: string|number[], click?: string|number[], hover?: string|number[], wheel?: number,
 *   type?: string, wait?: number, eval?: string, dur?: number, after?: number, settle?: number,
 *   hold?: number, steps?: number, gap?: number }} Step
 */

const js = (cast, expr) => cast.win.webContents.executeJavaScript(expr);
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

/** the first card in the grid that can still be added to the list */
const FIRST_ADD = '.card:not(.installed) .card-add:not(.on)';

/** Ten heroes, one cosmetic each. Nobody installs eight sets for one hero, so nor do we. */
const HEROES = [
  'Juggernaut', 'Pudge', 'Invoker', 'Phantom Assassin', 'Crystal Maiden',
  'Sniper', 'Axe', 'Lina', 'Shadow Fiend', 'Windranger',
];

/** search for one thing, add the first result, clear. The move people actually make. */
const findAndAdd = (name, { pace = 1 } = {}) => [
  { click: '#globalSearch', after: 260 * pace },
  { type: name, gap: 62, after: 900 * pace },
  { hover: '.card:not(.installed)', hold: 620 * pace },
  { click: FIRST_ADD, after: 640 * pace },
  { click: '#clearSearch', after: 420 * pace },
];

// ---------------------------------------------------------------------------------------
// 0. The one the site plays. Sixteen seconds, no dead air, and it has to answer the only
//    question a stranger has: what does this actually do to my game. So it does the whole
//    loop once - find a hero, take a set, take another, put them in, watch them land.
// ---------------------------------------------------------------------------------------
const showcase = [
  { wait: 350 },
  { hover: '.card', hold: 600 },                        // a card lifts, its controls slide in
  { click: '.rail-item[data-cat="heroes"]', dur: 420, after: 900 },
  { move: [700, 500], dur: 360, after: 120 },
  { wheel: 320, steps: 4, gap: 48, after: 320 },        // hero after hero, alphabetically
  { click: '#globalSearch', dur: 420, after: 160 },
  { type: 'Pudge', gap: 52, after: 620 },
  { hover: '.card:not(.installed)', dur: 380, hold: 380 },
  { click: FIRST_ADD, dur: 260, after: 420 },
  { click: '#clearSearch', dur: 380, after: 220 },
  { click: '#globalSearch', dur: 260, after: 140 },
  { type: 'Invoker', gap: 52, after: 620 },
  { click: FIRST_ADD, dur: 400, after: 420 },
  { click: '#queueBtn', dur: 420, after: 900 },         // the list, with both of them in it
  { wait: 500 },
  { click: '#queueGo', dur: 380, after: 900 },
  { move: [680, 320], dur: 500, after: 3600 },          // and they go in
];

// ---------------------------------------------------------------------------------------
// 1. Browsing. What the thing is, before anything is asked of the viewer.
// ---------------------------------------------------------------------------------------
const browse = [
  { wait: 700 },
  { hover: '.card', hold: 1100 },                       // a card lifts, its controls slide in
  { move: '.card@3', dur: 700, after: 900 },
  { wheel: 240, steps: 5, gap: 70, after: 800 },        // the recently-added strip rolls
  { click: '.rail-item[data-cat="heroes"]', after: 1500 },
  { move: [700, 500], dur: 700, after: 400 },
  { wheel: 300, steps: 8, gap: 60, after: 700 },        // 464 mods, grouped hero by hero
  { hover: '.card@6', hold: 1200 },
  { wheel: -300, steps: 8, gap: 55, after: 600 },
];

// ---------------------------------------------------------------------------------------
// 2. Narrowing. Chips say what a mod changes; the search says which hero you came for.
// ---------------------------------------------------------------------------------------
const filter = [
  { wait: 500 },
  { click: '.fchip[data-tag="effects"]', after: 1400 },  // only mods with effects survive
  { move: [700, 470], dur: 600, after: 300 },
  { wheel: 260, steps: 5, gap: 65, after: 800 },
  { click: '.fchip[data-tag="effects"]', after: 1200 },  // and off again
  { click: '#globalSearch', after: 300 },
  { type: 'Juggernaut', gap: 70, after: 1300 },
  { hover: '.card', hold: 900 },
  { click: '.card .card-media', after: 1600 },           // the window grows out of the card
  { wait: 1400 },
  { click: '#modalOverlay .modal-close, #modalOverlay', after: 1100 },
  { click: '#clearSearch', after: 700 },
];

// ---------------------------------------------------------------------------------------
// 3. Collecting. One set for each of ten different heroes, then a cursor and a terrain.
// ---------------------------------------------------------------------------------------
function collect() {
  /** @type {Step[]} */
  const steps = [{ wait: 500 }];
  // the first four at a readable pace, so the move is legible
  for (const h of HEROES.slice(0, 4)) steps.push(...findAndAdd(h));
  // the rest brisk: the point is made, and ten searches at full length is a documentary
  for (const h of HEROES.slice(4)) steps.push(...findAndAdd(h, { pace: 0.55 }));

  steps.push(
    { click: '.rail-item[data-cat="cursors"]', after: 1500 },
    { hover: '.card@3', hold: 800 },
    { click: FIRST_ADD, after: 800 },
    { click: '.rail-item[data-cat="terrains"]', after: 1500 },
    { hover: '.card@2', hold: 800 },
    { click: FIRST_ADD, after: 900 },
    { click: '#queueBtn', after: 1500 },                 // the list, twelve mods deep
    { move: [680, 420], dur: 600, after: 500 },
    { wheel: 200, steps: 4, gap: 70, after: 900 },
  );
  return steps;
}

// ---------------------------------------------------------------------------------------
// 4. Installing. Twelve mods go in with one press.
// ---------------------------------------------------------------------------------------
const install = [
  { wait: 400 },
  { click: '#queueGo', after: 1200 },
  { move: [680, 300], dur: 800, after: 6000 },           // the bar runs; we do not sit it out
];

// ---------------------------------------------------------------------------------------
// 5. Mine. What the list looks like afterwards, and the switch that is the whole point.
// ---------------------------------------------------------------------------------------
async function mine(cast, log) {
  // the install carries on off camera; the library is only worth filming once it is done
  for (let i = 0; i < 120; i++) {
    const busy = await js(cast, `!document.getElementById('progressBar')?.hidden`);
    if (!busy) break;
    await nap(2000);
  }
  await js(cast, `document.querySelector('[data-view="library"]')?.click()`);
  await nap(2600);

  // Find the switch on a real row and film its coordinates. Building the selector by hand is
  // how the first take produced an invalid one; asking the page what is actually there cannot
  // go stale when the markup moves.
  const found = await js(cast, `(() => {
    const mid = (el) => { const b = el.getBoundingClientRect();
      return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; };
    const rows = [...document.querySelectorAll('.lib-row')];
    const row = rows[1] || rows[0];
    if (!row) return null;
    const t = row.querySelector('.lib-actions input[type="checkbox"], .lib-actions .switch, .lib-actions .tog, .lib-actions button');
    return { rows: rows.length, row: mid(row), toggle: t ? mid(t) : null, what: t ? (t.className || t.tagName) : null };
  })()`);
  log(`library: ${JSON.stringify(found)}`);
  if (!found) return [{ wait: 800 }];

  /** @type {Step[]} */
  const steps = [
    { wait: 900 },
    { move: [680, 380], dur: 700, after: 500 },
    { wheel: 220, steps: 5, gap: 70, after: 900 },
    { wheel: -220, steps: 5, gap: 60, after: 800 },
    { hover: found.row, hold: 900 },
  ];
  if (found.toggle) {
    steps.push(
      { click: found.toggle, after: 1800 },   // off before a match
      { wait: 700 },
      { click: found.toggle, after: 1800 },   // and back on after
      { wait: 900 },
    );
  }
  return steps;
}

/* The three motions on the catalog, filmed for a person to judge: the rail's highlight travelling
 * between categories, the cards of a category moving to their places as chips narrow it, and a mod
 * window growing out of the card it was opened from. Not part of the story above (MM_SCENE=motion). */
const motion = [
  { wait: 700 },
  { click: '.rail-item[data-cat="terrains"]', after: 1100 },
  { click: '.rail-item[data-cat="hero-items"]', after: 1100 },
  { click: '.rail-item[data-cat="couriers"]', after: 1100 },
  { click: '.rail-item[data-cat="hero-items"]', after: 1300 },
  { click: '.rail-item[data-cat="heroes"]', after: 1300 },
  { click: '.fchip[data-tag="anime"]', after: 1600 },
  { click: '.fchip[data-tag="anime"]', after: 1600 },
  { click: '#installedChip', after: 1600 },
  { click: '#installedChip', after: 1600 },
  { click: '.rail-item[data-cat="terrains"]', after: 1300 },
  { hover: '.grid .card:nth-child(2 of .card)', hold: 500 },
  { click: '.grid .card:nth-child(2 of .card) .card-name', after: 1600 },
  { eval: "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))", after: 800 },
  { hover: '.grid .card:nth-child(9 of .card)', hold: 400 },
  { click: '.grid .card:nth-child(9 of .card) .card-name', after: 1600 },
  { eval: "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))", after: 900 },
];

/* The motions of My mods, filmed for a person to judge (MM_SCENE=library): a mod moved in the load
 * order from its menu, and back; a search that narrows the list and lets it go; a pack opened and
 * closed; a mod removed. Needs a library to show: the sandbox seeded with a few mods and a pack. */
const rowMenu = (n) => `(() => { const r = document.querySelectorAll('#libList .lib-row[data-row]')[${n}].getBoundingClientRect();
  document.querySelectorAll('#libList .lib-row[data-row]')[${n}].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 360, clientY: r.top + 24 })); })()`;
const library = [
  { wait: 600 },
  { click: '.tb-tab[data-view="library"]', after: 1500 },
  { hover: '#libList .lib-row[data-row]:nth-child(3 of .lib-row)', hold: 400 },
  { eval: rowMenu(2), after: 500 },
  { click: '.ctx-menu .ctx-item:nth-child(1 of .ctx-item)', after: 1300 },
  { hover: '#libList .lib-row[data-row]:nth-child(2 of .lib-row)', hold: 400 },
  { eval: rowMenu(1), after: 500 },
  { click: '.ctx-menu .ctx-item:nth-child(2 of .ctx-item)', after: 1400 },
  { click: '#libSearch', after: 300 },
  { type: 'emblem', gap: 90, after: 1500 },
  { click: '#libSearchClear', after: 1500 },
  { eval: "document.querySelector('#libList .pack-row').scrollIntoView({ block: 'center', behavior: 'smooth' })", after: 900 },
  { click: '.pack-expand', after: 1400 },
  { click: '.pack-expand', after: 1200 },
  { eval: "document.getElementById('main').scrollTo({ top: 0, behavior: 'smooth' })", after: 900 },
  { hover: '#libList .lib-row[data-row]:nth-child(3 of .lib-row) [data-del]', hold: 400 },
  { click: '#libList .lib-row[data-row]:nth-child(3 of .lib-row) [data-del]', after: 700 },
  { click: '.confirm-box [data-c="yes"]', after: 1800 },
];

module.exports = { showcase, browse, filter, collect, install, mine, motion, library };
