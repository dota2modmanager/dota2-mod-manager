/* What a hostile .d2mm can and cannot get through (src/preset-share.ts).
 *
 * A preset file arrives from a stranger over Discord. The reader already refused a zip that is not
 * a preset and an archive past the size limits (test/preset-share.test.ts); what had no test was
 * the manifest itself: a line pointing out of the archive, a pack inside a pack, a kind nobody
 * knows, strings of any length, a manifest past a megabyte, one reaching for the prototype, and a
 * mod the manifest promises but the archive does not carry. Branch coverage of the module was 56%.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';

import * as share from '../src/preset-share.ts';
import { t as say } from '../src/i18n.ts';

function tempFile(t: TestContext, name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-hostile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, name);
}

const manifestWith = (mods: unknown, extra: Record<string, unknown> = {}) => ({ format: share.FORMAT, version: 1, mods, ...extra });

/** A .d2mm made by hand, the way somebody who wants to break the reader would make one. */
function handMade(t: TestContext, files: Record<string, string | Buffer>) {
  const out = tempFile(t, 'hand.d2mm');
  const zip = new AdmZip();
  for (const [name, body] of Object.entries(files)) zip.addFile(name, Buffer.isBuffer(body) ? body : Buffer.from(body));
  zip.writeZip(out);
  return out;
}

test('a manifest that is not one, or is from a newer app, or lists too much, is refused whole', () => {
  assert.throws(() => share.validateManifest(null), { message: say('preset.json повреждён') });
  assert.throws(() => share.validateManifest('a string'), { message: say('preset.json повреждён') });
  assert.throws(() => share.validateManifest({ ...manifestWith([]), format: 'somebody-else/preset' }), { message: say('Это не файл пресета Mod Manager') });
  assert.throws(() => share.validateManifest(manifestWith([], { version: 2 })), { message: say('Файл собран более новой версией приложения') });
  assert.throws(() => share.validateManifest(manifestWith([], { version: undefined })), { message: say('Файл собран более новой версией приложения') }, 'no version is not version zero');
  assert.throws(() => share.validateManifest(manifestWith({})), { message: say('preset.json повреждён') });
  const many = Array.from({ length: share.MAX_MODS + 1 }, (_, i) => ({ kind: 'catalog', categoryId: 'heroes', name: `m${i}` }));
  assert.throws(() => share.validateManifest(manifestWith(many)), { message: say('Слишком много модов в пресете') });
  assert.equal(share.validateManifest(manifestWith(many.slice(0, share.MAX_MODS))).mods.length, share.MAX_MODS);
});

test('an embedded file is only ever a name under mods/, never a path out of the archive', () => {
  const embedded = (file: string) => ({ kind: 'embedded', name: 'x', file });
  const kept = share.validateManifest(manifestWith([
    embedded('mods/000.vpk'), embedded('../../evil.vpk'), embedded('mods/../preset.json'), embedded('mods/a/b.vpk'),
    embedded('mods\\000.vpk'), embedded('/etc/passwd'), embedded('C:/Windows/x.vpk'), embedded('mods/000.exe'),
    embedded(`mods/${'a'.repeat(65)}.vpk`), embedded(''),
  ])).mods;
  assert.deepEqual(kept.map((m) => m.kind === 'embedded' && m.file), ['mods/000.vpk']);
});

test('a line missing what its kind needs, or of a kind nobody knows, is dropped and the rest stay', () => {
  const kept = share.validateManifest(manifestWith([
    { kind: 'catalog', categoryId: 'heroes', name: 'Kept' },
    { kind: 'catalog', name: 'No category' },
    { kind: 'catalog', categoryId: 'heroes' },
    { kind: 'cosmetic', name: 'No item', slot: 'weapon' },
    { kind: 'cosmetic', name: 'No slot', itemId: '42' },
    { kind: 'script', name: 'Run me', command: 'rm -rf /' },
    'a bare string', 42, null,
    { kind: 'missing', name: 'Left out by the sender', reason: 'too big' },
  ])).mods;
  assert.deepEqual(kept.map((m) => m.name), ['Kept', 'Left out by the sender']);
});

test('a pack holds mods, never another pack, and a bad member costs only itself', () => {
  const [pack] = share.validateManifest(manifestWith([{
    kind: 'pack', name: 'Pack',
    members: [
      { kind: 'catalog', categoryId: 'heroes', name: 'Member' },
      { kind: 'pack', name: 'Nested', members: [{ kind: 'catalog', categoryId: 'heroes', name: 'Deep' }] },
      { kind: 'embedded', name: 'Escapes', file: '../x.vpk' },
    ],
  }])).mods;
  assert.equal(pack.kind, 'pack');
  assert.deepEqual(pack.kind === 'pack' && pack.members.map((m) => m.name), ['Member']);
  const [empty] = share.validateManifest(manifestWith([{ kind: 'pack', name: 'No members', members: 'not a list' }])).mods;
  assert.deepEqual(empty, { kind: 'pack', name: 'No members', members: [] });
});

test('every string is cut to its length, and a number that is not one is read as nothing', () => {
  const m = share.validateManifest(manifestWith(
    [{ kind: 'embedded', name: 'n'.repeat(1000), file: 'mods/000.vpk', size: 'huge', fp: 'f'.repeat(500) }],
    { name: 'p'.repeat(1000), note: 'o'.repeat(5000), author: 'a plain string', createdAt: 'yesterday', catalogFetchedAt: Infinity, app: 'x'.repeat(100) },
  ));
  assert.equal(m.name.length, 120);
  assert.equal(m.note.length, 600);
  assert.equal(m.author, '', 'an author is an object with a name');
  assert.equal(m.createdAt, null);
  assert.equal(m.catalogFetchedAt, null);
  assert.equal(m.app.length, 20);
  const [e] = m.mods;
  assert.equal(e.name.length, 300);
  assert.equal(e.kind === 'embedded' && e.size, 0);
  assert.equal(e.kind === 'embedded' && e.fp?.length, 64);
  assert.equal(share.validateManifest(manifestWith([], { name: '' })).name, say('Пресет'), 'a nameless preset gets one');
});

test('a manifest that reaches for the prototype puts nothing on it', () => {
  const raw = JSON.parse(`{"format":"${share.FORMAT}","version":1,"__proto__":{"polluted":true},
    "mods":[{"kind":"catalog","categoryId":"heroes","name":"x","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}]}`);
  const m = share.validateManifest(raw);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(Object.keys(m.mods[0]).sort(), ['categoryId', 'fp', 'kind', 'name', 'styleLabel']);
});

test('a file that is not a zip, a manifest that is not JSON, or one past a megabyte, is refused', (t) => {
  const notZip = tempFile(t, 'notzip.d2mm');
  fs.writeFileSync(notZip, 'MZ this is a program, not a preset');
  // the archive door turns it down first, naming the file and the reason
  assert.throws(() => share.readPresetFile(notZip), (err: Error & { safeZip?: boolean }) => err.safeZip === true && err.message.includes('notzip.d2mm'));
  assert.throws(() => share.readPresetFile(handMade(t, { 'preset.json': '{ not json' })), { message: say('preset.json повреждён') });
  // past a megabyte, in bytes that do not compress, so the size check is what turns it down and not
  // the archive door's ratio check (a megabyte of spaces never gets that far)
  const padded = JSON.stringify({ ...manifestWith([]), note: crypto.randomBytes(800 * 1024).toString('base64') });
  assert.ok(padded.length > 1 << 20);
  assert.throws(() => share.readPresetFile(handMade(t, { 'preset.json': padded })), { message: say('preset.json повреждён') });
  // and a megabyte of padding is turned down too, by the ratio check, with its own reason
  const spaces = JSON.stringify({ ...manifestWith([]), note: ' '.repeat(1 << 20) });
  assert.throws(() => share.readPresetFile(handMade(t, { 'preset.json': spaces })), (err: Error & { safeZip?: boolean }) => err.safeZip === true);
});

test('a mod the manifest promises but the archive lacks becomes a missing line, in a pack too, and nothing else is read', (t) => {
  const out = handMade(t, {
    'preset.json': JSON.stringify(manifestWith([
      { kind: 'embedded', name: 'Present', file: 'mods/000.vpk' },
      { kind: 'embedded', name: 'Absent', file: 'mods/001.vpk' },
      { kind: 'pack', name: 'Pack', members: [{ kind: 'embedded', name: 'Absent member', file: 'mods/002.vpk' }] },
    ])),
    'mods/000.vpk': 'bytes',
    'secret.txt': 'never asked for',
  });
  const { manifest, readMod } = share.readPresetFile(out);
  assert.deepEqual(manifest.mods.map((m) => m.kind), ['embedded', 'missing', 'pack']);
  const pack = manifest.mods[2];
  assert.deepEqual(pack.kind === 'pack' && pack.members.map((m) => m.kind), ['missing']);
  assert.equal(readMod('mods/000.vpk').toString(), 'bytes');
  assert.throws(() => readMod('secret.txt'), { message: say('Недопустимое имя файла в архиве') });
  assert.throws(() => readMod('../secret.txt'), { message: say('Недопустимое имя файла в архиве') });
  assert.throws(() => readMod('mods/001.vpk'), { message: say('файла нет в архиве') });
});
