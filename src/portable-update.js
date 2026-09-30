/* Updating a copy that was never installed.
 *
 * electron-updater updates Windows by handing the download to the NSIS installer, and a
 * portable build has none, so it sits at whatever version it was downloaded at. The obvious
 * fix is to have the exe replace itself: rename the running file, drop the new one in its
 * place, restart. It works, and it is also exactly the shape of behaviour that antivirus
 * heuristics are built to notice - an unsigned executable rewriting and relaunching itself.
 * This project has already been through one Defender false positive without doing anything of
 * the sort, and a portable build is the one people pick specifically to keep their system
 * untouched.
 *
 * So the new version is downloaded and put NEXT TO the current exe, and the user is told it is
 * there. One double click instead of a trip to the website, and nothing on disk is rewritten.
 *
 * What makes it safe to download at all: CI publishes portable.yml beside the installer, with
 * the size and SHA-256 of that release's portable exe. The manifest is fetched from GitHub
 * itself with no mirrors in the way (a mirror could rewrite both the hash and the file), and
 * the download is then checked against it. A file that does not match is deleted rather than
 * offered.
 */
const fs = require('fs');
const path = require('path');
const { fetchText, downloadFile } = require('./net.ts');

const REPO = 'dota2modmanager/dota2-mod-manager';
const MANIFEST = 'portable.yml';

const releaseUrl = (version, file) =>
  `https://github.com/${REPO}/releases/download/v${version}/${file}`;

/* The bucket the mods already come from, carrying the current release as well since
 * 2026-09-10 (tools/r2-release.mjs). It holds one version, which is why the manifest's own
 * version is checked below rather than assumed.
 */
const MIRROR = 'https://cdn.dota2modmanager.com/updates/';

/* Where to look, in order.
 *
 * GitHub first and without mirrors: the manifest carries the hash everything else is checked
 * against, so a public proxy must not be able to touch it. That rule cost the portable build
 * its update entirely whenever GitHub was unreachable, which for part of the userbase is every
 * day and for everybody was three hours on 2026-08-17.
 *
 * The second entry is not a proxy. It is this project's own bucket, reached with credentials
 * only this project holds, which is the same trust as the release page itself - and the same
 * reasoning as the update feed fallback in main.js. Manifest and binary both come from
 * whichever source answered, so the hash and the file it describes are always from one place.
 */
const SOURCES = [
  { name: 'github', manifest: (v) => releaseUrl(v, MANIFEST), asset: (v, f) => releaseUrl(v, f), trustedOnly: true },
  { name: 'mirror', manifest: () => `${MIRROR}${MANIFEST}`, asset: (v, f) => `${MIRROR}${f}`, trustedOnly: false },
];

/**
 * The three fields the app needs out of portable.yml, without pulling in a YAML parser for a
 * file this project writes itself. Anything missing or malformed is a manifest we refuse.
 * @returns {{ file: string, size: number, sha256: string, version: string }}  version is '' when
 *   the manifest does not say
 */
function parseManifest(text) {
  const field = (name) => {
    const m = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(String(text || ''));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  };
  const file = field('file');
  const size = Number(field('size'));
  const sha256 = field('sha256').toLowerCase();
  const version = field('version');
  // the file is a name in the release, never a path, and the hash is a hash
  if (!/^[A-Za-z0-9._-]+\.exe$/.test(file)) throw new Error('portable.yml: bad file name');
  if (!Number.isFinite(size) || size <= 0) throw new Error('portable.yml: bad size');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('portable.yml: bad sha256');
  return { file, size, sha256, version };
}

/** Where the running portable exe actually lives, or null when this is not a portable copy. */
function portableDir() {
  return process.env.PORTABLE_EXECUTABLE_DIR || null;
}

/**
 * Fetch the new build and leave it beside the current one.
 *
 * @param {string} version           the version to fetch, without the leading v
 * @param {object} [opts]
 * @param {(loaded: number, total: number) => void} [opts.onProgress]
 * @param {string} [opts.dir]        where to put it; defaults to the folder holding the exe
 * @param {(msg: string) => void} [opts.log]
 * @param {Array} [opts.sources]     where to look and in what order; SOURCES unless a test says
 * @returns {Promise<{ path: string, name: string, bytes: number, already?: boolean }>}  already
 *   when the same build was fetched before
 */
async function fetchBeside(version, { onProgress = () => {}, dir = portableDir(), log = () => {}, sources = SOURCES } = {}) {
  if (!dir) throw new Error('not a portable copy');
  if (!/^\d+\.\d+\.\d+$/.test(String(version || ''))) throw new Error(`bad version ${version}`);

  let last = null;
  for (const source of sources) {
    let manifest;
    try {
      manifest = parseManifest(await fetchText(source.manifest(version), { trustedOnly: source.trustedOnly }));
    } catch (err) {
      last = err;
      log(`portable update: no manifest from ${source.name} (${err.message || err})`);
      continue;
    }

    /* The mirror holds one release, so it can be a version behind what the update check found.
     * Without this it would hand over an older binary under the newer version's name, and the
     * hash would match, because both came from the same stale manifest. */
    if (manifest.version && manifest.version !== version) {
      last = new Error(`${source.name} has ${manifest.version}, not ${version}`);
      log(`portable update: ${last.message}`);
      continue;
    }

    // named with its version so a folder can hold the old and the new without a collision, and
    // so the user can see at a glance which one they are about to run
    const name = manifest.file.replace(/\.exe$/i, `-${version}.exe`);
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size === manifest.size) {
      return { path: dest, name, bytes: manifest.size, already: true };
    }

    try {
      // the binary comes from whoever gave us the manifest, so the hash and the file it
      // describes are never from two different places
      const got = await downloadFile(source.asset(version, manifest.file), dest, {
        expectSha256: manifest.sha256,
        onProgress,
        log,
      });
      return { path: got.path, name, bytes: got.bytes };
    } catch (err) {
      last = err;
      log(`portable update: ${source.name} could not hand over the build (${err.message || err})`);
    }
  }
  throw last || new Error('no source had this version');
}

module.exports = { parseManifest, fetchBeside, portableDir, releaseUrl, MANIFEST, MIRROR, SOURCES };
