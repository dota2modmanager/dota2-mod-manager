/**
 * The pumpkin in the title bar (renderer/ui/pumpkin.ts), pressed the way a hand presses it: it is
 * not there until the mascot has worn all eight heroes, a wrong key leaves it shut, and the key
 * the site gives (site/src/scripts/chase.ts) opens the ninth theme, which then moves on to the
 * next hero by itself. Everything is put back at the end, so the scenarios after this one see the
 * window the way it opens.
 */
const { lit } = require('../driver');
const { theKey } = require('../../../site/src/scripts/chase.ts');

module.exports = async function pumpkin(sim) {
  const was = await sim.js('({ theme: document.documentElement.dataset.theme, rainbow: !!window.state?.settings?.rainbow })');
  await sim.js(`(async () => { await window.api.settings.set('pumpkin', false); await window.api.settings.set('rainbow', false); })()`);
  sim.check('no pumpkin before the round', !(await sim.js('!!document.querySelector(".tb-pumpkin")')));

  for (let i = 0; i < 8; i++) {
    await sim.click('#themeMascot');
    await sim.until(`!document.getElementById('themeMascot').classList.contains('spinning')`, 3000);
    await sim.settle(150);
  }
  await sim.until('!!document.querySelector(".tb-pumpkin")', 3000);
  sim.check('the pumpkin comes out once all eight heroes have been worn', await sim.js('!!document.querySelector(".tb-pumpkin")'));
  await sim.settle(1100);
  await sim.shot('pumpkin-bar');

  await sim.click('.tb-pumpkin');
  await sim.until('!!document.querySelector(".pk-box")', 3000);
  await sim.settle(500);
  await sim.shot('pumpkin-window');

  // a wrong key: the pumpkin stays shut and says so
  await sim.click('.pk-input');
  await sim.type('pumpkin');
  await sim.key('Enter');
  await sim.settle(700);
  const wrong = await sim.js(`({ error: document.querySelector('.pk-error').textContent, theme: document.documentElement.dataset.theme, lit: document.querySelector('.pk-box').classList.contains('lit') })`);
  sim.check('a wrong key is turned away, with a reason on screen', !!wrong.error && !wrong.lit && wrong.theme !== 'rainbow', JSON.stringify(wrong));
  await sim.shot('pumpkin-wrong');

  // the site's key, typed the lazy way: lower case, spaces for dashes
  await sim.js(`document.querySelector('.pk-input').value = ''`);
  await sim.click('.pk-input');
  await sim.type(theKey().toLowerCase().replaceAll('-', ' '));
  await sim.key('Enter');
  await sim.until(`document.documentElement.dataset.theme === 'rainbow'`, 3000);
  const open = await sim.js(`({ theme: document.documentElement.dataset.theme, hue: document.documentElement.dataset.hue, lit: !!document.querySelector('.pk-box.lit') })`);
  sim.check('the key opens it, and the window puts the rainbow on', open.theme === 'rainbow' && !!open.hue && open.lit, JSON.stringify(open));
  await sim.settle(900);
  await sim.shot('pumpkin-lit');
  await sim.click('.pk-box [data-c="ok"]');
  await sim.until(`!document.querySelector('.pk-overlay')`, 3000);

  const saved = await sim.js('window.api.settings.get()');
  sim.check('the rainbow and the pumpkin are kept for next time', saved.rainbow === true && saved.pumpkin === true && saved.theme === 'rainbow', JSON.stringify({ rainbow: saved.rainbow, pumpkin: saved.pumpkin, theme: saved.theme }));

  // it does not hold one hero: within a round it has moved on
  const first = open.hue;
  await sim.until(`document.documentElement.dataset.hue !== ${lit(first)}`, 9000);
  const later = await sim.js('document.documentElement.dataset.hue');
  sim.check('the rainbow moves on to the next hero by itself', later !== first, `${first} -> ${later}`);
  await sim.settle(400);
  await sim.shot('pumpkin-rainbow');

  // and the mascot's round now has nine: one more click from the rainbow lands on the first hero
  await sim.click('#themeMascot');
  await sim.until(`document.documentElement.dataset.theme !== 'rainbow'`, 3000);
  sim.check('the mascot goes on from the rainbow to the first hero', (await sim.js('document.documentElement.dataset.theme')) === 'ursa');

  // put back, and start the window again the way it opens
  await sim.js(`(async () => {
    await window.api.settings.set('pumpkin', false);
    await window.api.settings.set('rainbow', ${was.rainbow});
    await window.api.settings.set('theme', ${lit(was.theme || 'ursa')});
    location.reload();
  })()`);
  await sim.settle(1500);
  await sim.ready();
};
