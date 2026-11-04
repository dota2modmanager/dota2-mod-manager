/**
 * A session with the game: the item table (Settings → Game files) switched on with the game
 * running and then closed, Steam
 * updating the game while it runs, and Steam checking the game's files while the app is open.
 * After each, tools/sim/dota.js asks whether the game would load what the app left.
 *
 * What the app promises (src/game-upkeep.ts, src/ipc-game.ts, src/patch-watch.ts):
 *   - it does not write gameinfo while the game holds it open, and says so (the game watch
 *     in src/game-watch.ts may refuse first, with its own words);
 *   - an update that lands while the game runs is noticed, the repair waits for the game to
 *     close, and My mods says why the mods are off until then;
 *   - once the game is closed the repair runs, by itself or on "I closed it, retry".
 *
 * The game and Steam are played by tools/sim/world.js inside the sandbox.
 */
const steps = require('../steps');
const world = require('../world');
const dota = require('../dota');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function gameSession(sim) {
  const s = await sim.js('window.api.settings.get()');
  const game = s.dotaGamePath;
  if (!sim.check('the app has a game to work on', game && s.dotaPathValid, JSON.stringify({ game, valid: s.dotaPathValid }))) return;

  const toasts = () => sim.js(`[...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent.trim()).join(' | ')`);
  const tableOn = async () => (await sim.js('window.api.settings.get()')).schemaPatch === true;
  const repair = () => sim.js('window.api.patch.repairState()');
  // the status bar says Dota is open until the app sees it close (src/game-watch.ts asks every second)
  const seenClosed = () => sim.until(`document.getElementById('dotaStatusDot')?.className !== 'dot warn'`, 5000);

  // a known start: the item table off, Valve's search paths
  await steps.itemTable(sim, false);
  sim.check('the session starts with the item table off, with Valve\'s search paths', !await tableOn() && !world.searchPathsOurs(game),
    `item table on: ${await tableOn()}, search paths ours: ${world.searchPathsOurs(game)}`);

  // 1. the game is running: the app must not write gameinfo, and must say so
  let running = world.startGame(game);
  await sleep(1500);
  const { asked, said } = await steps.itemTable(sim, true);
  sim.check('with the game running, turning the item table on is refused and the app says why',
    asked && /Закрой Dota 2|Close Dota 2|Закрой игру|close the game/i.test(said) && !world.searchPathsOurs(game),
    `dialog shown: ${asked}; toasts: "${said}"; search paths ours: ${world.searchPathsOurs(game)}`);
  await sim.shot('refused-while-running');
  await world.quitGame(running, game);
  await sleep(1000);
  sim.check('the app sees the game close within a few seconds', await seenClosed(), 'the status bar still says Dota is open');

  // 2. the game is closed: it goes through, and the game would load it
  const { ok: on } = await steps.itemTable(sim, true);
  sim.check('with the game closed, the item table turns on and the search path is written', on && world.searchPathsOurs(game),
    `item table on: ${await tableOn()}, search paths ours: ${world.searchPathsOurs(game)}, toasts: "${await toasts()}"`);
  let seen = dota.checkGame(game);
  sim.check('the game would load the folder the app left', seen.ok, seen.problems.join('; '), { mounts: seen.mounts });

  // 3. Steam updates the game while it runs
  running = world.startGame(game);
  await sleep(1000);
  const build = world.steamUpdate(game);
  const waiting = await sim.until(`window.api.patch.repairState().then((r) => r.state === 'waiting' && r)`, 20000);
  sim.check('an update landing while the game runs is noticed, and the repair waits for the game to close', waiting,
    `build ${build}; repair state after 20 s: ${JSON.stringify(await repair())}`);
  await sim.click('[data-view="library"]');
  const banner = await sim.until(`document.getElementById('repairNowBtn')`, 6000);
  sim.check('My mods says the mods are off until the game is closed, with a button to retry', banner, 'no #repairNowBtn in My mods');
  await sim.shot('update-while-running');
  await world.quitGame(running, game);
  await sleep(800);
  await seenClosed();
  if (banner) await sim.click('#repairNowBtn');
  const healed = await sim.until(`window.api.patch.repairState().then((r) => r.state !== 'waiting' && r)`, 30000);
  sim.check('with the game closed the repair runs and puts the search path back', healed && healed.state !== 'failed' && world.searchPathsOurs(game),
    `repair: ${JSON.stringify(healed || await repair())}; search paths ours: ${world.searchPathsOurs(game)}`);
  seen = dota.checkGame(game);
  sim.check('after the repair the game would load the mods again', seen.ok, seen.problems.join('; '));
  await sim.shot('repaired');

  // 4. Steam checks the game's files while the app is open: Valve's files back, same build
  world.steamVerify(game);
  let back = false;
  for (let i = 0; i < 30 && !back; i++) { await sleep(1000); back = world.searchPathsOurs(game); }
  sim.check('Steam checking the game\'s files while the app is open is noticed and repaired', back,
    'the branch file stayed Valve\'s for 30 s after the check, so the mods are off until the app restarts or its Play button is pressed');

  // leave it as found: the item table off, the catalog open
  await steps.itemTable(sim, false);
  await sim.click('[data-view="catalog"]');
};
