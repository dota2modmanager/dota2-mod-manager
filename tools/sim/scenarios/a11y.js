/**
 * The app without a mouse, and the app as a screen reader reads it.
 *
 * Three kinds of check, each on every section and on the windows that open over them:
 *
 * - axe-core (WCAG 2.0, 2.1 and 2.2, A and AA). What it cannot decide by itself, mostly contrast
 *   over the translucent panels, is written to axe-<where>.json as "incomplete" for a person to
 *   look at, and is not a failure here.
 * - The accessibility tree Chromium hands a screen reader, read over the DevTools protocol: every
 *   control in it has a role and a name, and no name is an icon's ligature ("check_circle").
 * - The keyboard, pressed the way a hand presses it (sendInputEvent): Tab goes everywhere with a
 *   visible ring; a mod is opened, installed and removed with Tab, Enter and Escape alone; a window
 *   takes the focus when it opens, keeps it while open, and gives it back when it closes.
 *
 * Everything found when this was first run (2026-10-11): a card could not be opened from the
 * keyboard at all, so nothing could be installed without a mouse; Tab walked out of a mod's
 * window into the grid behind it; closing a window left the focus nowhere; three lists had no
 * name; icons read out as their ligature; the panel grips claimed a role their buttons broke.
 * renderer/ui/a11y.ts and renderer/catalog/card/CardName.tsx hold the fixes.
 */
const fs = require('fs');
const path = require('path');
const steps = require('../steps');

const SECTIONS = ['catalog', 'library', 'presets', 'settings'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
/** Roles a person operates: each needs a name a screen reader can say. */
const CONTROLS = new Set(['button', 'link', 'checkbox', 'switch', 'textbox', 'searchbox', 'combobox', 'listbox', 'menuitem',
  'tab', 'slider', 'spinbutton', 'radio', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem']);
/** A Material Symbols ligature: lowercase words joined by underscores. */
const LIGATURE = /\b[a-z]+(?:_[a-z]+)+\b/;
// one mod, small, whose archive the sandbox carries (tools/sandbox-mods.json)
const MOD = 'IO Purple';

/** What has the focus, where it is, and whether it shows. */
const FOCUSED = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { what: 'body' };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    what: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''),
    name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
    shown: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
    ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none'),
    inDialog: !!el.closest('[aria-modal="true"]'),
  };
})()`;

module.exports = async function a11y(sim) {
  const axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const wc = sim.win.webContents;
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Accessibility.enable');

  /** axe and the accessibility tree over what is on screen now. */
  const audit = async (where) => {
    if (!await sim.js('typeof window.axe === "object"')) await sim.js(`${axe};true`);
    const found = await sim.js(`axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(TAGS)} }, resultTypes: ['violations', 'incomplete'] })
      .then((r) => ({
        violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) })),
        incomplete: r.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.length })),
      }))`);
    fs.writeFileSync(path.join(sim.out, `axe-${where}.json`), JSON.stringify(found, null, 1));
    sim.check(`${where}: axe finds nothing against WCAG 2.2 AA`, !found.violations.length,
      found.violations.map((v) => `${v.id}: ${v.nodes.join(', ')}`).join(' | '), found);

    const { nodes } = await wc.debugger.sendCommand('Accessibility.getFullAXTree');
    const controls = nodes.filter((n) => !n.ignored && CONTROLS.has(n.role?.value));
    const nameless = controls.filter((n) => !String(n.name?.value || '').trim());
    const ligatures = controls.filter((n) => LIGATURE.test(String(n.name?.value || '')));
    const say = (n) => `${n.role.value} "${String(n.name?.value || '').slice(0, 40)}"`;
    sim.check(`${where}: every control a screen reader meets has a name`, controls.length > 0 && !nameless.length,
      `${controls.length} controls; nameless: ${nameless.slice(0, 8).map(say).join(', ')}`);
    sim.check(`${where}: no control is named after an icon`, !ligatures.length, ligatures.slice(0, 8).map(say).join(', '));
  };

  for (const view of SECTIONS) {
    await steps.openSection(sim, view);
    await sim.settle(600);
    await audit(view);
  }

  // ---- Tab from the section tabs: every stop on screen and ringed, and the catalog reachable ----
  await steps.openSection(sim, 'catalog');
  await steps.heroesList(sim);
  await sim.click('.tb-tab[data-view="catalog"]'); // where a hand would start: the tabs
  const walk = [];
  for (let i = 0; i < 120; i++) {
    await sim.key('Tab');
    walk.push(await sim.js(FOCUSED));
  }
  fs.writeFileSync(path.join(sim.out, 'tab-walk.json'), JSON.stringify(walk, null, 1));
  const stuck = walk.filter((w) => w.what === 'body');
  const unseen = walk.filter((w) => w.what !== 'body' && (!w.shown || !w.ring));
  sim.check('Tab never lands on nothing', !stuck.length, `${stuck.length} of ${walk.length} presses left the focus on the page itself`);
  sim.check('every place Tab lands is on screen and shows a ring', !unseen.length,
    unseen.slice(0, 6).map((w) => `${w.what} [${w.name}]${w.shown ? '' : ' off screen'}${w.ring ? '' : ' no ring'}`).join(' | '));
  for (const [what, re] of [['the search', /^input#globalSearch/], ['a category', /rail-item/], ['a card', /card-open/]]) {
    sim.check(`Tab reaches ${what}`, walk.some((w) => re.test(w.what)), walk.map((w) => w.what).join(', '));
  }

  // ---- a mod, installed with the keyboard alone ----
  const picked = await steps.readyMods(sim, [MOD]);
  const where = await steps.gameOf(sim);
  if (!picked.length || !where) { wc.debugger.detach(); return; }
  const m = picked[0];
  await steps.openSection(sim, 'catalog');
  await sim.click(`.rail-item[data-cat="${m.categoryId}"]`);
  const at = await sim.until(`(() => {
    const names = [...document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card .card-open')];
    const i = names.findIndex((n) => n.textContent.trim() === ${JSON.stringify(m.name)});
    if (i < 0) return 0;
    names[i].focus(); // the walk above showed Tab gets to cards; this one is a long way down the grid
    return i + 1;
  })()`, 8000);
  if (!sim.check(`${m.name}: its card takes the focus`, at && /card-open/.test((await sim.js(FOCUSED)).what))) { wc.debugger.detach(); return; }
  const opener = await sim.js(FOCUSED);
  await sim.key('Enter');
  const title = await sim.until(steps.modalOpen, 5000);
  sim.check('Enter on a card opens its window', title === m.name, `the window is for ${title}`);
  await sim.still();
  sim.check('the window takes the focus when it opens', (await sim.js(FOCUSED)).inDialog, JSON.stringify(await sim.js(FOCUSED)));
  await audit('mod window');
  const inside = [];
  for (let i = 0; i < 30; i++) { await sim.key('Tab'); inside.push(await sim.js(FOCUSED)); }
  for (let i = 0; i < 5; i++) { await sim.key('Tab', ['shift']); inside.push(await sim.js(FOCUSED)); }
  const left = inside.filter((w) => !w.inDialog);
  sim.check('Tab and Shift+Tab go round inside the window, never out of it', !left.length, left.slice(0, 5).map((w) => w.what).join(', '));
  sim.check('every place Tab lands in the window shows a ring', inside.every((w) => w.ring), inside.filter((w) => !w.ring).slice(0, 5).map((w) => w.what).join(', '));

  // Tab to Install, Enter
  let onInstall = false;
  for (let i = 0; i < 40 && !onInstall; i++) {
    onInstall = /#installBtn/.test((await sim.js(FOCUSED)).what);
    if (!onInstall) await sim.key('Tab');
  }
  if (sim.check('Tab reaches Install', onInstall)) {
    await sim.key('Enter');
    const done = await sim.until(`document.getElementById('uninstallBtn') ? 'done' : document.querySelector('.confirm-overlay') ? 'asked' : null`, 60000);
    if (done === 'asked') {
      await sim.still();
      sim.check('a question asked during the install has the focus', (await sim.js(FOCUSED)).inDialog);
      await sim.key('Enter');
      await sim.until(`document.getElementById('uninstallBtn')`, 60000);
    }
    sim.check(`${m.name}: installed with the keyboard alone`, await sim.js(`!!document.getElementById('uninstallBtn')`));
  }
  await sim.key('Escape');
  await sim.until(`document.getElementById('modalOverlay').classList.contains('hidden')`, 3000);
  await sim.settle(300);
  const back = await sim.js(FOCUSED);
  sim.check('closing the window gives the focus back to the card it was opened from', back.what === opener.what && back.name === opener.name,
    `${back.what} [${back.name}], was ${opener.what} [${opener.name}]`);

  // ---- and removed: the question takes the focus, names the mod, and Escape keeps it ----
  await steps.openSection(sim, 'library');
  const row = steps.rowOf(await steps.libraryRows(sim), m.name);
  if (sim.check(`${m.name} is in My mods`, row)) {
    const del = `.lib-row[data-row="${row.id}"] [data-del]`;
    await sim.click('.tb-tab[data-view="library"]');
    let onDel = false;
    for (let i = 0; i < 80 && !onDel; i++) {
      await sim.key('Tab');
      onDel = await sim.js(`document.activeElement === document.querySelector(${JSON.stringify(del)})`);
    }
    if (sim.check('Tab reaches the row\'s Remove', onDel)) {
      await sim.key('Enter');
      await sim.until(`document.querySelector('.confirm-overlay [data-c="yes"]')`, 5000);
      await sim.still();
      const asked = await sim.js(`document.querySelector('.confirm-overlay')?.textContent.replace(/\\s+/g, ' ').trim() || ''`);
      sim.check('the question names what it will remove', asked.includes(m.name), asked);
      sim.check('the question has the focus', (await sim.js(FOCUSED)).inDialog);
      await audit('remove question');
      const round = [];
      for (let i = 0; i < 6; i++) { await sim.key('Tab'); round.push(await sim.js(FOCUSED)); }
      sim.check('Tab stays inside the question', round.every((w) => w.inDialog), round.map((w) => w.what).join(', '));
      await sim.key('Escape');
      await sim.until(`!document.querySelector('.confirm-overlay')`, 3000);
      await sim.settle(200);
      sim.check('Escape answers no: the mod stays', !!steps.rowOf(await steps.libraryRows(sim), m.name));
      sim.check('and the focus goes back to Remove', await sim.js(`document.activeElement === document.querySelector(${JSON.stringify(del)})`),
        JSON.stringify(await sim.js(FOCUSED)));
      await sim.key('Enter');
      await sim.until(`document.querySelector('.confirm-overlay [data-c="yes"]')`, 5000);
      await sim.still();
      // the question opens on its answer; Tab gets there from anywhere else in it
      const onYes = () => sim.js(`document.activeElement === document.querySelector('.confirm-overlay [data-c="yes"]')`);
      for (let i = 0; i < 4 && !await onYes(); i++) await sim.key('Tab');
      await sim.key('Enter');
      const gone = await sim.until(`!document.querySelector(${JSON.stringify(`.lib-row[data-row="${row.id}"]`)})`, 10000);
      sim.check(`${m.name}: removed with the keyboard alone`, !!gone);
    }
  }
  wc.debugger.detach();
};
