// What tools/r2-sync.mjs decides about each object, apart from the network it runs against.
//
// On 2026-09-10 the bucket held 24 archives their authors had replaced, one since August. The
// sync skipped any object already there under the same name, while the comment at the top of it
// said the size was checked. Once 2.6.5 started measuring downloads against the published
// checksum, every one of those copies was refused. These are the two checks that were missing,
// in a form a test can hold (test/mirror-plan.test.js), since the script itself only runs in CI
// against the real bucket.
const crypto = require('crypto');

/**
 * Which objects in the bucket are a copy of something older.
 *
 * A HEAD request per object gives the size upstream serves now, and a replaced archive changes
 * size. An object whose upstream size is unknown (the HEAD failed) is left alone rather than
 * copied again: a network error is not evidence of a change.
 *
 * @param {Array<{path: string}>} present  wanted objects the bucket already has
 * @param {Map<string, number>} upstream   size upstream reports, by path
 * @param {Map<string, number>} have       size in the bucket, by path
 * @returns {Set<string>}
 */
function staleCopies(present, upstream, have) {
  return new Set(present
    .filter((item) => upstream.has(item.path) && upstream.get(item.path) !== have.get(item.path))
    .map((item) => item.path));
}

/**
 * The SHA-256 the catalog publishes for a mirrored archive, or null when it publishes none.
 *
 * `mod-hashes.json` is keyed `category/file`; the bucket keeps the same file under
 * `assets/files/category/file`. A value that is not 64 hex characters is treated as absent.
 *
 * @param {Record<string, unknown>} published  the parsed mod-hashes.json
 * @param {string} objectPath
 * @returns {string|null}
 */
function publishedHash(published, objectPath) {
  const m = /^assets\/files\/(.+?)\/([^/]+)$/.exec(objectPath);
  const value = m && published[`${m[1]}/${m[2]}`];
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
}

/**
 * Whether bytes fetched from the source are worth uploading. With no published hash the copy is
 * still a copy, only unverified; with one, a mismatch is refused, because the app would refuse
 * the same bytes after downloading all of them.
 *
 * @param {Buffer} body
 * @param {string|null} want
 * @returns {{ok: boolean, got: string|null}}
 */
function checkBody(body, want) {
  if (!want) return { ok: true, got: null };
  const got = crypto.createHash('sha256').update(body).digest('hex');
  return { ok: got === want, got };
}

/* ---------- how much room is left ---------- */

/**
 * Whether an object of this size fits. Replacing a copy costs the difference, so a full bucket can
 * still take the new version of an archive it holds: stopping at the first object past the budget
 * is what left 1613 copies out of date while a run copied nothing at all.
 *
 * @param {{used: number, budget: number, already?: number, size: number}} o  bytes; `already` is the copy it replaces
 * @returns {boolean}
 */
function fits({ used, budget, already = 0, size }) {
  return used - already + size <= budget;
}

/** Close enough to the end that somebody should hear about it before it arrives. */
const NEARLY_FULL = 0.95;

/**
 * Whether the size of the bucket needs saying out loud.
 *
 * A sync that runs out of room stops copying and still goes green: the last line says "stopped on
 * budget" and nothing else does, so the mirror quietly stops growing while the catalog keeps
 * doing so, and the first anybody hears of it is a user who cannot install something on the day
 * GitHub is down. That is the whole point of the mirror, failing silently.
 *
 * The numbers are not far off: the bucket holds the update mirror as well and was at 8.16 GB of
 * the 9 GB this sync allows itself in September 2026, growing about 50 MB a day.
 *
 * @param {{used: number, budget: number, stopped?: string}} state  bytes, bytes, and why the run ended
 * @returns {{warn: boolean, text: string}}
 */
function budgetNote({ used, budget, stopped = '' }) {
  const gb = (n) => (n / 1024 ** 3).toFixed(2);
  if (stopped === 'budget') {
    return {
      warn: true,
      text: `the mirror is full at ${gb(used)} GB of ${gb(budget)} and stopped copying, so new mods `
        + 'are not being mirrored. Give it more room where the bucket has it (--budget), lower the '
        + 'cap on one archive (--max-file), or take the heaviest archives out.',
    };
  }
  const left = budget - used;
  if (left <= budget * (1 - NEARLY_FULL)) {
    return {
      warn: true,
      text: `the mirror has ${gb(left)} GB left of ${gb(budget)}. The catalog grows by roughly `
        + '50 MB a day, so this is weeks away, not months.',
    };
  }
  return { warn: false, text: `${gb(left)} GB of the budget still free` };
}

/* ---------- the release mirror ---------- */

/** What an updater reads, and the binaries those files point at. */
const BINARIES = [
  ['Dota-2-Mod-Manager-Setup.exe', 'application/octet-stream'],
  ['Dota-2-Mod-Manager-Portable.exe', 'application/octet-stream'],
  ['Dota-2-Mod-Manager.AppImage', 'application/octet-stream'],
];

const UPDATES = 'updates/';
/** A beta's binaries, so they can sit beside a release's without replacing them. */
const BETA_MARK = '-beta';
const betaName = (name) => name.replace(/(\.[^.]+)$/, `${BETA_MARK}$1`);

/**
 * Where a release goes on the mirror and which files go with it.
 *
 * Everything lives in one folder. The manifests have names of their own - latest.yml for the
 * release channel, beta.yml for the testers - but the binaries they point at do not, so a beta
 * uploaded under the ordinary names would replace the installer latest.yml describes and every
 * copy that cannot reach GitHub would fail its checksum. A beta's binaries therefore carry -beta
 * in the name, and its manifests are rewritten to ask for them.
 *
 * The bucket is the reason it is done this way rather than with a folder of its own: it holds the
 * mod mirror as well and was at 8.77 GB of the free 10 GB in September 2026. A second copy of
 * every release would have been another 320 MB for ever, for a beta that is out a few days.
 *
 * A release also writes beta.yml and beta-linux.yml, pointing at its own files, so a tester whose
 * GitHub is unreachable moves on to the release rather than sitting on the beta it replaced.
 *
 * @param {string} version  2.7.0 or 2.7.0-beta.1
 * @returns {{beta: boolean, uploads: Array<{asset: string, name: string, type: string, retarget?: boolean}>}}
 */
function releasePlan(version) {
  const beta = /-/.test(version);
  if (beta) {
    return {
      beta,
      uploads: [
        // the two feeds a tester reads, rewritten to ask for the -beta binaries
        { asset: 'beta.yml', name: 'beta.yml', type: 'text/yaml', retarget: true },
        { asset: 'beta-linux.yml', name: 'beta-linux.yml', type: 'text/yaml', retarget: true },
        ...BINARIES.map(([asset, type]) => ({ asset, name: betaName(asset), type })),
      ],
    };
  }
  return {
    beta,
    uploads: [
      ['latest.yml', 'text/yaml'], ['latest-linux.yml', 'text/yaml'], ['portable.yml', 'text/yaml'],
      ...BINARIES,
    ].map(([asset, type]) => ({ asset, name: asset, type })).concat([
      // the release, under the names the beta channel reads, pointing at the same binaries
      { asset: 'latest.yml', name: 'beta.yml', type: 'text/yaml' },
      { asset: 'latest-linux.yml', name: 'beta-linux.yml', type: 'text/yaml' },
    ]),
  };
}

/**
 * A feed that asks for the -beta copies of the files it names. electron-updater reads `path` and
 * the `url` of each entry; the checksums inside describe the bytes, which do not change with the
 * name, so only the names are rewritten.
 * @param {string} text  the .yml as the release published it
 */
function retargetFeed(text) {
  return String(text).replace(/(Dota-2-Mod-Manager[A-Za-z-]*)(\.(?:exe|AppImage))/g, (all, stem, ext) => (
    stem.endsWith(BETA_MARK) ? all : `${stem}${BETA_MARK}${ext}`
  ));
}

/**
 * Which of the objects already there this run should clear out. A beta only ever clears the beta
 * copies, so it can never delete the release everybody updates from; a release clears both, which
 * is what frees the beta's binaries once the version that replaced it is out.
 * @param {string[]} keys      everything under updates/
 * @param {Set<string>} kept   keys this run uploaded
 * @param {boolean} beta
 */
function staleReleaseFiles(keys, kept, beta) {
  return keys.filter((key) => {
    if (kept.has(key)) return false;
    return beta ? key.includes(BETA_MARK) : true;
  });
}

/**
 * The whole folder as it has to stand now: the release everybody is on, and the beta a tester is
 * on when one newer than it is out. One run of this puts the mirror right from any state, a version
 * or two behind included, which a run per version could not: a release run clears the beta's
 * binaries, so a beta that came before it had to be uploaded again, and nobody did.
 * @param {string} stable        2.7.1
 * @param {string|null} beta     2.8.0-beta.1, or null when no beta is newer than the release
 * @returns {{uploads: Array<{version: string, asset: string, name: string, type: string, retarget?: boolean}>, keep: Set<string>}}
 */
function currentPlan(stable, beta) {
  const uploads = releasePlan(stable).uploads.map((u) => ({ ...u, version: stable }));
  if (beta) {
    const theirs = releasePlan(beta).uploads.map((u) => ({ ...u, version: beta }));
    const names = new Set(theirs.map((u) => u.name));
    return { uploads: [...uploads.filter((u) => !names.has(u.name)), ...theirs], keep: new Set([...uploads, ...theirs].map((u) => `${UPDATES}${u.name}`)) };
  }
  return { uploads, keep: new Set(uploads.map((u) => `${UPDATES}${u.name}`)) };
}

module.exports = {
  staleCopies, publishedHash, checkBody, budgetNote, fits, releasePlan, retargetFeed, staleReleaseFiles, currentPlan,
  UPDATES, BETA_MARK, betaName,
};
