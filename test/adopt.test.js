/* What a VPK goes through before it counts as a mod.
 *
 * This is the difference between a library row saying "pak42" and one saying "Pudge Hook", and
 * between a Skinchanger pack sitting as four heroes in one archive and four mods a user can
 * switch on separately. Every route in comes through here: the import button, drag and drop,
 * and the mods inside a shared preset - that last one used to land as a bare record, which is
 * why a received build showed up unnamed while the same file dragged in came out clean.
 *
 * The library is the real one in a temp folder. The installer and the schema service are fakes
 * that record what they were asked, because the question here is what gets decided about a
 * record, not whether a VPK parses: that is tested in test/vpk.test.js and test/import.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Library } = require('../src/library.ts');
const { createAdopt } = require('../src/adopt.js');

const LANG = (slot) => [{ root: 'lang', relPath: `${slot}_dir.vpk` }];

/**
 * A real library, fake services, and the adoption over both.
 * @param {object} how  what the fakes should answer
 */
function stand(t, how = {}) {
  const {
    contentName = null, subjects = 0, harvest = null, splitInto = null,
    masterOff = false, analyzeThrows = false,
  } = how;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-adopt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  const log = [];

  const installer = {
    displayNameForFile: (relPath) => { log.push(`name ${relPath}`); return contentName; },
    analyzeRecord: () => {
      if (analyzeThrows) throw new Error('not a vpk this machine can read');
      return { subjects };
    },
    masterIsOff: () => masterOff,
    setMasterEnabled: (on) => log.push(`master ${on}`),
  };
  const schemaService = {
    harvest: () => { log.push('harvest'); return harvest; },
    split: () => { log.push('split'); return splitInto; },
    refresh: () => log.push('refresh'),
  };

  return { ...createAdopt({ installer, library, schemaService }), library, log };
}

test('a slot name is replaced by what the file turns out to hold', (t) => {
  // "pak42" is where the file sits, not what is in it, and it is what the user would have seen
  const { adoptImportedFiles } = stand(t, { contentName: 'Pudge Hook' });

  const { records } = adoptImportedFiles({ files: LANG('pak42'), name: 'pak42' });

  assert.equal(records[0].name, 'Pudge Hook');
  assert.equal(records[0].categoryId, 'imported');
});

test('a name somebody meant is kept, even when the content has one of its own', (t) => {
  const { adoptImportedFiles } = stand(t, { contentName: 'Pudge Hook' });

  const { records } = adoptImportedFiles({ files: LANG('pak10'), name: 'My Cool Skin' });

  assert.equal(records[0].name, 'My Cool Skin');
});

test('a catalog identity beats both', (t) => {
  /* A mod that arrived inside a preset already knows what it is. Renaming it from its own
     bytes would lose the sender's category and its picture. */
  const { adoptImportedFiles } = stand(t, { contentName: 'Pudge Hook' });
  const identity = { name: 'Dragonclaw Hook', categoryId: 'weapons', styleLabel: 'Gold', preview: 'p.webp' };

  const { records } = adoptImportedFiles({ files: LANG('pak10'), name: 'pak10', identity });

  assert.equal(records[0].name, 'Dragonclaw Hook');
  assert.equal(records[0].categoryId, 'weapons');
  assert.equal(records[0].styleLabel, 'Gold');
});

test('a file nothing can name is still taken in, with a name of some kind', (t) => {
  const { adoptImportedFiles } = stand(t, { contentName: null });

  const { records } = adoptImportedFiles({ files: LANG('pak10'), name: null });

  assert.ok(records[0].name && records[0].name.length, 'the record went in without a name');
});

test('a pack of a few heroes becomes one mod per hero', (t) => {
  /* Skinchanger exports hold several heroes in one archive. As one mod they can only be turned
     on together, which is not what anybody wants from a four-hero pack. */
  const splitInto = [
    { name: 'Juggernaut', files: LANG('pak11'), schema: [1] },
    { name: 'Pudge', files: LANG('pak12') },
  ];
  const { adoptImportedFiles, log } = stand(t, { subjects: 3, splitInto });

  const out = adoptImportedFiles({ files: LANG('pak10'), name: 'pack' });

  assert.equal(out.split, true);
  assert.deepEqual(out.records.map((r) => r.name), ['Juggernaut', 'Pudge']);
  assert.equal(out.schema, true, 'a part that carries item blocks did not ask for a rebuild');
  assert.ok(log.includes('split'));
});

test('a big collection is left as one mod for the user to split by hand', (t) => {
  /* A dozen heroes would eat a dozen of the ninety-nine pak slots, so the automatic split stops
     where the cost starts. The button is still there. */
  const { adoptImportedFiles, log } = stand(t, { subjects: 12, splitInto: [{ name: 'A', files: LANG('pak11') }] });

  const out = adoptImportedFiles({ files: LANG('pak10'), name: 'collection' });

  assert.equal(out.split, false);
  assert.equal(log.includes('split'), false, 'a twelve-hero pack was split anyway');
  assert.equal(out.records.length, 1);
});

test('a pack that cannot be read stays one mod instead of failing the import', (t) => {
  const { adoptImportedFiles } = stand(t, { analyzeThrows: true });

  const out = adoptImportedFiles({ files: LANG('pak10'), name: 'odd' });

  assert.equal(out.split, false);
  assert.equal(out.records.length, 1);
});

test('the item blocks a mod changed are lifted on the way in', (t) => {
  const { adoptImportedFiles, log } = stand(t, { harvest: { deltas: [{ id: 1 }] } });

  const out = adoptImportedFiles({ files: LANG('pak10'), name: 'skin' });

  assert.equal(out.schema, true);
  assert.ok(log.includes('harvest'));
});

test('a batch registers what landed and hands back what did not', (t) => {
  const { registerImportResults } = stand(t, { contentName: 'Pudge Hook' });

  return registerImportResults([
    { source: 'broken.vpk', error: 'not a .vpk file' },
    { source: 'hook_dir.vpk', name: 'pak10', files: LANG('pak10'), merged: 2 },
  ]).then((out) => {
    assert.deepEqual(out.imported.map((i) => i.name), ['Pudge Hook']);
    assert.equal(out.imported[0].merged, 2, 'a folded multi-volume set stopped saying so');
    assert.deepEqual(out.errors.map((e) => e.source), ['broken.vpk']);
  });
});

test('the bar counts the mods it has to read, not the ones that failed', async (t) => {
  /* The count is what the user watches during a long import. Counting the failures in would
     leave the bar short of its own total and looking stuck. */
  const { registerImportResults } = stand(t);
  const steps = [];

  await registerImportResults([
    { source: 'a.vpk', error: 'no' },
    { source: 'b.vpk', name: 'b', files: LANG('pak10') },
    { source: 'c.vpk', name: 'c', files: LANG('pak11') },
  ], (done, total) => steps.push(`${done}/${total}`));

  assert.deepEqual(steps, ['1/2', '2/2']);
});

test('the item table is rebuilt once for a batch, not once per mod', async (t) => {
  const { registerImportResults, log } = stand(t, { harvest: { deltas: [{ id: 1 }] } });

  await registerImportResults([
    { source: 'a.vpk', name: 'a', files: LANG('pak10') },
    { source: 'b.vpk', name: 'b', files: LANG('pak11') },
  ]);

  assert.equal(log.filter((l) => l === 'refresh').length, 1);
});

test('mods that land while the master switch is off go off with everything else', async (t) => {
  /* Otherwise an import while "mods off" is on writes live files into the folder and the game
     picks them up, which is the one state the switch promises cannot happen. */
  const { registerImportResults, log } = stand(t, { masterOff: true });

  await registerImportResults([{ source: 'a.vpk', name: 'a', files: LANG('pak10') }]);

  assert.ok(log.includes('master false'), 'a mod landed live while mods were switched off');
});

test('a batch where nothing landed leaves the master switch alone', async (t) => {
  const { registerImportResults, log } = stand(t, { masterOff: true });

  await registerImportResults([{ source: 'a.vpk', error: 'not a .vpk file' }]);

  assert.equal(log.some((l) => l.startsWith('master')), false);
});
