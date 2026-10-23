/**
 * The things around the app that the app reacts to, played by the simulation: the game running
 * and quitting, and Steam updating the game or checking its files.
 *
 * The game. The app knows Dota is running by the process name alone (src/game-upkeep.ts dotaIsRunning:
 * "dota2.exe" through tasklist on Windows, "dota2" through pgrep on Linux). So a harmless program
 * by that name is, to the app, the game. On Windows it is ping, copied under that name into the
 * game's bin folder. On Linux it is this Node with its process name set to dota2: a copy of sleep
 * was, until Ubuntu 26.04 made coreutils one Rust program that picks the tool by its own file name
 * and quits at once under any other (the runners moved to it on 2026-10-21, and from then on the
 * app never saw the game run). Either sits quietly until killed. When the real game quits it
 * rewrites boot.vcfg, so quitting here does too.
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
    const child = spawn(exe, ['-n', '100000', '127.0.0.1'], { windowsHide: true, stdio: 'ignore', detached: false });
    return { child, exe };
  }
  // the file is what makes the folder a game (src/steam.ts); the process is what pgrep finds.
  // 'wx' creates it only where there is none, in one call: no gap between a check and the write
  try {
    fs.writeFileSync(exe, '#!/bin/sh\n', { mode: 0o755, flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  // the scenarios run in Electron's main process: ELECTRON_RUN_AS_NODE makes its binary a plain Node
  const child = spawn(process.execPath, ['-e', "process.title = 'dota2'; setInterval(() => {}, 1 << 30)"], {
    stdio: 'ignore', detached: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
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
