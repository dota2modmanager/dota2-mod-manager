/* The mutation harness in tools/mutate.mjs, and the mutants it is pointed at.
 *
 * A green suite says the tests ran, not that they would catch anything. The test asserting that a
 * rebuilt pack keeps its slot was green against code that allocated a new slot every time, and
 * only a deliberate breakage told them apart.
 *
 * Running the mutants takes a suite run each, so that is a command somebody runs (`npm run mutate`).
 * What runs on every push is the half that rots: whether each mutant still applies to the source it
 * names. Two of the first seven silently did not apply, which is the failure worth catching here -
 * a check that has stopped checking looks exactly like a check that passes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const load = () => import('../tools/mutate.mjs');

const SRC = [
  'class Installer {',
  '  install(rec) {',
  '    const name = this.allocatePak(this.usedPakNames(), false);',
  '    return name;',
  '  }',
  '',
  '  deployMemberAsMod(pack, member) {',
  '    const pakName = this.allocatePak(this.usedPakNames(), false);',
  '    return { files: [pakName] };',
  '  }',
  '}',
].join('\n');

test('a mutation lands after its anchor, not at the first match in the file', async () => {
  /* The line this mutant is about appears twice, in two features. Mutating the first one tests
     something else entirely while reporting on this. */
  const { apply } = await load();
  const { out } = apply(SRC, {
    anchor: 'deployMemberAsMod(pack, member) {',
    from: 'this.allocatePak(this.usedPakNames(), false)',
    to: 'BROKEN',
  });
  assert.match(out, /install\(rec\) \{\n {4}const name = this\.allocatePak/, 'the other feature was mutated');
  assert.match(out, /const pakName = BROKEN;/);
});

test('a mutant whose anchor is gone reports instead of passing quietly', async () => {
  // renaming a method must break the check loudly, not turn it into a no-op
  const { apply } = await load();
  const { err, out } = apply(SRC, { anchor: 'deployPackMember(pack) {', from: 'x', to: 'y' });
  assert.equal(out, undefined);
  assert.match(err, /anchor is gone/);
});

test('an anchor that matches twice is refused, because either match could be the wrong one', async () => {
  const { apply } = await load();
  const twice = `${SRC}\n${SRC}`;
  const { err } = apply(twice, {
    anchor: 'deployMemberAsMod(pack, member) {',
    from: 'this.allocatePak(this.usedPakNames(), false)',
    to: 'BROKEN',
  });
  assert.match(err, /not unique/);
});

test('a mutant whose text moved away reports too', async () => {
  const { apply } = await load();
  const { err } = apply(SRC, {
    anchor: 'deployMemberAsMod(pack, member) {',
    from: 'this.allocatePak(this.freeSlots(), false)',
    to: 'BROKEN',
  });
  assert.match(err, /text is gone/);
});

test('the whole-line form replaces that line and leaves the rest alone', async () => {
  const { apply } = await load();
  const { out } = apply(SRC, {
    anchor: 'deployMemberAsMod(pack, member) {',
    lineStartsWith: '    const pakName = ',
    to: '    const pakName = null;',
  });
  assert.match(out, /const pakName = null;\n {4}return \{ files: \[pakName\] \};/);
  assert.equal(out.split('\n').length, SRC.split('\n').length, 'the file gained or lost a line');
});

test('a mutant that got past the tests fails the run, and so does one that never ran', async () => {
  /* Both mean the same thing from where the user stands: a promise nobody is holding. Reporting
     only the survivors would have called the first run of this a pass with two checks dead. */
  const { verdict } = await load();
  assert.equal(verdict([{ name: 'a', outcome: 'caught' }]).ok, true);
  assert.deepEqual(
    verdict([
      { name: 'a', outcome: 'caught' },
      { name: 'b', outcome: 'survived' },
      { name: 'c', outcome: 'not-applied' },
      { name: 'd', outcome: 'invalid' },
    ]).escaped.map((e) => e.name),
    ['b', 'c', 'd'],
  );
});

test('a restore is not believed until the file has been read back', async () => {
  /* On 2026-09-16 a run reported every mutant caught and left one of them in src/installer.js.
     The write that should have put the file back did not take, and each later mutant on that
     file read the broken copy as its own original and put THAT back. Nothing said a word. A
     write that does not take has to be a failure this can see. */
  const { restoreFile } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-restore-'));
  const file = path.join(dir, 'x.js');
  try {
    fs.writeFileSync(file, 'the mutant');
    assert.equal(restoreFile(file, 'the original'), true);
    assert.equal(fs.readFileSync(file, 'utf8'), 'the original');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // a write that silently does nothing is the case that actually happened
  const noop = { writeFileSync: () => {}, readFileSync: () => 'the mutant' };
  assert.equal(restoreFile('anywhere', 'the original', noop), false);

  // one that throws once and works the second time is worth another go, not a failed run
  let tries = 0;
  let held = 'the mutant';
  const flaky = {
    writeFileSync: (_, body) => { tries += 1; if (tries === 1) throw new Error('EBUSY'); held = body; },
    readFileSync: () => held,
  };
  assert.equal(restoreFile('anywhere', 'the original', flaky), true);
  assert.equal(tries, 2);
});

test('every mutant still applies to the code it names', async () => {
  /* The standing guard. A mutation run takes a suite run per mutant, so it is a command somebody
     runs; this is the part that must not rot between those runs. */
  const { apply, readMutants } = await load();
  const broken = [];
  for (const m of readMutants()) {
    const file = path.join(ROOT, m.file);
    if (!fs.existsSync(file)) { broken.push(`${m.name}: ${m.file} is not in the repository`); continue; }
    if (!fs.existsSync(path.join(ROOT, m.test))) { broken.push(`${m.name}: ${m.test} is not in the repository`); continue; }
    const { err, out } = apply(fs.readFileSync(file, 'utf8'), m);
    if (err) broken.push(`${m.name}: ${err}`);
    else if (out === fs.readFileSync(file, 'utf8')) broken.push(`${m.name}: changes nothing`);
  }
  assert.deepEqual(broken, [], broken.join('; '));
});

test('the committed mutants are whole, and each names a test to judge them', async () => {
  const { readMutants, CONFIG } = await load();
  const mutants = readMutants();
  assert.ok(mutants.length >= 7, 'the config lost mutants');
  assert.equal(new Set(mutants.map((m) => m.name)).size, mutants.length, 'two mutants share a name');
  assert.match(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).measured, /^\d{4}-\d{2}-\d{2}$/);
});
