/* Language switching must refresh labels supplied by the main process too: repainting the
 * renderer alone left the Chinese builder showing "Head". The global search must find the
 * same catalog entries by Chinese hero names. No items are equipped by this scenario. */
const steps = require('../steps');

module.exports = async function localization(sim) {
  const original = await sim.js('window.api.settings.get()');
  const pick = async (lang) => {
    await steps.openSection(sim, 'settings');
    const now = await sim.js('document.getElementById("uiLangSelect").value');
    if (now === lang) return;
    await sim.click('#uiLangSelect');
    await sim.key('Escape');
    await sim.key(lang === 'en' ? 'Home' : lang === 'zh-CN' ? 'End' : now === 'en' ? 'Down' : 'Up');
    sim.check(`the interface switches to ${lang}`, await sim.until(`document.documentElement.lang === ${JSON.stringify(lang)}`, 10000));
  };
  const safe = () => sim.js('document.getElementById("safeModeBtn").getAttribute("aria-checked") === "true"');
  const setSafe = async (on) => {
    if (await safe() === on) return;
    await sim.click('#safeModeBtn');
    if (!on && await sim.until(`document.querySelector('.safe-box [data-c="yes"]')`, 5000)) {
      await sim.click('.safe-box [data-c="yes"]');
    }
    sim.check(`safe mode is ${on ? 'on' : 'off'}`, await sim.until(`document.getElementById('safeModeBtn').getAttribute('aria-checked') === '${on}'`, 15000));
  };
  const search = async (query) => {
    await steps.openSection(sim, 'catalog');
    await sim.click('#globalSearch');
    await sim.key('a', ['control']);
    await sim.key('Backspace');
    await sim.type(query);
    await sim.until(`document.querySelector('.view-title')?.textContent.includes(${JSON.stringify(query)})`, 10000);
    await sim.settle(700);
    return sim.js(`({
      mods: [...document.querySelectorAll('.view-pane[data-pane="catalog"] .card:not([data-cos]) .card-name')].map(n => n.textContent.trim()),
      items: [...document.querySelectorAll('.view-pane[data-pane="catalog"] .card[data-cos]')].map(n => ({slot: n.dataset.cos, id: n.dataset.cosId})),
    })`);
  };

  try {
    await pick('en');
    await setSafe(false);
    // A CI sandbox without a copied game schema still runs the catalog-search checks below.
    const hasItems = await sim.js('window.api.cosmetics.slots().then(({slots}) => slots.some(s => s.slot === "item:abaddon:head"))');
    if (hasItems) {
      for (const lang of ['en', 'zh-CN', 'ru', 'en']) {
        await pick(lang);
        await steps.openSection(sim, 'catalog');
        await sim.click('.rail-item[data-cat="cosmetic:items"]');
        await sim.until(`document.querySelector('[data-item-hero="Abaddon"]')`, 10000);
        await sim.click('[data-item-hero="Abaddon"]');
        await sim.until(`document.querySelector('[data-item-slot="item:abaddon:head"]')`, 10000);
        await sim.still();
        const labels = await sim.js(`(async () => {
          const {slots} = await window.api.cosmetics.slots();
          return [...document.querySelectorAll('[data-item-slot]')].map(card => ({
            key: card.dataset.itemSlot,
            shown: card.querySelector('.card-name').textContent.trim(),
            fresh: slots.find(s => s.slot === card.dataset.itemSlot)?.slotLabel,
          }));
        })()`);
        sim.check(`the cached builder slots follow ${lang} without restarting`, labels.length > 0
          && labels.every(s => s.shown === s.fresh)
          && (lang !== 'zh-CN' || labels.find(s => s.key === 'item:abaddon:head')?.shown === '头部'), JSON.stringify(labels), labels);
        if (lang === 'zh-CN') await sim.shot('chinese-slots-after-switch');
        await sim.key('Escape');
      }
    }

    await pick('zh-CN');
    const english = await search('Axe');
    const chinese = await search('斧王');
    sim.check('the global Chinese hero search finds the same Axe catalog entries', english.mods.length > 0
      && JSON.stringify(chinese.mods) === JSON.stringify(english.mods), JSON.stringify({ english, chinese }), { english, chinese });
    if (hasItems) sim.check('the Chinese hero search also reaches that hero\'s cosmetics', chinese.items.length > 0
      && chinese.items.every(item => item.slot.startsWith('item:axe:')), JSON.stringify(chinese.items), chinese.items);
    await sim.shot('chinese-global-search');
    await sim.click('#globalSearch');
    await sim.key('a', ['control']);
    await sim.key('Backspace');
  } finally {
    if (await sim.js('!document.getElementById("modalOverlay").classList.contains("hidden")')) await sim.key('Escape');
    await setSafe(!original.schemaPatch);
    await pick(original.uiLang || 'en');
  }
};
