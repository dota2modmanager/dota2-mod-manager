/**
 * A session with the game: safe mode switched off with the game running and then closed, Steam
 * updating the game while it runs, and Steam checking the game's files while the app is open.
 * After each, tools/sim/dota.js asks whether the game would load what the app left.
 *
 * What the app promises (main.js, src/ipc-game.js, src/patch-watch.ts):
 *   - it does not write gameinfo while the game holds it open, and says so;
 *   - an update that lands while the game runs is noticed, the repair waits for the game to
 *     close, and My mods says why the mods are off until then;
 *   - once the game is closed the repair runs, by itself or on "I closed it, retry".
 *
 * The game and Steam are played by tools/sim/world.js inside the sandbox.
 */
const world = require('../world');
const dota = require('../dota');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function gameSession(sim) {
  const s = await sim.js('window.api.settings.get()');
  const game = s.dotaGamePath;
  if (!sim.check('the app has a game to work on', game && s.dotaPathValid, JSON.stringify({ game, valid: s.dotaPathValid }))) return;

  const toasts = () => sim.js(`[...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent.trim()).join(' | ')`);
  const safeOn = () => sim.js(`document.getElementById('safeModeBtn').getAttribute('aria-checked') === 'true'`);
  const repair = () => sim.js('window.api.patch.repairState()');
  const turnSafeOff = async () => {
    await sim.click('#safeModeBtn');
    if (!await sim.until(`document.querySelector('.safe-box [data-c="yes"]')`, 5000)) return false;
    await sim.click('.safe-box [data-c="yes"]');
    await sleep(1500);
    return true;
  };

  // a known start: safe mode on, Valve's search paths
  if (!await safeOn()) {
    await sim.click('#safeModeBtn');
    await sim.until(`document.getElementById('safeModeBtn').getAttribute('aria-checked') === 'true'`, 8000);
  }
  sim.check('the session starts in safe mode, with Valve\'s search paths', await safeOn() && !world.searchPathsOurs(game),
    `safe mode on: ${await safeOn()}, search paths ours: ${world.searchPathsOurs(game)}`);

  // 1. the game is running: the app must not write gameinfo, and must say so
  let running = world.startGame(game);
  await sleep(1500);
  const asked = await turnSafeOff();
  const said = await toasts();
  sim.check('with the game running, turning safe mode off is refused and the app says why',
    asked && /Закрой Dota 2|Close Dota 2/.test(said) && !world.searchPathsOurs(game),
    `dialog shown: ${asked}; toasts: "${said}"; search paths ours: ${world.searchPathsOurs(game)}`);
  await sim.shot('refused-while-running');
  await world.quitGame(running, game);
  await sleep(1000);

  // 2. the game is closed: it goes through, and the game would load it
  await turnSafeOff();
  const off = await sim.until(`document.getElementById('safeModeBtn').getAttribute('aria-checked') === 'false'`, 10000);
  sim.check('with the game closed, safe mode turns off and the search path is written', off && world.searchPathsOurs(game),
    `switch says safe: ${await safeOn()}, search paths ours: ${world.searchPathsOurs(game)}, toasts: "${await toasts()}"`);
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

  // leave it as found: safe mode on, the catalog open
  if (!await safeOn()) {
    await sim.click('#safeModeBtn');
    await sim.until(`document.getElementById('safeModeBtn').getAttribute('aria-checked') === 'true'`, 8000);
  }
  await sim.click('[data-view="catalog"]');
};
