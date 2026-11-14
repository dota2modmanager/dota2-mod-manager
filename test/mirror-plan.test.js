/* What the archive mirror decides to copy, apart from the bucket it copies into.
 *
 * On 2026-09-10 the mirror held 24 archives their authors had replaced: the sync skipped every
 * object already there under the same name. 2.6.5 had just started checking downloads against
 * the published checksum, so each of those copies was refused. tools/r2-sync.mjs runs only in
 * CI against the real bucket; these hold the two decisions it was missing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { staleCopies, publishedHash, checkBody, fits, previewPaths } = require('../tools/mirror-plan.js');

test('the bucket copies every preview the repository lists, covers and clips with them', () => {
  const tree = [
    { path: 'assets/previews/categories/shaders.webp', type: 'blob' },
    { path: 'assets/previews/heroes/clip.mp4', type: 'blob' },
    { path: 'assets/previews/heroes', type: 'tree' },
    { path: 'assets/files/heroes/mod.zip', type: 'blob' },
  ];
  assert.deepEqual(previewPaths({ tree }), ['assets/previews/categories/shaders.webp', 'assets/previews/heroes/clip.mp4']);
  assert.deepEqual(previewPaths(null), []);
});

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const KRATOS = 'assets/files/heroes/Axe Kratos.zip';
const PREVIEW = 'assets/previews/heroes/axe.png';

test('a mod its author replaced is copied again, and one that did not change is left alone', () => {
  const present = [{ path: KRATOS }, { path: 'assets/files/heroes/Same.zip' }, { path: PREVIEW }];
  const have = new Map([[KRATOS, 28_000_000], ['assets/files/heroes/Same.zip', 5_000], [PREVIEW, 900]]);
  const upstream = new Map([[KRATOS, 31_500_000], ['assets/files/heroes/Same.zip', 5_000], [PREVIEW, 900]]);

  assert.deepEqual([...staleCopies(present, upstream, have)], [KRATOS]);
});

test('an object whose upstream size could not be read is not taken for a changed one', () => {
  /* The HEAD requests run sixteen at a time against GitHub. One that fails is a network error,
     and copying the object again on that evidence would spend the free tier's budget on noise. */
  const present = [{ path: KRATOS }];
  assert.equal(staleCopies(present, new Map(), new Map([[KRATOS, 28_000_000]])).size, 0);
});

test('the published hash is found under the key the catalog uses for it', () => {
  const published = {
    'heroes/Axe Kratos.zip': sha('current').toUpperCase(),
    'heroes/Broken.zip': 'not-a-hash',
    'terrains/Short.zip': 'abc123',
  };
  assert.equal(publishedHash(published, KRATOS), sha('current'), 'upper-case hex is the same hash');
  assert.equal(publishedHash(published, 'assets/files/heroes/Broken.zip'), null);
  assert.equal(publishedHash(published, 'assets/files/terrains/Short.zip'), null);
  assert.equal(publishedHash(published, 'assets/files/heroes/Unlisted.zip'), null);
  assert.equal(publishedHash(published, PREVIEW), null, 'a preview has no published hash');
});

test('bytes that do not match the published hash are not uploaded', () => {
  const want = sha('the file the author published');
  assert.deepEqual(checkBody(Buffer.from('the file the author published'), want), { ok: true, got: want });

  const stale = checkBody(Buffer.from('the file from August'), want);
  assert.equal(stale.ok, false);
  assert.equal(stale.got, sha('the file from August'), 'the log line names what the source hashed to');
});

test('with no published hash, a copy is still a copy', () => {
  assert.deepEqual(checkBody(Buffer.from('anything'), null), { ok: true, got: null });
});

// ---------- how much room is left ----------

test('a mirror that ran out of room says so on the run, rather than in the last line of a green log', () => {
  /* The failure this guards is silence: the sync stops copying, the job is still green, and the
     first anybody hears of it is somebody who cannot install a mod on the day GitHub is down. */
  const { budgetNote } = require('../tools/mirror-plan.js');
  const GB = 1024 ** 3;

  const full = budgetNote({ used: 9 * GB, budget: 9 * GB, stopped: 'budget' });
  assert.equal(full.warn, true);
  assert.match(full.text, /full at 9\.00 GB of 9\.00/);
  assert.match(full.text, /--budget/, 'and says what to do about it');

  const nearly = budgetNote({ used: 8.7 * GB, budget: 9 * GB });
  assert.equal(nearly.warn, true, 'within 5% is worth hearing before it arrives, not after');
  assert.match(nearly.text, /0\.30 GB left/);

  const fine = budgetNote({ used: 7 * GB, budget: 9 * GB });
  assert.equal(fine.warn, false);
  assert.match(fine.text, /2\.00 GB/);

  assert.equal(budgetNote({ used: 1 * GB, budget: 9 * GB, stopped: 'limit' }).warn, false,
    'stopping on --limit is somebody asking for a short run, not the bucket filling up');
});

// ---------- the release mirror ----------

test('a beta shares the folder with the release, and never its file names', () => {
  /* The manifests have names of their own; the binaries do not. A beta uploaded under the
     ordinary names would stand where the installer latest.yml describes, and every copy that
     cannot reach GitHub would fetch a build it was never offered and fail its checksum. */
  const { releasePlan } = require('../tools/mirror-plan.js');
  const beta = releasePlan('2.7.0-beta.1');

  assert.equal(beta.beta, true);
  assert.deepEqual(beta.uploads.map((u) => u.name), [
    'beta.yml',
    'beta-linux.yml',
    'beta.json',
    'Dota-2-Mod-Manager-Setup-beta.exe',
    'Dota-2-Mod-Manager-Portable-beta.exe',
    'Dota-2-Mod-Manager-beta.AppImage',
  ]);
  assert.equal(beta.uploads.filter((u) => u.retarget).length, 2, 'both feeds have to ask for the -beta copies');
  assert.equal(beta.uploads.find((u) => u.name === 'beta.json').json, 'beta', 'and so does the Tauri one');
  assert.equal(beta.uploads.some((u) => u.name === 'latest.yml'), false, 'a beta never writes the release feed');
});

test('a release carries the beta feed too, and it costs two files rather than a second copy', () => {
  /* The bucket also holds the mod mirror and was at 8.77 GB of the free 10 GB, so the beta
     channel points at the release's own binaries instead of a duplicate set. */
  const { releasePlan } = require('../tools/mirror-plan.js');
  const out = releasePlan('2.7.0');
  const named = out.uploads.map((u) => `${u.asset} -> ${u.name}`);

  assert.equal(out.beta, false);
  assert.deepEqual(named, [
    'latest.yml -> latest.yml',
    'latest-linux.yml -> latest-linux.yml',
    'portable.yml -> portable.yml',
    'Dota-2-Mod-Manager-Setup.exe -> Dota-2-Mod-Manager-Setup.exe',
    'Dota-2-Mod-Manager-Portable.exe -> Dota-2-Mod-Manager-Portable.exe',
    'Dota-2-Mod-Manager.AppImage -> Dota-2-Mod-Manager.AppImage',
    'latest.yml -> beta.yml',
    'latest-linux.yml -> beta-linux.yml',
    'latest.json -> latest.json',
    'latest.json -> beta.json',
  ]);
  assert.equal(out.uploads.filter((u) => /\.(exe|AppImage)$/.test(u.name)).length, 3, 'one copy of each binary, not two');
});

test("a beta's feed asks for the beta's own files, and the checksums are left alone", () => {
  const { retargetFeed } = require('../tools/mirror-plan.js');
  const yml = [
    'version: 2.7.0-beta.1',
    'files:',
    '  - url: Dota-2-Mod-Manager-Setup.exe',
    '    sha512: LONGHASH==',
    '    size: 98765432',
    'path: Dota-2-Mod-Manager-Setup.exe',
    'sha512: LONGHASH==',
    'releaseDate: 2026-09-20T00:00:00.000Z',
  ].join('\n');

  const out = retargetFeed(yml);
  assert.match(out, /url: Dota-2-Mod-Manager-Setup-beta\.exe/);
  assert.match(out, /path: Dota-2-Mod-Manager-Setup-beta\.exe/);
  assert.match(out, /sha512: LONGHASH==/, 'the bytes did not change, so neither does what describes them');
  assert.equal(retargetFeed(out), out, 'running it twice does not produce -beta-beta');
});

test('clearing out the last version: a beta touches only its own copies', () => {
  const { staleReleaseFiles } = require('../tools/mirror-plan.js');
  const there = [
    'updates/latest.yml', 'updates/beta.yml',
    'updates/Dota-2-Mod-Manager-Setup.exe', 'updates/Dota-2-Mod-Manager-Setup-beta.exe',
  ];

  assert.deepEqual(
    staleReleaseFiles(there, new Set(['updates/beta.yml', 'updates/Dota-2-Mod-Manager-Setup-beta.exe']), true),
    [], 'a beta leaves the release and its feed alone',
  );
  assert.deepEqual(
    staleReleaseFiles([...there, 'updates/Dota-2-Mod-Manager-Portable-beta.exe'], new Set(['updates/beta.yml']), true),
    ['updates/Dota-2-Mod-Manager-Setup-beta.exe', 'updates/Dota-2-Mod-Manager-Portable-beta.exe'],
    'and clears what the previous beta left',
  );
  assert.deepEqual(
    staleReleaseFiles(there, new Set(['updates/latest.yml', 'updates/beta.yml', 'updates/Dota-2-Mod-Manager-Setup.exe']), false),
    ['updates/Dota-2-Mod-Manager-Setup-beta.exe'],
    'a release frees the beta binaries, which is where the bucket gets its space back',
  );
});

test('a full bucket still takes a new version of what it holds, at the cost of the difference', () => {
  assert.equal(fits({ used: 100, budget: 90, already: 30, size: 20 }), true, 'smaller than the copy it replaces');
  assert.equal(fits({ used: 100, budget: 90, size: 1 }), false, 'a new object does not fit');
  assert.equal(fits({ used: 80, budget: 90, already: 10, size: 20 }), true, 'exactly at the budget');
  assert.equal(fits({ used: 80, budget: 90, already: 10, size: 21 }), false);
});

test("the mirror's Tauri feed names the mirror's files, a beta's its -beta copies", () => {
  /* tauri-plugin-updater fetches each platform's url as written. The release's feed names GitHub,
     so a copy on the mirror left as it was would send a copy that cannot reach GitHub straight
     back there. */
  const { retargetJson, MIRROR } = require('../tools/mirror-plan.js');
  const feed = JSON.stringify({
    version: '3.9.0',
    platforms: {
      'windows-x86_64': { signature: 'w', url: 'https://github.com/dota2modmanager/dota2-mod-manager/releases/download/v3.9.0/Dota-2-Mod-Manager-Setup.exe' },
      'linux-x86_64': { signature: 'l', url: 'https://github.com/dota2modmanager/dota2-mod-manager/releases/download/v3.9.0/Dota-2-Mod-Manager.AppImage' },
    },
  });
  const release = JSON.parse(retargetJson(feed, 'release'));
  assert.equal(release.platforms['windows-x86_64'].url, `${MIRROR}Dota-2-Mod-Manager-Setup.exe`);
  assert.equal(release.platforms['linux-x86_64'].signature, 'l');
  const beta = JSON.parse(retargetJson(feed, 'beta'));
  assert.equal(beta.platforms['windows-x86_64'].url, `${MIRROR}Dota-2-Mod-Manager-Setup-beta.exe`);
  assert.equal(beta.platforms['linux-x86_64'].url, `${MIRROR}Dota-2-Mod-Manager-beta.AppImage`);
});
