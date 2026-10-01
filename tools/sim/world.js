/**
 * The things around the app that the app reacts to, played by the simulation: the game running
 * and quitting, and Steam updating the game or checking its files.
 *
 * The game. The app knows Dota is running by the process name alone (main.js dotaIsRunning:
 * "dota2.exe" through tasklist on Windows, "dota2" through pgrep on Linux). So a harmless program
 * copied under that name into the game's bin folder is, to the app, the game: ping on Windows,
 * sleep on Linux, both of which sit quietly until killed. When the real game quits it rewrites
 * boot.vcfg, so quitting here does too.
 *
 * Steam. An update bumps ClientVersion in dota/steam.inf and puts Valve's own branch file and
 * signature list back; the check of the game's files ("Verify integrity") puts the same two files
 * back without touching the version. The app's patch watcher (src/patch-watch.ts) is what should
 * notice either one.
 *
 * Everything here writes only inside the game folder it is given, which in a simulation is the
 * sandbox's.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const patcher = require('../../src/patcher.ts');

const BIN = process.platform === 'win32' ? ['bin', 'win64', 'dota2.exe'] : ['bin', 'linuxsteamrt64', 'dota2'];

/** Starts "the game". Returns a handle for quit(). */
function startGame(gamePath) {
  const exe = path.join(gamePath, ...BIN);
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  if (process.platform === 'win32') {
    fs.copyFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'PING.EXE'), exe);
  } else {
    fs.copyFileSync(fs.existsSync('/usr/bin/sleep') ? '/usr/bin/sleep' : '/bin/sleep', exe);
    fs.chmodSync(exe, 0o755);
  }
  const args = process.platform === 'win32' ? ['-n', '100000', '127.0.0.1'] : ['100000'];
  const child = spawn(exe, args, { windowsHide: true, stdio: 'ignore', detached: false });
  return { child, exe };
}

/** Quits "the game" the way the real one does: gone, and boot.vcfg rewritten on the way out. */
async function quitGame(game, gamePath, { audio = null } = {}) {
  if (game && game.child && game.child.exitCode === null) {
    await new Promise((r) => { game.child.once('exit', r); game.child.kill(); });
  }
  const boot = path.join(gamePath, 'dota', 'cfg', 'boot.vcfg');
  try {
    let text = fs.readFileSync(boot, 'utf8');
    if (audio) text = text.replace(/("AudioLanguage"\s+")[^"]*(")/, `$1${audio}$2`);
    fs.writeFileSync(boot, text);
  } catch { /* no boot.vcfg yet: the game writes one on its first quit, and so does nothing here */ }
}

/* Valve's own branch file and signature list: ours with our additions taken out, which is what
   Steam writes back. */
function putValveFilesBack(gamePath) {
  const p = patcher.paths(gamePath);
  const branch = fs.readFileSync(p.branch, 'latin1');
  fs.writeFileSync(p.branch, patcher.stripPatch(branch), 'latin1');
  let signatures;
  try { signatures = fs.readFileSync(p.signatures, 'latin1'); } catch { return; } // a game without one
  fs.writeFileSync(p.signatures, patcher.stripSignatures(signatures), 'latin1');
}

/** Steam updates the game: a new build number, and Valve's files back in place. */
function steamUpdate(gamePath) {
  const inf = path.join(gamePath, 'dota', 'steam.inf');
  const text = fs.readFileSync(inf, 'latin1');
  const next = text.replace(/^ClientVersion=(\d+)/m, (_, n) => `ClientVersion=${Number(n) + 1}`);
  fs.writeFileSync(inf, next, 'latin1');
  putValveFilesBack(gamePath);
  return /^ClientVersion=(\d+)/m.exec(next)[1];
}

/** Steam checks the game's files: Valve's files back, the build number untouched. */
function steamVerify(gamePath) {
  putValveFilesBack(gamePath);
}

/** Whether the branch file carries the app's search path right now. */
function searchPathsOurs(gamePath) {
  try { return fs.readFileSync(patcher.paths(gamePath).branch, 'latin1').includes(patcher.MARKER); } catch { return false; }
}

module.exports = { startGame, quitGame, steamUpdate, steamVerify, searchPathsOurs, BIN };
