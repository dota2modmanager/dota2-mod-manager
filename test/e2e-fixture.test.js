/* The pieces of the end-to-end run that can be checked without starting a window.
 *
 * tools/e2e.mjs installs a fixture mod through the app. If the fixture itself were broken, the run
 * would fail for a reason that has nothing to do with the app, and a check that cries wolf gets
 * switched off. These make sure the fixture is a real mod archive, lands where the app looks, and
 * that the scripts the window runs at least compile.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const load = () => import('../tools/e2e.mjs');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

test('the fixture archive is a zip the installer opens, holding one VPK', async () => {
  const { fixtureArchive } = await load();
  const { openZip } = require('../src/safe-zip.ts');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-fixture-'));
  try {
    const file = path.join(tmp, 'mod.zip');
    fs.writeFileSync(file, fixtureArchive());
    const zip = openZip(file, { label: 'fixture' });
    const names = zip.files.map((f) => f.path);
    assert.deepEqual(names, ['pak01_dir.vpk']);
    const vpk = zip.files[0].read();
    assert.equal(vpk.readUInt32LE(0), 0x55aa1234, 'the VPK starts with its signature');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('seeding puts the catalog, its hash list and the archive where the app reads them', async () => {
  const { seedCaches, MOD } = await load();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-seed-'));
  try {
    const now = Date.parse('2026-09-15T12:00:00Z');
    const seeded = seedCaches({ userData: tmp, now });
    const cache = path.join(tmp, 'catalog-cache');
    for (const f of ['mods.json', 'constants.json', 'guides.json', 'mod-hashes.json', 'meta.json']) {
      assert.ok(fs.existsSync(path.join(cache, f)), `${f} was not written`);
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(cache, 'meta.json'), 'utf8')).fetchedAt, now, 'the cache is marked fresh, so the live catalog does not replace it');
    const archive = fs.readFileSync(path.join(tmp, 'downloads', MOD.categoryId, MOD.file));
    assert.equal(crypto.createHash('sha256').update(archive).digest('hex'), seeded.sha256);
    const hashes = JSON.parse(fs.readFileSync(path.join(cache, 'mod-hashes.json'), 'utf8'));
    assert.equal(hashes[`${MOD.categoryId}/${MOD.file}`], seeded.sha256, 'the published hash matches the cached archive');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the fixture catalog has the mod, and every category the app will draw', async () => {
  const { MOD } = await load();
  const mods = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'e2e', 'mods.json'), 'utf8'));
  const constants = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'e2e', 'constants.json'), 'utf8'));
  assert.ok(mods.modsData[MOD.categoryId].some((m) => m.name === MOD.name && m.file === MOD.file));
  const missing = constants.categories.map((c) => c.id).filter((id) => !(id in mods.modsData));
  assert.deepEqual(missing, [], `categories the app lists but the fixture lacks: ${missing.join(', ')}`);
});

test('a folder snapshot notices an added, a removed and a changed file', async () => {
  const { snapshot, difference } = await load();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-snap-'));
  try {
    fs.writeFileSync(path.join(tmp, 'pak01_dir.vpk'), 'valve');
    fs.writeFileSync(path.join(tmp, 'keep.txt'), 'same');
    const before = snapshot(tmp);
    fs.writeFileSync(path.join(tmp, 'pak01_dir.vpk'), 'modded');
    fs.writeFileSync(path.join(tmp, 'pak10_dir.vpk.off'), 'mod');
    fs.rmSync(path.join(tmp, 'keep.txt'));
    // the app's ownership note changes on every write and is checked on its own
    fs.writeFileSync(path.join(tmp, 'dota2modmanager.json'), '{"files":[]}');
    assert.deepEqual(difference(before, snapshot(tmp)), { added: ['pak10_dir.vpk.off'], removed: ['keep.txt'], changed: ['pak01_dir.vpk'] });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the app\'s own notice pak is set aside, and a pak64 that is not the app\'s is not', async () => {
  /* The sandbox seeded from a real game gets the notice pak (src/notice-text.ts), the one CI
     builds does not. Left in, it failed every disk check on a developer's machine; set aside
     without looking, it would hide somebody else's pak64 just as well. */
  const { setNoticeAside } = await load();
  const d = { added: ['pak30_dir.vpk.off', 'pak64_dir.vpk'], removed: [], changed: [] };
  assert.deepEqual(setNoticeAside(d, () => true), { added: ['pak30_dir.vpk.off'], removed: [], changed: [] });
  assert.deepEqual(setNoticeAside(d, () => false), d, 'unmarked, it stays in and the check fails on it');
  const rewritten = { added: [], removed: [], changed: ['pak64_dir.vpk'] };
  assert.deepEqual(setNoticeAside(rewritten, () => true).changed, [], 'rewritten in another language is still the notice');
});

test('the fixture archive is the same bytes every time', async () => {
  const { fixtureArchive } = await load();
  const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
  assert.equal(hash(fixtureArchive()), hash(fixtureArchive()));
});

test('the sandbox answers every question the app asks once on first run', () => {
  /* The Source 2 Viewer offer arrived after the sandbox settings were written. Nobody added its
     answer, so every sandbox launch opened with that dialog in front, and the end-to-end run
     pressed its button while meaning to confirm a removal. */
  const app = fs.readFileSync(path.join(ROOT, 'renderer', 'app.ts'), 'utf8');
  const sandbox = fs.readFileSync(path.join(ROOT, 'tools', 'sandbox.js'), 'utf8');
  const asked = [...app.matchAll(/if \(!cfg\.(\w+)\) await /g)].map((m) => m[1]);
  assert.ok(asked.length >= 2, 'renderer/app.ts no longer asks its first-run questions the way this test reads them');
  const unanswered = asked.filter((key) => !new RegExp(`\\b${key}: true\\b`).test(sandbox));
  assert.deepEqual(unanswered, [], `tools/sandbox.js does not pre-answer: ${unanswered.join(', ')}`);
});

test('the scripts the window runs compile', async () => {
  const m = await load();
  for (const name of ['EVAL_INSTALL', 'EVAL_REMOVE', 'EVAL_UNINSTALL_WINDOW', 'EVAL_NOT_THE_REMOVAL_WINDOW']) {
    assert.doesNotThrow(() => new AsyncFunction(m[name]), `${name} does not compile`);
  }
});

test('a run fails on an unresolved name, a refused call or a write out of the sandbox in the app log, and on nothing else', async () => {
  const { logProblems } = await load();
  const log = [
    '2026-10-10 boot',
    'mods:install failed: blocked is not defined',
    'ipc: refused settings:set: the window may not set dotaGamePath',
    'permission refused: media',
    'write jail: refused writeFile D:/Steam/steamapps/common/dota 2 beta/game/dota_russian/dota2modmanager.json',
    'a line about something ordinary',
  ].join('\n');
  const found = logProblems(log);
  assert.deepEqual(found.unresolved, ['mods:install failed: blocked is not defined']);
  assert.deepEqual(found.refused, ['ipc: refused settings:set: the window may not set dotaGamePath', 'permission refused: media']);
  assert.deepEqual(found.escaped, ['write jail: refused writeFile D:/Steam/steamapps/common/dota 2 beta/game/dota_russian/dota2modmanager.json']);
  assert.equal(found.jailed, false, 'a log that never says it was jailed was not');
  assert.equal(logProblems('write jail: writes held to c:\sandbox | c:\temp').jailed, true);
  assert.deepEqual(logProblems(null), { unresolved: [], refused: [], escaped: [], jailed: false });
});
