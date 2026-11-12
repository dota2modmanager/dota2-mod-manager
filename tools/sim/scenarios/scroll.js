/**
 * Scrolling the biggest list there is, the way people actually scroll it, and checking two
 * things a user has reported.
 *
 * "It stops scrolling partway" (2026-09-04): the list scrolled fine, but the window was taller
 * than the screen and its bottom rows sat past the edge. So the run scrolls to the very end and
 * asks whether the last card is inside the window, and whether the window is inside the screen.
 *
 * "The catalog is drawn as a mess" (?.grave, 2026-09-15, Windows 10, an RTX 50 card at
 * 2560x1440): pieces of cards lying across other cards. So after every flick the run compares
 * the screen with a fresh repaint of it (Sim.integrity), with the pointer parked away from the
 * grid so no card is lifted by a hover between the two frames.
 */
const steps = require('../steps');

module.exports = async function scroll(sim) {
  const cards = await steps.heroesList(sim);
  if (!sim.check('the list of hero mods is drawn', cards, 'fewer than 100 cards after 15 s')) return;
  // the app remembers where each list was left, and a scenario before this one may have left
  // it at the bottom, where every flick down is a flick that cannot move
  await sim.js(`document.getElementById('main').scrollTop = 0`);
  await sim.settle(600);
  await sim.shot('top');

  // the next page comes before its end is on screen: the marker a thousand pixels below the
  // visible part is already near enough (it was not, watched against the window: #main clipped it)
  const drawn = `document.querySelectorAll('.view-pane[data-pane="catalog"] .grid .card').length`;
  const first = await sim.js(drawn);
  await sim.js(`(() => {
    const main = document.getElementById('main'), m = document.querySelector('.view-pane[data-pane="catalog"] .grid-more');
    if (m) main.scrollTop += m.getBoundingClientRect().top - main.getBoundingClientRect().bottom - 1000;
  })()`);
  sim.check('the next page is drawn before the end of the list comes into view',
    await sim.until(`${drawn} > ${first}`, 3000), `still ${first} cards with the end 1000 px below the window`);
  await sim.js(`document.getElementById('main').scrollTop = 0`);
  await sim.settle(600);

  const grid = await sim.find('#main');
  const park = { x: Math.round(grid.x), y: 8 }; // the title bar: nothing there lifts on hover
  const flicks = [900, 900, 1400, -600, 2000, 700, -1200, 2600];
  const at = () => sim.js(`Math.round(document.getElementById('main').scrollTop)`);
  const room = `(() => { const m = document.getElementById('main'); return m.scrollHeight - m.clientHeight; })()`;
  for (const [i, dy] of flicks.entries()) {
    await sim.move(grid.x, grid.y);
    const before = await at();
    const last = await sim.js(room);
    const count = await sim.js(drawn);
    await sim.fling(dy, 8, 16);
    await sim.settle(300);
    const after = await at();
    // A flick is seven thousand pixels in an eighth of a second, far past the thousand the next
    // page is fetched ahead of. Where the page is drawn mid-flick the list runs on; on a slower
    // machine (the Linux runner) it is drawn just after, and the flick stops at the end of what
    // was there before it, having moved a hundred pixels. That is the list working: what has to
    // happen then is the next page arriving, so that is what is waited for and checked.
    const stopped = dy > 0 && after > before && after >= last - 2;
    const grew = stopped && await sim.until(`${drawn} > ${count}`, 3000);
    // a check that compares a list that never moved proves nothing, so moving is checked first
    const moved = Math.sign(after - before) === Math.sign(dy) && Math.abs(after - before) > 200;
    sim.check(`flick ${i + 1} moves the list`, moved || grew,
      `scrollTop went from ${before} to ${after} for a flick of ${dy}${stopped ? `, the end of the ${count} cards drawn, and no page came after` : ''}`);
    await sim.move(park.x, park.y);
    await sim.settle(900);
    await sim.integrity(`flick-${i + 1}`);
  }
  await sim.shot('after-flicks');

  // the very end of the list, with every page of it drawn
  await steps.allCards(sim);
  const end = await sim.js(`new Promise((done) => {
    const main = document.getElementById('main');
    main.scrollTop = main.scrollHeight;
    setTimeout(() => {
      const cards = [...document.querySelectorAll('.grid .card')];
      const last = cards[cards.length - 1].getBoundingClientRect();
      const box = main.getBoundingClientRect();
      done({
        cards: cards.length,
        lastBottom: Math.round(last.bottom),
        mainBottom: Math.round(box.bottom),
        scrolled: Math.round(main.scrollTop),
        max: main.scrollHeight - main.clientHeight,
      });
    }, 1200);
  })`);
  sim.check('the list scrolls all the way to its end', end.scrolled >= end.max - 2, `stopped at ${end.scrolled} of ${end.max}`, end);
  sim.check('the last card is inside the window at the end of the list', end.lastBottom <= end.mainBottom + 1,
    `last card ends at ${end.lastBottom}, the list at ${end.mainBottom}`, end);
  sim.windowFits();
  await sim.settle(600);
  await sim.integrity('end-of-list');
  await sim.shot('end');
};
