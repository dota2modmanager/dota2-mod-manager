/* Where an installed copy looks for a new version, and on which channel.
 *
 * Moved out of main.js on 2026-09-19, unchanged in what it does, so the beta channel had
 * somewhere to live and so this could be tested against a stand-in for electron-updater rather
 * than only by releasing something.
 *
 * Two feeds. GitHub is the origin; https://cdn.dota2modmanager.com/updates/ is a copy this
 * project also owns, tried only after GitHub fails. On 2026-08-17 GitHub was down for three
 * hours, which meant no installed copy could check for or fetch an update, and nobody noticed,
 * because an app that fails to update looks exactly like an app. Each four-hourly round starts at
 * GitHub again: the mirror is for the hours it is down, not a place to settle into.
 *
 * Two channels. Everybody reads `latest`; the testers the maintainer picked read `beta`, which is
 * a different manifest (beta.yml) in the same place. src/beta.ts decides who is on which, and the
 * decision is re-read rather than remembered: a tester taken off the list is back on the stable
 * channel at the next check, without anybody touching their machine.
 *
 * A portable copy cannot replace itself: electron-updater installs by handing the download to the
 * NSIS installer, and a portable build has none, so it would download 100 MB and then fail
 * quietly. It still looks, and says where the new copy lives.
 */
const { BETA_CHANNEL } = require('./beta.ts');

/** The copy of each release this project keeps, for the hours GitHub is not answering. */
const MIRROR = 'https://cdn.dota2modmanager.com/updates/';
const GITHUB = { provider: 'github', owner: 'dota2modmanager', repo: 'dota2-mod-manager' };
/** How often an open window looks again. */
const EVERY = 4 * 60 * 60 * 1000;

/* One address for both channels: electron-updater asks for latest.yml or beta.yml by itself, and
   the mirror carries both (tools/mirror-plan.js). */
const mirrorFor = () => MIRROR;

/**
 * @param {object} deps
 * @param {object} deps.autoUpdater          electron-updater's, or a stand-in in the tests
 * @param {boolean} deps.isPortable
 * @param {() => string} deps.channel        'latest' or 'beta', read fresh on every check
 * @param {(evt: object) => void} deps.send   tells the window an update exists
 * @param {(msg: string) => void} deps.log
 * @param {(ms: number, fn: () => void) => any} [deps.every]  so a test does not wait four hours
 */
function createUpdater({
  autoUpdater, isPortable = false, channel = () => 'latest', send = () => {}, log = () => {},
  // ms first, to read as "every four hours, do this"; setInterval takes them the other way round
  every = (ms, fn) => setInterval(fn, ms),
}) {
  let lastError = null;
  let portableVersion = null;
  let onMirror = false;

  /** Point electron-updater at a feed for this channel, and say which one it is. */
  function aim(useMirror) {
    const name = channel();
    autoUpdater.channel = name;
    // a beta is a prerelease on GitHub, and the stable channel must never be offered one
    autoUpdater.allowPrerelease = name === BETA_CHANNEL;
    try {
      autoUpdater.setFeedURL(useMirror ? { provider: 'generic', url: mirrorFor() } : { ...GITHUB });
    } catch (err) {
      log(`update feed unusable: ${err.message || err}`);
      return false;
    }
    onMirror = useMirror;
    return true;
  }

  function check() {
    if (!aim(onMirror)) return;
    Promise.resolve(autoUpdater.checkForUpdates()).catch(() => {});
  }

  function start() {
    autoUpdater.autoDownload = !isPortable;

    autoUpdater.on('update-available', (info) => {
      if (isPortable) portableVersion = info.version;
      send({ type: isPortable ? 'portable' : 'available', version: info.version });
    });
    autoUpdater.on('update-downloaded', (info) => send({ type: 'downloaded', version: info.version }));

    // Silent for the user - being offline is not something to interrupt anybody about - but
    // remembered, because "it never updates" is a support question and this is the answer to it.
    autoUpdater.on('error', (err) => {
      lastError = String(err?.message || err).slice(0, 500);
      if (onMirror) return;
      log(`update check failed on GitHub, trying the mirror: ${lastError}`);
      if (aim(true)) Promise.resolve(autoUpdater.checkForUpdates()).catch(() => {});
    });

    check();
    every(EVERY, () => {
      onMirror = false; // every round starts at the origin
      check();
    });
  }

  /**
   * The channel may have changed: the switch was flipped, the account signed out, or the signed
   * list stopped naming it. Re-aim and look again, so the answer arrives now rather than in four
   * hours.
   */
  function recheck() {
    onMirror = false;
    check();
    return channel();
  }

  return {
    start,
    recheck,
    lastError: () => lastError,
    portableVersion: () => portableVersion,
    channel: () => channel(),
  };
}

module.exports = { createUpdater, mirrorFor, MIRROR, EVERY };
