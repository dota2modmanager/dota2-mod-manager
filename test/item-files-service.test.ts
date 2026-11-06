/* The picks' pak as one record in My mods (src/item-files-service.ts), over a library and an
 * installer that only keep notes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemFilesPak, isItemFilesRecord } from '../src/item-files-service.ts';
import { entryAt } from '../src/vpk.ts';
import type { LibRecord } from '../src/types.ts';

function setup() {
  const records: LibRecord[] = [];
  const removed: unknown[] = [];
  let slot = 1;
  const library = {
    list: () => records,
    add: (r: Partial<LibRecord>) => { const rec = { id: `r${records.length}`, enabled: true, ...r } as LibRecord; records.push(rec); return rec; },
    update: (id: string, p: Partial<LibRecord>) => Object.assign(records.find((r) => r.id === id)!, p),
    removeRecord: (id: string) => { records.splice(records.findIndex((r) => r.id === id), 1); },
  };
  const installer = {
    langFolder: () => 'lang', ensureLangFolder: () => {}, usedPakNames: () => new Set<string>(),
    allocatePak: () => `pak0${++slot}_dir.vpk`, writeInto: () => {},
    remove: (files: unknown) => { removed.push(files); },
    slotBase: () => null, moveToSlot: (r: { files: LibRecord['files'] }) => r.files, setEnabled: () => {},
  };
  const pak = createItemFilesPak({ installer: installer as never, library: library as never });
  return { pak, records, removed };
}

const files = [entryAt('models/x.vmdl_c', Buffer.from('x'))];

test('the first build makes the record, and the next one keeps it', () => {
  const { pak, records, removed } = setup();
  pak.write(files, 2, []);
  assert.equal(records.length, 1);
  assert.ok(isItemFilesRecord(records[0]));
  pak.write(files, 3, [{ source: 'Axe', what: ['its size'] }]);
  assert.equal(records.length, 1);
  assert.equal(removed.length, 1, 'the old pak went');
  assert.deepEqual(pak.left(), [{ source: 'Axe', what: ['its size'] }]);
});

test('clearing takes the pak and the record, and is safe with neither', () => {
  const { pak, records, removed } = setup();
  pak.clear();
  assert.equal(removed.length, 0);
  pak.write(files, 1, []);
  pak.clear();
  assert.equal(records.length, 0);
  assert.equal(removed.length, 1);
  assert.deepEqual(pak.left(), []);
});
