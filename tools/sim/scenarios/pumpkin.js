/**
 * The pumpkin in the title bar (renderer/ui/pumpkin.ts), pressed the way a hand presses it: it is
 * not there until the mascot has worn all eight heroes, a wrong key leaves it shut, and the key
 * the site gives (site/src/scripts/chase.ts) opens the ninth theme, in today's look
 * (renderer/ui/season.ts): Halloween's dressing while it is on, else a rainbow that moves on to
 * the next hero by itself. Everything is put back at the end, so the scenarios after this one see
 * the window the way it opens.
 */
const { lit } = require('../driver');
const { theKey } = require('../../../site/src/scripts/key.ts');
const { lookOn } = require('../../../renderer/ui/season.ts');

module.exports = async function pumpkin(sim) {
  const look = lookOn(new Date());
  const was = await sim.js('window.api.settings.get()');
  await sim.js(`(async () => { await window.api.settings.set('pumpkin', false); await window.api.settings.set('secret', false); })()`);
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
  sim.check('a wrong key is turned away, with a reason on screen', !!wrong.error && !wrong.lit && wrong.theme !== look, JSON.stringify(wrong));
  await sim.shot('pumpkin-wrong');

  // the site's key, typed the lazy way: lower case, spaces for dashes
  await sim.js(`document.querySelector('.pk-input').value = ''`);
  await sim.click('.pk-input');
  await sim.type(theKey().toLowerCase().replaceAll('-', ' '));
  await sim.key('Enter');
  await sim.until(`document.documentElement.dataset.theme === ${lit(look)}`, 3000);
  const open = await sim.js(`({ theme: document.documentElement.dataset.theme, hue: document.documentElement.dataset.hue, lit: !!document.querySelector('.pk-box.lit'), dressed: !!document.querySelector('.hwa') })`);
  sim.check(`the key opens it, and the window puts today's look on (${look})`, open.theme === look && open.lit && (look === 'halloween' ? open.dressed : !!open.hue), JSON.stringify(open));
  await sim.settle(900);
  await sim.shot('pumpkin-lit');
  await sim.click('.pk-box [data-c="ok"]');
  await sim.until(`!document.querySelector('.pk-overlay')`, 3000);

  const saved = await sim.js('window.api.settings.get()');
  sim.check('the ninth theme and the pumpkin are kept for next time', saved.secret === true && saved.pumpkin === true && saved.theme === 'secret', JSON.stringify({ secret: saved.secret, pumpkin: saved.pumpkin, theme: saved.theme }));

  // asked for less motion (the Windows runner turns animations off), the rainbow holds one hero
  const still = await sim.js(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
  if (look === 'rainbow' && still) {
    await sim.settle(7000);
    sim.check('with less motion asked for, the rainbow holds still', (await sim.js('document.documentElement.dataset.hue')) === open.hue);
  } else if (look === 'rainbow') {
    // it does not hold one hero: within a round it has moved on
    const first = open.hue;
    await sim.until(`document.documentElement.dataset.hue !== ${lit(first)}`, 9000);
    const later = await sim.js('document.documentElement.dataset.hue');
    sim.check('the rainbow moves on to the next hero by itself', later !== first, `${first} -> ${later}`);
  } else {
    // the dressing sits under the title bar and over the status bar, and catches no click
    const hw = await sim.js(`(() => {
      const l = document.querySelector('.hwa');
      const top = document.getElementById('titlebar').getBoundingClientRect().bottom;
      return { top: parseFloat(l.style.getPropertyValue('--top')), bar: top, events: getComputedStyle(l).pointerEvents, drips: l.querySelectorAll('.hwa-blood i').length };
    })()`);
    sim.check('the Halloween dressing hangs from the title bar and lets clicks through', Math.abs(hw.top - hw.bar) < 2 && hw.events === 'none' && hw.drips > 0, JSON.stringify(hw));
  }
  await sim.settle(2500);
  await sim.shot(`pumpkin-${look}`);

  // and the mascot's round now has nine: one more click from the rainbow lands on the first hero
  await sim.click('#themeMascot');
  await sim.until(`document.documentElement.dataset.theme !== ${lit(look)}`, 3000);
  sim.check('the mascot goes on from the ninth theme to the first hero, and the dressing comes off', (await sim.js(`document.documentElement.dataset.theme === 'ursa' && !document.querySelector('.hwa')`)) === true);

  // put back, and start the window again the way it opens
  await sim.js(`(async () => {
    await window.api.settings.set('pumpkin', ${!!was.pumpkin});
    await window.api.settings.set('secret', ${!!was.secret});
    await window.api.settings.set('theme', ${lit(was.theme || 'ursa')});
    location.reload();
  })()`);
  await sim.settle(1500);
  await sim.ready();
};
