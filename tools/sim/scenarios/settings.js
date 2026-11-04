/**
 * The settings a person changes: the app's language, its scale, the Discord status and the beta
 * channel. Each is changed the way a hand changes it, checked where it shows, and put back.
 *
 * The language gets the most attention. tools/check-i18n.js already proves every string in the
 * code has an English twin; what it cannot see is text that reaches the screen from somewhere
 * else (the catalog, a banner built from parts, a native label). So with English on, every
 * section is read for Cyrillic left on screen. Mod names and a user's own content are not ours
 * to translate and are left out.
 */
const steps = require('../steps');

const SECTIONS = ['catalog', 'items', 'studio', 'library', 'presets', 'settings'];

// visible text in Cyrillic that is ours: not a mod's name, not a card, not a user's input
const leftovers = `(() => {
  const skip = '.card, .lib-row, .preset-body, .modal-content, input, textarea, select, option, #toasts, .selectable';
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent.trim();
    if (!/[А-Яа-яЁё]/.test(text)) continue;
    const el = n.parentElement;
    if (!el || el.closest(skip) || el.closest('[hidden], .hidden')) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    out.push((el.id ? '#' + el.id : '.' + String(el.className).split(' ')[0]) + ': ' + text.slice(0, 60));
  }
  return [...new Set(out)];
})()`;

module.exports = async function settings(sim) {
  const s0 = await sim.js('window.api.settings.get()');

  // ---- language: English, every section read for Russian left on screen, then back ----
  const pick = async (lang) => {
    await steps.openSection(sim, 'settings');
    const now = await sim.js(`document.getElementById('uiLangSelect')?.value`);
    if (now === lang) return true;
    // a closed select changes with the arrow keys, the same way a keyboard user picks
    await sim.click('#uiLangSelect');
    await sim.key('Escape'); // the list the click opened; the arrows below work on the closed select
    await sim.key(lang === 'en' ? 'Up' : 'Down');
    return sim.until(`document.documentElement.lang === '${lang}' || (window.api && document.querySelector('.tb-tab[data-view="catalog"]')?.textContent.trim() === '${lang === 'en' ? 'Catalog' : 'Каталог'}')`, 8000);
  };
  const english = await pick('en');
  // Settings is the gear, named by its label rather than a word on the tab
  const tabs = await sim.js(`[...document.querySelectorAll('.tb-tab:not(.tb-icon-tab)')].map((t) => t.firstChild.textContent.trim()).concat(document.querySelector('.tb-icon-tab').getAttribute('aria-label')).join(', ')`);
  sim.check('switching the language to English renames the sections', english && tabs === 'Catalog, Items, Workshop, My mods, Presets, Settings', `tabs: ${tabs}`);
  sim.check('the choice is saved', (await sim.js('window.api.settings.get()')).uiLang === 'en');
  for (const view of SECTIONS) {
    await steps.openSection(sim, view);
    await sim.move(sim.x, 8);
    await sim.settle(600);
    const left = await sim.js(leftovers);
    sim.check(`in English, the ${view} section has no Russian left on screen`, !left.length, left.slice(0, 8).join(' | '), { left });
    await sim.layout(`${view} in English`);
    await sim.shot(`english-${view}`);
  }
  // the mod window too: it is built from the most parts
  await steps.openSection(sim, 'catalog');
  await steps.heroesList(sim);
  await sim.click('.view-pane[data-pane="catalog"] .grid .card .card-name@1');
  if (await sim.until(steps.modalOpen, 5000)) {
    await sim.still();
    const left = await sim.js(leftovers.replace(".modal-content, ", ''));
    // the window itself is read here, its title and author excepted (they are the catalog's)
    const ours = left.filter((l) => !/^\.(modal-title|author-chip)/.test(l));
    sim.check('in English, the mod window has no Russian left on screen', !ours.length, ours.slice(0, 8).join(' | '), { left: ours });
    await sim.shot('english-mod-window');
    await sim.key('Escape');
  }
  const russian = await pick('ru');
  sim.check('switching back to Russian renames them back', russian
    && await sim.js(`document.querySelector('.tb-tab[data-view="catalog"]').firstChild.textContent.trim()`) === 'Каталог');

  // ---- scale ----
  await steps.openSection(sim, 'settings');
  const pct = () => sim.js(`document.getElementById('masterRangeVal')?.textContent.trim()`);
  // the app scales its content with a CSS variable and remembers it, the window's zoom stays 1
  const size = () => sim.js(`({
    zoom: getComputedStyle(document.documentElement).getPropertyValue('--content-zoom').trim(),
    title: Math.round(document.querySelector('.view-pane[data-pane="settings"] .view-title')?.getBoundingClientRect().height || 0),
  })`);
  const s100 = await size();
  await sim.click('#masterUp');
  await sim.click('#masterUp');
  await sim.until(`document.getElementById('masterRangeVal')?.textContent.trim() === '110%'`, 5000);
  await sim.settle(600);
  const s110 = await size();
  const saved = (await sim.js('window.api.settings.get()')).uiScale;
  sim.check('"Larger" twice: the scale reads 110%, the content grows and the choice is saved',
    (await pct()) === '110%' && Number(s110.zoom) === 1.1 && s110.title > s100.title && Math.abs(saved - 1.1) < 0.001,
    JSON.stringify({ shown: await pct(), before: s100, after: s110, saved }));
  for (const view of SECTIONS) {
    await steps.openSection(sim, view);
    await sim.settle(400);
    await sim.layout(`${view} at 110%`);
  }
  sim.windowFits();
  await sim.shot('scale-110');
  await steps.openSection(sim, 'settings');
  await sim.click('#masterReset');
  await sim.until(`document.getElementById('masterRangeVal')?.textContent.trim() === '100%'`, 5000);
  await sim.settle(400);
  const back = await size();
  sim.check('"Reset" puts the scale back to 100%', (await pct()) === '100%' && Number(back.zoom) === 1 && back.title === s100.title,
    JSON.stringify({ shown: await pct(), now: back, at100: s100 }));

  // ---- the two switches: each flips, is saved, and flips back ----
  for (const [id, read, what] of [
    ['presenceToggle', 'window.api.settings.get().then((s) => s.discordPresence !== false)', 'the Discord status'],
    ['betaToggle', `document.getElementById('betaToggle').getAttribute('aria-checked') === 'true'`, 'beta versions'],
  ]) {
    if (!await sim.js(`!!document.getElementById('${id}')`)) continue;
    const before = await sim.js(read);
    await sim.click(`#${id}`);
    const flipped = await sim.until(`(async () => (await (${read})) === ${!before})()`, 5000);
    sim.check(`${what} can be switched ${before ? 'off' : 'on'}`, flipped);
    await sim.click(`#${id}`);
    const back = await sim.until(`(async () => (await (${read})) === ${before})()`, 5000);
    sim.check(`${what} can be switched back`, back);
  }
  // left as found, whatever happened above
  const s1 = await sim.js('window.api.settings.get()');
  sim.check('the settings are left as they were found', s1.uiLang === s0.uiLang && s1.discordPresence === s0.discordPresence,
    JSON.stringify({ before: { uiLang: s0.uiLang, discordPresence: s0.discordPresence }, after: { uiLang: s1.uiLang, discordPresence: s1.discordPresence } }));
};
