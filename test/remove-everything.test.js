/* Taking out everything the app put into the game (src/remove-everything.ts): the uninstaller and
 * the Settings button share it, so both leave the game the same way. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const load = () => import('../src/remove-everything.ts');

function world({ patched = true, recs } = {}) {
  const calls = [];
  const lang = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-rmall-'));
  let list = recs || [
    { id: 'a', name: 'Mod A', files: [{ dest: 'a' }], enabled: true },
    { id: 'p', name: 'Pack', kind: 'pack', files: [] },
    { id: 'off', name: 'Off', files: [{ dest: 'o' }], enabled: false },
  ];
  const deps = {
    settings: { get: (k) => ({ schemaPatch: patched, dotaGamePath: 'C:/dota' })[k] },
    library: { list: () => list, removeRecord: (id) => { calls.push(`record:${id}`); list = list.filter((r) => r.id !== id); } },
    installer: {
      langFolder: () => lang,
      removePackFully: (r) => calls.push(`pack:${r.id}`),
      remove: (files, o) => { if (o.recId === 'boom') throw new Error('locked'); calls.push(`remove:${o.recId}:${o.deployed}`); },
    },
    schemaService: { setEnabled: (on) => calls.push(`patch:${on}`) },
  };
  return { deps, calls, left: () => list };
}

test('the patch is reverted before any mod comes out, and every mod goes', async () => {
  const { removeEverything } = await load();
  const w = world();
  const r = removeEverything(w.deps, { revert: true, mods: true });
  assert.deepEqual(r, { errors: [], removed: 3 });
  assert.equal(w.calls[0], 'patch:false');
  assert.ok(w.calls.includes('pack:p'));
  assert.ok(w.calls.includes('remove:off:false'), 'a switched-off mod is taken out from where it sleeps');
  assert.deepEqual(w.left(), []);
});

test('safe mode left on: nothing to revert', async () => {
  const { removeEverything } = await load();
  const w = world({ patched: false });
  removeEverything(w.deps, { revert: true, mods: true });
  assert.ok(!w.calls.some((c) => c.startsWith('patch')));
});

test('one locked mod does not stop the others, and is named', async () => {
  const { removeEverything } = await load();
  const w = world({ recs: [{ id: 'boom', name: 'Locked', files: [] }, { id: 'b', name: 'B', files: [] }] });
  const r = removeEverything(w.deps, { revert: false, mods: true });
  assert.equal(r.removed, 1);
  assert.deepEqual(r.errors, ['Locked: locked']);
  assert.deepEqual(w.left().map((x) => x.id), ['boom']);
});

test('the app\'s own way of removing one mod is used when given', async () => {
  const { removeEverything } = await load();
  const w = world();
  const seen = [];
  removeEverything({ ...w.deps, removeOne: (rec) => seen.push(rec.id) }, { revert: false, mods: true, notice: false });
  assert.deepEqual(seen, ['a', 'p', 'off']);
  assert.ok(!w.calls.some((c) => c.startsWith('remove:')));
});
