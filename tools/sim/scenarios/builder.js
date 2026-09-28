/**
 * The item builder the way a player uses it: Cosmetics → Items, a hero, its sets, one set put on
 * whole, then one of its pieces opened and given two effects. After each write,
 * tools/sim/dota.js asks whether the game would load the item table the app built, and every
 * model and particle a changed block points at.
 *
 * What the app promises (src/item-builder.js, src/schema-service.js pickSet):
 *   - a whole set goes on in one write, each piece as its own row in My mods;
 *   - a piece's effects change that piece's row, not add one;
 *   - the files the build points at are in the table's own pack or the game's.
 *
 * It needs a game table with items in it. The sandbox copies the real one when the machine has
 * Dota, along with the files of the five Blightfall pieces (tools/sandbox.js); a CI runner has
 * no Dota and a stub table, and there the scenario says so and stops. It leaves what it found:
 * safe mode on, no picks.
 */
const steps = require('../steps');
const dota = require('../dota');

const HERO = 'Abaddon';
const SET = 'Blightfall';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function builder(sim) {
  const where = await steps.gameOf(sim);
  if (!where) return;
  const { game } = where;
  const safeOn = () => sim.js(`document.getElementById('safeModeBtn').getAttribute('aria-checked') === 'true'`);
  const setSafe = async (on) => {
    if (await safeOn() === on) return true;
    await sim.click('#safeModeBtn');
    if (!on && await sim.until(`document.querySelector('.safe-box [data-c="yes"]')`, 5000)) {
      // on a short screen it lost its title off the top and its buttons off the bottom (668 px of
      // box in a 584 px window, a 1366x768 laptop at 125%)
      const box = await sim.js(`(() => { const b = document.querySelector('.safe-box').getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), window: innerHeight }; })()`);
      sim.check('the safe mode window fits in the app window, its title and its buttons both', box.top >= 0 && box.bottom <= box.window,
        `box ${box.top}..${box.bottom}, window ${box.window}`, box);
      await sim.click('.safe-box [data-c="yes"]');
    }
    return sim.until(`document.getElementById('safeModeBtn').getAttribute('aria-checked') === '${on}'`, 15000);
  };
  const picks = () => sim.js(`window.api.mods.list().then(({ installed }) => installed
    .filter((r) => r.categoryId === 'cosmetic' && String(r.slot).startsWith('item:'))
    .map((r) => ({ id: r.id, slot: r.slot, itemId: r.itemId, effectId: r.effectId || '', on: r.enabled !== false })))`);
  const applied = `document.getElementById('itemApplyBtn')?.disabled && !/…/.test(document.getElementById('itemApplyBtn').textContent)`;

  // the builder writes into the item table, which safe mode keeps the game from reading
  if (!sim.check('safe mode turns off, so the item table can be built', await setSafe(false), `switch: safe ${await safeOn()}`)) return;
  const items = '.rail-item[data-cat="cosmetic:items"]';
  if (!await sim.until(`document.querySelector('${items}')`, 10000)) {
    sim.check('the sandbox has a game table with items to build', true,
      'a stub table (no Dota on this machine to copy one from): nothing to build, nothing checked');
    await setSafe(true);
    return;
  }

  // ---- a whole set, in one write ----
  await sim.click(items);
  const hero = await sim.until(`document.querySelector('[data-item-hero="${HERO}"]')`, 20000);
  if (!sim.check(`the builder lists ${HERO}`, hero, 'no hero card after 20 s')) return;
  await sim.click(`[data-item-hero="${HERO}"]`);
  await sim.until(`document.querySelector('[data-item-sets]')`, 5000);
  await sim.click('[data-item-sets]');
  const setId = await sim.until(`[...document.querySelectorAll('[data-item-set]')]
    .find((c) => c.querySelector('.card-name')?.textContent.trim() === ${JSON.stringify(SET)})?.dataset.itemSet`, 5000);
  if (!sim.check(`the hero's sets list ${SET}`, setId, 'not among the set cards')) return;
  await sim.click(`[data-item-set="${setId}"]`);
  await sim.until(`document.getElementById('itemApplyBtn')`, 5000);
  await sim.shot('set-window');
  await sim.click('#itemApplyBtn');
  const done = await sim.until(applied, 30000);
  const worn = (await picks()).filter((r) => r.on && r.slot.startsWith('item:abaddon:'));
  sim.check('Equip the whole set puts every piece on, one row each', done && worn.length === 5,
    `${worn.length} rows: ${JSON.stringify(worn)}`);
  let seen = dota.checkGame(game);
  sim.check('the game would load the table with the set on, and every model it points at',
    seen.ok && seen.schema && seen.schema.checkedBlocks >= 5, seen.problems.join(' | ') || JSON.stringify(seen.schema));
  await sim.shot('set-on');

  // ---- one piece opened from the set, given two effects ----
  const head = await sim.js(`[...document.querySelectorAll('[data-piece]')].findIndex((c) => /- Head/.test(c.textContent)) + 1`);
  if (!sim.check('the set window lists its head piece', head > 0, 'no piece named "- Head"')) return;
  await sim.click(`[data-piece]@${head}`);
  await sim.until(`document.getElementById('effectGrid') && !document.querySelector('[data-effect-id="fire"]').disabled`, 5000);
  // the window grows open, and a click during that lands wherever the card was a moment before
  await sim.still();
  const pick = async (fx) => {
    const on = `document.querySelector('[data-effect-id="${fx}"]')?.getAttribute('aria-pressed') === 'true'`;
    for (let i = 0; i < 2 && !await sim.js(on); i++) {
      await sim.click(`[data-effect-id="${fx}"]`);
      await sim.until(on, 1500);
    }
    return sim.js(on);
  };
  const chosen = [await pick('fire'), await pick('snow')];
  sim.check('a click on an effect chooses it', chosen.every(Boolean), JSON.stringify({ fire: chosen[0], snow: chosen[1], last: sim.lastClick }));
  await sim.click('#itemApplyBtn');
  await sim.until(applied, 30000);
  const after = (await picks()).filter((r) => r.on && r.slot === 'item:abaddon:head');
  sim.check('effects on a piece change its row, not add one', after.length === 1 && after[0].effectId === 'fire,snow',
    JSON.stringify(after));
  seen = dota.checkGame(game);
  sim.check('the game would load the table with the effects, and every particle they point at', seen.ok, seen.problems.join(' | '));
  await sim.shot('effects-on');

  // ---- leave it as found ----
  await sim.key('Escape');
  for (const r of await picks()) await sim.js(`window.api.mods.remove(${JSON.stringify(r.id)})`);
  await sleep(500);
  sim.check('the picks come off, and safe mode goes back on', !(await picks()).length && await setSafe(true),
    JSON.stringify(await picks()));
  await sim.click('[data-view="catalog"]');
};
