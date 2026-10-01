/* Applying a preset whose mods are not all installed.
 *
 * A build remembers its mods by name, so some members can be missing: deleted since, or saved
 * on another machine. Until 2026-09-15 applying such a build switched every other mod off,
 * switched on only the members that happened to be installed, and answered "Preset applied".
 * A user reported exactly that - "I apply the preset and nothing gets installed" - while the
 * card above the button had been saying how many of its mods were not installed.
 *
 * The handler is registered for real against a stub of Electron, with the real Library in a
 * temporary folder. The installer and the catalog are fakes that record what they were asked,
 * because the question here is what the handler decides to install and in what order, not
 * whether a zip unpacks.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { Library } = require('../src/library.ts');

/** Register presets:apply with fakes around a real library; answer the handler and the log. */
function harness(t, { catalogHas = [], toggleErrors = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-preset-apply-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);

  const log = [];
  const registered = new Map();
  const load = Module._load;
  Module._load = function stubbed(request, ...rest) {
    if (request === 'electron') {
      return { ipcMain: { handle: (c, f) => registered.set(c, f) }, dialog: {}, app: {} };
    }
    return load.call(this, request, ...rest);
  };
  const file = require.resolve('../src/ipc-presets.js');
  delete require.cache[file];
  try {
    const { registerPresetsIpc } = require(file);
    registerPresetsIpc({
      win: () => null, settings: { get: () => null }, catalog: {}, library,
      installer: {
        install: async ({ categoryId, modName, fileRef }) => {
          log.push(`install ${categoryId}/${modName}`);
          return [{ root: 'lang', relPath: `${fileRef}.vpk` }];
        },
        ensureCursorStore: () => {},
      },
      schemaService: {},
      presets: {
        catalogIndex: async () => {
          log.push('catalog');
          return {
            lookup: (categoryId, name, styleLabel) => (catalogHas.includes(name)
              ? { categoryId, name, styleLabel: styleLabel || null, fileRef: `${name}.zip`, preview: null }
              : null),
          };
        },
        applyPreset: (preset) => { log.push(`apply ${preset.name}`); return toggleErrors; },
      },
      adoptImportedFiles: () => ({ records: [] }),
      afterDeployMaster: () => log.push('master'),
      disableOtherCursors: () => log.push('cursors'),
      sendProgress: () => {},
    });
  } finally {
    Module._load = load;
    delete require.cache[file];
  }

  const preset = (name, mods) => {
    const p = { id: `p-${name}`, name, mods };
    library.data.presets.push(p);
    return p;
  };
  const apply = (p) => registered.get('presets:apply')({}, p.id);
  return { library, log, preset, apply };
}

const mod = (name, categoryId = 'heroes') => ({ categoryId, name, styleLabel: null, fp: null });

test('a member the catalog still has is installed before the preset is applied', async (t) => {
  const h = harness(t, { catalogHas: ['Bare Brewmaster'] });
  const p = h.preset('build', [mod('Bare Brewmaster')]);

  const r = await h.apply(p);

  assert.equal(r.ok, true);
  assert.equal(r.installed, 1);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(h.log, ['catalog', 'install heroes/Bare Brewmaster', 'apply build', 'master'],
    'installed first, then switched, then the master switch gets its say');
  assert.ok(h.library.findByKey('heroes', 'Bare Brewmaster', null), 'and it is in the library now');
});

test('a mod of the user\'s own cannot be fetched back, and is named rather than dropped', async (t) => {
  const h = harness(t, { catalogHas: [] });
  const p = h.preset('build', [mod('my custom pak', 'imported')]);

  const r = await h.apply(p);

  assert.equal(r.ok, true);
  assert.equal(r.installed, 0);
  assert.deepEqual(r.missing, ['my custom pak']);
  assert.ok(!h.log.some((l) => l.startsWith('install')), 'nothing was asked of the installer');
});

test('a member the catalog no longer has is a warning, and the rest still applies', async (t) => {
  const h = harness(t, { catalogHas: ['Kept'] });
  const p = h.preset('build', [mod('Kept'), mod('Removed From Catalog')]);

  const r = await h.apply(p);

  assert.equal(r.ok, true, 'the preset applied without that one');
  assert.equal(r.installed, 1);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /Removed From Catalog/);
  assert.ok(h.log.includes('apply build'));
});

test('a preset with every member installed asks nothing of the catalog', async (t) => {
  const h = harness(t);
  h.library.add({ categoryId: 'heroes', name: 'Here Already', files: [] });
  const p = h.preset('build', [mod('Here Already')]);

  const r = await h.apply(p);

  assert.equal(r.ok, true);
  assert.equal(r.installed, 0);
  assert.deepEqual(h.log, ['apply build'], 'no catalog fetch, no install, no master sweep');
});

test('a mod that cannot be switched is still the preset failing', async (t) => {
  const h = harness(t, { toggleErrors: ['Some Mod: file is locked'] });
  h.library.add({ categoryId: 'heroes', name: 'Some Mod', files: [] });
  const p = h.preset('build', [mod('Some Mod')]);

  const r = await h.apply(p);

  assert.ok(r.error, 'answered as an error, as it always was');
  assert.match(r.error, /file is locked/);
});

test('an unknown preset is still refused', async (t) => {
  const h = harness(t);
  const r = await h.apply({ id: 'nope' });
  assert.ok(r.error);
});
