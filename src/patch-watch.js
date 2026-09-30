// Noticing that Dota was patched, while the app is open.
//
// A game update overwrites the search-path patch and moves the item table underneath the
// built schema, and the repair for that already exists (schemaService.heal). What was
// missing is the moment to run it: until now the app only looked at startup and when its
// own Play button was pressed. Steam updates the game in the background, and most people
// press Play in Steam. So the app sat there, open, next to a game whose mods had stopped
// working, and said nothing.
//
// Two files tell the whole story and both are Valve's:
//   dota/steam.inf         ClientVersion, bumped by every patch;
//   bin/win64/dota.signatures  the signature list, rewritten by a patch and put back by
//                          Steam's file check.
// The signature digest is taken with our own appended line stripped, so applying our patch
// never looks like a game update - otherwise the app would keep waking itself up.
//
// This module only decides "the game changed"; what to do about it lives in main.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const patcher = require('./patcher.ts');

// A patch rewrites a lot of files at once, so the first event is never the last one.
const DEBOUNCE_MS = 3000;
// A watch handle can die with the directory it was set on (Steam replaces folders during
// big updates). Re-arm rather than go deaf for the rest of the session.
const REARM_MS = 30000;

const infPath = (gamePath) => path.join(gamePath, 'dota', 'steam.inf');

function clientVersion(gamePath) {
  try {
    const m = /^ClientVersion=(\d+)/m.exec(fs.readFileSync(infPath(gamePath), 'latin1'));
    return m ? m[1] : null;
  } catch { return null; }
}

function signaturesDigest(gamePath) {
  try {
    const raw = fs.readFileSync(patcher.paths(gamePath).signatures, 'latin1');
    return crypto.createHash('sha1').update(patcher.stripSignatures(raw), 'latin1').digest('hex').slice(0, 16);
  } catch { return null; }
}

/**
 * What build of the game is on disk right now, as one comparable string.
 * @returns {string|null} null when there is no game to read (no path set, folder gone)
 */
function gameStamp(gamePath) {
  if (!gamePath) return null;
  const version = clientVersion(gamePath);
  const digest = signaturesDigest(gamePath);
  if (!version && !digest) return null;
  return `${version || '?'}:${digest || '?'}`;
}

/**
 * Steam's check of the game's files is a patch that leaves no stamp.
 *
 * It puts Valve's branch file and signature list back and does not touch the build number, and
 * the stamp reads the signature list with the app's own line taken out, which is exactly the line
 * the check removed. So the stamp stays the same while the mods stop loading. The simulation's
 * game session (tools/sim) found it on 2026-09-24: the branch file stayed Valve's for as long as
 * the app stayed open, until a restart or a press of its own Play button.
 *
 * So a second question, asked only when the app expects its search path to be there (safe mode
 * off): is it? When it has gone, that is reported once, and not again until it is back, so the
 * repair it starts cannot wake the watcher up in a loop.
 */
function searchPathGone(gamePath) {
  try { return !fs.readFileSync(patcher.paths(gamePath).branch, 'latin1').includes(patcher.MARKER); } catch { return false; }
}

/**
 * @param {object} deps
 * @param {() => string|null} deps.getGamePath
 * @param {(evt: {from: string|null, to: string, reason?: string}) => void} deps.onPatch
 * @param {() => boolean} [deps.expectsPatch] whether the app's search path should be in the game (safe mode off)
 * @param {(msg: string) => void} [deps.log]
 * @param {number} [deps.debounceMs] shortened by tests, which cannot wait out a real patch
 */
function createPatchWatcher({ getGamePath, onPatch, expectsPatch = () => false, log = () => {}, debounceMs = DEBOUNCE_MS }) {
  let handles = [];
  let debounce = null;
  let rearm = null;
  let known = null;
  let running = false;
  let goneReported = false;

  function look() {
    const game = getGamePath();
    const stamp = gameStamp(game);
    const gone = Boolean(stamp) && expectsPatch() && searchPathGone(game);
    if (!gone) goneReported = false;
    if (stamp && stamp === known && gone && !goneReported) {
      goneReported = true;
      log('the search path is gone at the same build: Steam checked the game\'s files');
      try { onPatch({ from: known, to: stamp, reason: 'files-restored' }); } catch (err) { log('patch handler failed: ' + err.message); }
      return;
    }
    if (!stamp || stamp === known) return;
    const from = known;
    // Remembered before the caller is told, so one update is reported once even if the
    // repair after it fails: retrying a failed repair is the caller's business, not ours.
    known = stamp;
    log(`game changed: ${from || 'unknown'} -> ${stamp}`);
    try { onPatch({ from, to: stamp }); } catch (err) { log('patch handler failed: ' + err.message); }
  }

  function ping() {
    clearTimeout(debounce);
    debounce = setTimeout(look, debounceMs);
  }

  /**
   * The canonical path, because fs.watch on Windows aborts the process when it is handed a
   * path that is not one.
   *
   * libuv turns the filename an event carries into one relative to the watched directory, and
   * asserts the first is a prefix of the second. Hand it "C:\Users\RUNNER~1\..." and the event
   * comes back with the long name, the prefix check fails, and the process dies on
   * "Assertion failed: !_wcsnicmp(filename, dir, dirlen), file src\win\fs-event.c" - a native
   * abort, not an exception, so nothing below can catch it and the whole app goes with it.
   *
   * Found by the Windows CI job on its first run (2026-09-09), where the runner's temp folder
   * is an 8.3 short path. A player's game folder reached through a short path or a junction is
   * the same shape of input, and one line here removes the whole class.
   */
  const canonical = (dir) => {
    try { return fs.realpathSync.native(dir); } catch { return dir; }
  };

  function watchDir(rawDir) {
    if (!fs.existsSync(rawDir)) return;
    const dir = canonical(rawDir);
    try {
      const h = fs.watch(dir, { persistent: false }, ping);
      h.on('error', (err) => {
        log(`watch on ${dir} died: ${err.message}`);
        try { h.close(); } catch { /* already gone */ }
        handles = handles.filter((x) => x !== h);
        if (running && !rearm) rearm = setTimeout(() => { rearm = null; arm(); }, REARM_MS);
      });
      handles.push(h);
    } catch (err) {
      log(`cannot watch ${dir}: ${err.message}`);
    }
  }

  // Watching the two directories rather than the two files: Steam replaces a file instead
  // of writing into it, and a watch set on the old inode goes quiet at exactly the moment
  // it matters. The extra events from neighbouring files cost one debounced stat.
  function arm() {
    const game = getGamePath();
    if (!game) return;
    for (const h of handles) { try { h.close(); } catch { /* already gone */ } }
    handles = [];
    const dirs = new Set([path.dirname(infPath(game)), path.dirname(patcher.paths(game).signatures)]);
    for (const dir of dirs) watchDir(dir);
  }

  return {
    /** @param {string|null} stamp what the caller already knows to be current */
    start(stamp) {
      if (running) return;
      running = true;
      known = stamp || gameStamp(getGamePath());
      arm();
      log(`watching for Dota patches, current build ${known || 'unknown'}`);
    },
    stop() {
      running = false;
      clearTimeout(debounce);
      clearTimeout(rearm);
      rearm = null;
      for (const h of handles) { try { h.close(); } catch { /* already gone */ } }
      handles = [];
    },
    /** The game path changed under us (found, or picked by hand): watch the new one. */
    rearm() {
      if (!running) return;
      known = gameStamp(getGamePath());
      arm();
      log(`now watching ${getGamePath() || 'nothing'}, build ${known || 'unknown'}`);
    },
    /** Compare right now, without waiting for a file event. */
    check: look,
    /** The stamp the watcher considers current. */
    current: () => known,
  };
}

module.exports = { gameStamp, clientVersion, createPatchWatcher, DEBOUNCE_MS };
