/* Switching a feature off for the releases that are broken, and nowhere else.
 *
 * The version-bounded switch is new, and the danger in adding one is not in the new code. It is
 * in the copies already on people's machines, which read only `features` and `notices` and will
 * never be updated to read anything else. A block that leaked into what they act on would switch
 * the feature off for all of them. So those copies are tested with their own code:
 * test/fixtures/remote-config-2.6.12.js is the module exactly as 2.6.12 shipped it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const current = require('../src/remote-config.js');
const shipped = require('./fixtures/remote-config-2.6.12.js');
const { verify } = require('../src/catalog-signature.ts');

const load = () => import('../tools/rollback.mjs');
const TODAY = '2026-09-16';
const EMPTY = { features: {}, notices: [] };
const at = (day) => () => Date.parse(`${day}T12:00:00Z`);

const INSTALL_270 = {
  feature: 'install',
  versions: '2.7.0',
  until: '2026-09-30',
  en: 'Installing is paused in 2.7.0. Update to 2.7.1.',
  ru: 'В 2.7.0 установка на паузе. Обнови до 2.7.1.',
};

/** One copy of the app, of one version and one module generation, reading a config it has cached. */
function copyOf(t, lib, config, version, day = TODAY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-rollback-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'remote-config.json'), JSON.stringify(config));
  return lib.createRemoteConfig({ userDataDir: dir, appVersion: () => version, now: at(day) });
}

test('a block switches a feature off for the broken versions and nowhere else', async (t) => {
  const { addBlock } = await load();
  const { config } = addBlock(EMPTY, { ...INSTALL_270, versions: '2.7.0-2.7.1' }, TODAY);

  for (const [version, off] of [['2.6.13', false], ['2.7.0', true], ['2.7.1', true], ['2.7.2', false]]) {
    assert.equal(copyOf(t, current, config, version).feature('install').off, off, `install in ${version}`);
  }
  assert.equal(copyOf(t, current, config, '2.7.0').feature('cosmetics').off, false,
    'a switch nobody named was caught up in it');
});

test('the people it stops are told why, in their language, and nobody else is', async (t) => {
  const { addBlock } = await load();
  const { config } = addBlock(EMPTY, INSTALL_270, TODAY);

  const broken = copyOf(t, current, config, '2.7.0');
  assert.deepEqual(broken.feature('install', 'ru'), { off: true, note: INSTALL_270.ru });
  assert.equal(broken.notices('en')[0].text, INSTALL_270.en);
  assert.equal(broken.notices('en')[0].level, 'warn');
  assert.deepEqual(copyOf(t, current, config, '2.7.1').notices(), [], 'the fixed release was told about the broken one');
});

test('a block holds through its last day and lets go the day after', async (t) => {
  // nobody has to remember to take it out for the switch to come back on
  const { addBlock } = await load();
  const { config } = addBlock(EMPTY, INSTALL_270, TODAY);

  assert.equal(copyOf(t, current, config, '2.7.0', '2026-09-30').feature('install').off, true);
  const after = copyOf(t, current, config, '2.7.0', '2026-10-01');
  assert.equal(after.feature('install').off, false);
  assert.deepEqual(after.notices(), []);
});

test('copies already in the field ignore a block, running their own code', async (t) => {
  /* This is the proof that adding blocks is safe at all. 2.6.12 reads features and notices and
     nothing else; a block that ended up where it looks would switch installing off for every
     one of those copies, broken release or not. */
  const { addBlock } = await load();
  const { config } = addBlock(EMPTY, INSTALL_270, TODAY);

  const old = copyOf(t, shipped, config, '2.6.12');
  assert.equal(old.feature('install').off, false, 'a copy of 2.6.12 switched installing off');
  assert.deepEqual(old.notices(), [], 'a copy of 2.6.12 was shown a notice meant for 2.7.0');
  assert.deepEqual(shipped.normalize(config).features, {}, 'the block leaked into what old copies act on');
});

test('a block aimed at versions that cannot read it is refused, with what to do instead', async () => {
  const { addBlock } = await load();
  assert.ok(current.cmpVersion(current.BLOCKS_SINCE, '2.6.12') > 0, '2.6.12 shipped without blocks');
  assert.throws(() => addBlock(EMPTY, { ...INSTALL_270, versions: '2.6.12' }, TODAY), /2\.6\.13/);
  assert.throws(() => addBlock(EMPTY, { ...INSTALL_270, versions: '2.6.0-2.7.0' }, TODAY), /everywhere/);
});

test('the fallback for old copies reaches them, and so does taking it back', async (t) => {
  const { switchOff, switchOn } = await load();
  const off = switchOff(EMPTY, { feature: 'voice', en: 'Voices are paused.', ru: 'Озвучка на паузе.' });

  assert.equal(copyOf(t, shipped, off, '2.6.12').feature('voice').off, true, '2.6.12 did not honour the switch');
  assert.equal(copyOf(t, current, off, '2.7.0').feature('voice').off, true);

  const on = switchOn(off, 'voice');
  assert.equal(copyOf(t, shipped, on, '2.6.12').feature('voice').off, false);
  assert.throws(() => switchOn(on, 'voice'), /not switched off/);
});

test('lifting a block takes its notice with it and leaves the others', async () => {
  const { addBlock, liftBlock } = await load();
  let config = addBlock(EMPTY, INSTALL_270, TODAY).config;
  const { config: both, id } = addBlock(config, { ...INSTALL_270, feature: 'cosmetics' }, TODAY);
  config = both;

  const lifted = liftBlock(config, id);
  assert.deepEqual(lifted.blocks.map((b) => b.feature), ['install']);
  assert.deepEqual(lifted.notices.map((n) => n.id), [lifted.blocks[0].id]);
  assert.throws(() => liftBlock(lifted, id), /nothing has the id/);
});

test('pruning takes out only what is past its day', async () => {
  const { addBlock, pruneExpired } = await load();
  let config = addBlock(EMPTY, { ...INSTALL_270, until: '2026-09-20' }, TODAY).config;
  config = addBlock(config, { ...INSTALL_270, feature: 'cosmetics', until: '2026-10-20' }, TODAY).config;

  const { config: pruned, gone } = pruneExpired(config, '2026-09-25');
  assert.deepEqual(pruned.blocks.map((b) => b.feature), ['cosmetics']);
  assert.equal(pruned.notices.length, 1);
  assert.equal(gone.length, 1);
});

test('nonsense is refused before anything is written', async () => {
  const { addBlock } = await load();
  for (const [bad, why] of [
    [{ feature: 'selfDestruct' }, /not a switch/],
    [{ ru: '  ' }, /--en and --ru/],
    [{ until: 'next week' }, /--until must be a day/],
    [{ until: '2026-09-01' }, /already past/],
    [{ versions: '2.7.1-2.7.0' }, /comes after/],
    [{ versions: 'latest' }, /--versions must look like/],
    [{ url: 'http://example.com' }, /https/],
  ]) {
    assert.throws(() => addBlock(EMPTY, { ...INSTALL_270, ...bad }, TODAY), why, JSON.stringify(bad));
  }
});

test('a block with a damaged last day is dropped, not held forever', () => {
  /* The module fails open. A notice with a typo in its day shows with no end, which is harmless;
     a switch with one would be an outage nobody can end from the user's side. */
  const out = current.normalize({
    blocks: [
      { id: 'a', feature: 'install', minVersion: '2.7.0', until: 'soon' },
      { id: 'b', feature: 'install', minVersion: '2.7.0' },
      { id: 'c', feature: 'selfDestruct', until: '2026-09-30' },
    ],
  });
  assert.deepEqual(out.blocks, []);
});

test('the file is written with LF only, because the signature is over the bytes git publishes', async () => {
  const { addBlock, serialize } = await load();
  const text = serialize(addBlock(EMPTY, INSTALL_270, TODAY).config);
  assert.ok(!text.includes('\r'));
  assert.ok(text.endsWith('\n'));
});

test('a key the app does not pin is refused, because every copy would ignore what it signed', async () => {
  const { signFor, serialize } = await load();
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pinned = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const bytes = Buffer.from(serialize(EMPTY));

  const sig = signFor(bytes, pem, pinned);
  assert.ok(verify(bytes, sig, pinned), 'a signature from the pinned key does not verify');
  assert.throws(() => signFor(bytes, pem), /not the one the app pins/);
});

test('the list says what the file is doing today', async () => {
  const { addBlock, switchOff, describe } = await load();
  assert.deepEqual(describe(EMPTY, TODAY), ['nothing is switched off and nobody is told anything']);

  let config = addBlock(EMPTY, { ...INSTALL_270, until: '2026-09-20' }, TODAY).config;
  config = switchOff(config, { feature: 'voice', en: 'Voices are paused.', ru: 'x' });
  const lines = describe(config, '2026-09-25');
  assert.ok(lines.some((l) => l.startsWith('OFF EVERYWHERE') && l.includes('voice')));
  assert.ok(lines.some((l) => l.startsWith('expired') && l.includes('install in 2.7.0')));
});

/* ---------- who is offered the beta ---------- */

const TESTER = '123456789012345678';

test('an account goes on the list as a hash, and never as itself', async () => {
  /* The file is published in a public repository. A list of a dozen people's Discord accounts is
     not ours to publish, and an id is the thing somebody else can act on. */
  const { invite, serialize } = await load();
  const { config, already } = invite(EMPTY, TESTER);

  assert.equal(already, false);
  assert.equal(config.beta.ids.length, 1);
  assert.match(config.beta.ids[0], /^[0-9a-f]{64}$/);
  assert.ok(config.beta.salt.length >= 16, 'a salt is made the first time and written with the list');
  assert.equal(serialize(config).includes(TESTER), false, 'the id itself is nowhere in the bytes');
});

test('the salt is made once: a second invitation does not throw the first one off the list', async () => {
  const { invite } = await load();
  const one = invite(EMPTY, TESTER).config;
  const two = invite(one, '234567890123456789').config;

  assert.equal(two.beta.salt, one.beta.salt, 'a new salt would silently invalidate every line above it');
  assert.equal(two.beta.ids.length, 2);
  assert.equal(two.beta.ids[0], one.beta.ids[0]);

  const again = invite(two, TESTER);
  assert.equal(again.already, true);
  assert.equal(again.config.beta.ids.length, 2, 'the same account twice is one line');
});

test('what the tool writes is what the app lets in', async () => {
  // the whole point of the file: hashed here, hashed the same way in src/beta.ts
  const { invite, serialize } = await load();
  const { isTester } = require('../src/beta.ts');
  const written = JSON.parse(serialize(invite(EMPTY, TESTER).config));
  const read = current.normalize(written).beta;

  assert.equal(isTester(TESTER, read), true);
  assert.equal(isTester('234567890123456789', read), false, 'and nobody else');
});

test('a typo is refused rather than written as somebody who will never match', async () => {
  const { invite } = await load();
  for (const bad of ['fleece', '12345', '', '1234567890123456789012345', `${TESTER} `]) {
    if (bad === `${TESTER} `) continue; // surrounding space is trimmed, not a typo
    assert.throws(() => invite(EMPTY, bad), /Discord account id/, `"${bad}" should be refused`);
  }
  assert.equal(invite(EMPTY, ` ${TESTER} `).config.beta.ids.length, 1, 'a stray space is not a typo');
});

test('the tool stops where the app stops reading', async () => {
  /* src/remote-config.js keeps the first MAX_TESTERS and drops the rest without a word, so a list
     past that point would leave somebody on it who is never offered anything. */
  const { invite } = await load();
  let config = EMPTY;
  for (let i = 0; i < current.MAX_TESTERS; i++) config = invite(config, String(100000000000000000n + BigInt(i))).config;

  assert.equal(config.beta.ids.length, current.MAX_TESTERS);
  assert.throws(() => invite(config, '999999999999999999'), /take somebody off/);
});

test('taking somebody off needs their id, and an empty list leaves no block behind', async () => {
  const { invite, uninvite, describe } = await load();
  let config = invite(EMPTY, TESTER).config;
  config = invite(config, '234567890123456789').config;

  const gone = uninvite(config, TESTER);
  assert.equal(gone.found, true);
  assert.equal(gone.config.beta.ids.length, 1);
  assert.deepEqual(describe(gone.config, TODAY), ['beta            1 account(s) offered the unreleased build']);

  const none = uninvite(gone.config, '234567890123456789');
  assert.equal('beta' in none.config, false, 'no list and an empty one mean the same thing to the app');
  assert.equal(uninvite(config, '345678901234567890').found, false, 'somebody who was never on it is not an error');
  assert.throws(() => uninvite(EMPTY, TESTER), /nobody is on the list/);
});

/* ---------- where else the archives can be fetched from ---------- */

const GITLAB = 'https://gitlab.com/rotten/mirror/-/raw/main/assets/files/';

test('a mirror the app would ignore is refused rather than written', async () => {
  /* The rules belong to the app, so the tool asks it rather than keeping a second copy of them
     that can drift: anything normalize() drops is refused here. */
  const { addMirror } = await load();
  const { config, id } = addMirror(EMPTY, GITLAB);

  assert.equal(id, 'gitlab.com', 'with no id of its own it is known by its host');
  assert.deepEqual(config.mirrors, [{ id: 'gitlab.com', base: GITLAB }]);
  assert.deepEqual(current.normalize(config).mirrors, [{ id: 'gitlab.com', base: GITLAB, host: 'gitlab.com' }]);

  for (const bad of ['http://plain.example/files/', 'https://no-slash.example/files', GITLAB]) {
    assert.throws(() => addMirror(config, bad), /would not take/, `"${bad}" should be refused`);
  }
  assert.throws(() => addMirror(config, 'https://raw.githubusercontent.com/h6rd/x/main/assets/files/'),
    /would not take/, 'nothing may claim to be the host the catalog is published from');
});

test('the tool stops where the app stops reading mirrors', async () => {
  const { addMirror } = await load();
  let config = EMPTY;
  for (let i = 0; i < 4; i++) config = addMirror(config, `https://m${i}.example/files/`).config;

  assert.equal(config.mirrors.length, 4);
  assert.throws(() => addMirror(config, 'https://one-more.example/files/'), /take one out first/);
});

test('a mirror comes out by its id or by its host, and the last one leaves no key behind', async () => {
  const { addMirror, dropMirror, describe } = await load();
  let config = addMirror(EMPTY, GITLAB, { id: 'rotten' }).config;
  config = addMirror(config, 'https://other.example/files/').config;

  assert.deepEqual(describe(config, TODAY), [
    'mirror          rotten: https://gitlab.com/rotten/mirror/-/raw/main/assets/files/',
    'mirror          other.example: https://other.example/files/',
  ]);

  const byId = dropMirror(config, 'rotten');
  assert.deepEqual(byId.mirrors.map((m) => m.id), ['other.example']);
  assert.equal('mirrors' in dropMirror(byId, 'other.example'), false);
  assert.deepEqual(dropMirror(config, 'gitlab.com').mirrors.map((m) => m.id), ['other.example'],
    'the host works as well as the id, because the host is what somebody reads off the list');
  assert.throws(() => dropMirror(EMPTY, 'rotten'), /no mirror here/);
});

