/**
 * The pumpkin in the title bar (renderer/ui/pumpkin.ts), pressed the way a hand presses it: it is
 * not there until the mascot has been knocked on twenty times, it comes out cold and asks for nothing but
 * food, Broodmother's name in the search lets spiders loose (renderer/ui/brood.ts), one of them
 * carried into the pumpkin lights it, and a wrong key is turned away. A right key is the worker's
 * business and has its own tests (test/pumpkin.test.ts); here the key's effect is set the way main
 * sets it, and the window is checked to wear the bloody night (renderer/ui/blood.ts) and to keep
 * its clicks. Everything is put back at the end, so the scenarios after this one see the window the
 * way it opens.
 */
const { lit } = require('../driver');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function pumpkin(sim) {
  const was = await sim.js('window.api.settings.get()');
  await sim.js(`(async () => {
    for (const k of ['pumpkin', 'secret', 'pumpkinLit']) await window.api.settings.set(k, false);
  })()`);
  sim.check('no pumpkin before the round', !(await sim.js('!!document.querySelector(".tb-pumpkin")')));

  for (let i = 0; i < 20; i++) {
    if (i === 19) sim.check('nineteen knocks are not enough', !(await sim.js('!!document.querySelector(".tb-pumpkin")')));
    await sim.click('#themeMascot');
    await sim.until(`!document.getElementById('themeMascot').classList.contains('spinning')`, 3000);
    await sim.settle(150);
  }
  await sim.until('!!document.querySelector(".tb-pumpkin")', 3000);
  sim.check('the pumpkin comes out at the twentieth knock, and it comes out cold',
    await sim.js('!!document.querySelector(".tb-pumpkin.cold")'));
  await sim.settle(1100);
  await sim.shot('pumpkin-bar');

  await sim.click('.tb-pumpkin');
  await sim.until('!!document.querySelector(".pk-box")', 3000);
  await sim.settle(500);
  sim.check('cold, it asks for no key', await sim.js(`document.querySelector('.pk-box.cold') && document.querySelector('.pk-input').hidden`));
  await sim.shot('pumpkin-cold');
  await sim.key('Escape');
  await sim.until(`!document.querySelector('.pk-overlay')`, 3000);

  // her name in the search: spiders pour out of it
  await sim.click('#globalSearch');
  await sim.type('broodmother');
  await sim.until(`document.querySelectorAll('.spl .sp').length >= 5`, 4000);
  sim.check('Broodmother in the search lets spiders loose', (await sim.js(`document.querySelectorAll('.spl .sp').length`)) >= 5);
  await sim.settle(600);
  await sim.shot('brood-spiders');

  // one caught and carried into the pumpkin. The hand lands on it in one move: a spider runs from
  // a pointer that creeps up on it, which is the point of it, and no use to a test.
  const s = await sim.js(`(() => { const r = document.querySelector('.spl .sp').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const pk = await sim.js(`(() => { const r = document.querySelector('.tb-pumpkin').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const at = (p) => ({ x: Math.round(p.x * sim.scale), y: Math.round(p.y * sim.scale) });
  const a = at(s), b = at(pk);
  const wc = sim.win.webContents;
  wc.sendInputEvent({ type: 'mouseMove', x: a.x, y: a.y });
  wc.sendInputEvent({ type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 12; i++) {
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(a.x + ((b.x - a.x) * i) / 12), y: Math.round(a.y + ((b.y - a.y) * i) / 12), button: 'left' });
    await sleep(25);
  }
  await sleep(120);
  wc.sendInputEvent({ type: 'mouseUp', x: b.x, y: b.y, button: 'left', clickCount: 1 });
  sim.x = b.x; sim.y = b.y;
  await sim.until(`!document.querySelector('.tb-pumpkin.cold')`, 3000);
  sim.check('a spider carried into the pumpkin lights it, and it stays lit',
    (await sim.js(`!document.querySelector('.tb-pumpkin.cold')`)) && (await sim.js('window.api.settings.get()')).pumpkinLit === true);
  await sim.js(`(() => { const i = document.getElementById('globalSearch'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);

  // lit, it wants a key; a wrong one is turned away with a reason, online or not
  await sim.click('.tb-pumpkin');
  await sim.until('!!document.querySelector(".pk-box")', 3000);
  await sim.settle(400);
  await sim.shot('pumpkin-window');
  await sim.click('.pk-input');
  await sim.type('pumpkin');
  await sim.key('Enter');
  await sim.until(`!!document.querySelector('.pk-error').textContent`, 20000);
  const wrong = await sim.js(`({ error: document.querySelector('.pk-error').textContent, theme: document.documentElement.dataset.theme })`);
  sim.check('a wrong key is turned away, with a reason on screen', !!wrong.error && wrong.theme !== 'blood', JSON.stringify(wrong));
  await sim.settle(300);
  await sim.shot('pumpkin-wrong');
  await sim.key('Escape');
  await sim.until(`!document.querySelector('.pk-overlay')`, 3000);

  // what a spent key leaves behind (src/pumpkin.ts), and the window coming up in it
  await sim.js(`(async () => {
    await window.api.settings.set('secret', true);
    await window.api.settings.set('theme', 'blood');
    location.reload();
  })()`);
  await sim.settle(1500);
  await sim.ready();
  // blood is main's to set, not the window's, so it goes in the way the key puts it there
  const bled = await sim.js(`window.api.settings.get().then((s) => s.blood === true)`);
  if (!bled) {
    sim.check('the bloody night is only worn once a key has opened it', (await sim.js('document.documentElement.dataset.theme')) !== 'blood');
  } else {
    const bn = await sim.js(`(() => {
      const l = document.querySelector('.bn');
      const top = document.getElementById('titlebar').getBoundingClientRect().bottom;
      return l && { theme: document.documentElement.dataset.theme, top: parseFloat(l.style.getPropertyValue('--top')), bar: top, events: getComputedStyle(l).pointerEvents, streaks: l.querySelectorAll('.bn-band i').length };
    })()`);
    sim.check('the bloody night hangs from the title bar and lets clicks through', !!bn && bn.theme === 'blood' && Math.abs(bn.top - bn.bar) < 2 && bn.events === 'none' && bn.streaks > 10, JSON.stringify(bn));
    sim.check('the bloody night wears a bloody pumpkin as its mascot', await sim.js(`document.querySelector('#themeMascot img').src.startsWith('data:image/svg')`));
    await sim.settle(6000);
    await sim.shot('pumpkin-blood');
    // the round goes on to Ursa, and Ursa is Ursa: nothing of the night stays on (2026-10-26)
    await sim.click('#themeMascot');
    await sim.until(`document.documentElement.dataset.theme === 'ursa'`, 3000);
    await sim.settle(600);
    const after = await sim.js(`({ bn: !!document.querySelector('.bn'), hw: !!document.querySelector('[class^="hw"], .hw-web'), pumpkin: document.querySelector('#themeMascot img').src.startsWith('data:') })`);
    sim.check('after the night, Ursa wears nothing of it', !after.bn && !after.hw && !after.pumpkin, JSON.stringify(after));
  }

  // put back, and start the window again the way it opens
  await sim.js(`(async () => {
    await window.api.settings.set('pumpkin', ${!!was.pumpkin});
    await window.api.settings.set('secret', ${!!was.secret});
    await window.api.settings.set('pumpkinLit', ${!!was.pumpkinLit});
    await window.api.settings.set('theme', ${lit(was.theme || 'ursa')});
    location.reload();
  })()`);
  await sim.settle(1500);
  await sim.ready();
};
