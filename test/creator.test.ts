/* The author's drafts (src/creator.ts, issue #236): a draft keeps what the form sends, refuses a file
 * that is not what it says, names what is still missing, and comes out as one archive in the
 * catalog's shape with every file it names inside. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { createCreator } from '../src/creator.ts';
import { VPK_SIGNATURE } from '../src/vpk-read.ts';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-creator-'));
  const vpk = path.join(dir, 'glow.vpk');
  const head = Buffer.alloc(12);
  head.writeUInt32LE(VPK_SIGNATURE, 0);
  fs.writeFileSync(vpk, head);
  const png = path.join(dir, 'glow.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  const txt = path.join(dir, 'notes.txt');
  fs.writeFileSync(txt, 'not a vpk');
  return { dir, vpk, png, txt, creator: createCreator({ userDataDir: path.join(dir, 'user') }) };
}

test('a new draft keeps what the form sends, trimmed, and lists first when touched last', () => {
  const { creator } = setup();
  const a = creator.save(null, { name: '  Blue glow  ', author: 'me' });
  assert.equal(a.name, 'Blue glow');
  assert.equal(a.styles.length, 1);
  const b = creator.save(null, { name: 'Second' });
  assert.deepEqual(creator.list().map((d) => d.id), [b.id, a.id]);
  creator.save(a.id, { description: 'x'.repeat(5000) });
  const [first] = creator.list();
  assert.equal(first.id, a.id);
  assert.equal(first.description.length, 2000);
});

test('a file that is not a VPK or a picture is refused, and the draft is unchanged', () => {
  const { creator, txt } = setup();
  const d = creator.save(null, { name: 'x' });
  assert.throws(() => creator.attach(d.id, 0, 'vpk', txt));
  assert.throws(() => creator.attach(d.id, 0, 'picture', txt));
  assert.equal(creator.list()[0].styles[0].vpk, null);
});

test('an id that is not a draft id does not reach outside the drafts folder', () => {
  const { creator } = setup();
  assert.throws(() => creator.remove('../../etc'));
  assert.throws(() => creator.save('../x', {}));
});

test('what is missing is named, and the archive is refused until nothing is', () => {
  const { creator, vpk, png } = setup();
  const d = creator.save(null, {});
  assert.equal(creator.missing(d).length, 5);
  assert.throws(() => creator.bundle(d.id));
  creator.save(d.id, { name: 'Blue glow', category: 'river', author: 'me' });
  creator.attach(d.id, 0, 'vpk', vpk);
  const full = creator.attach(d.id, 0, 'picture', png);
  assert.deepEqual(creator.missing(full), []);
  // a second style asks for its own files and its own name
  const two = creator.save(d.id, { styles: [{ label: '' }, { label: '' }] });
  assert.equal(creator.missing(two).length, 4);
});

test('the archive holds mod.json in the catalog shape and every file it names', () => {
  const { creator, vpk, png } = setup();
  const d = creator.save(null, { name: 'Blue: glow', category: 'river', author: 'https://example.com/me', styles: [{ label: 'Day' }, { label: 'Night' }] });
  for (const i of [0, 1]) {
    creator.attach(d.id, i, 'vpk', vpk);
    creator.attach(d.id, i, 'picture', png);
  }
  const { name, zip } = creator.bundle(d.id);
  assert.equal(name, 'Blue_ glow.zip');
  const z = new AdmZip(zip);
  const meta = JSON.parse(z.readAsText('mod.json'));
  assert.equal(meta.category, 'river');
  assert.equal(meta.entry.name, 'Blue: glow');
  assert.deepEqual(meta.entry.styles.map((s: { label: string }) => s.label), ['Day', 'Night']);
  assert.deepEqual(meta.entry.links, [{ type: 'author', url: 'https://example.com/me' }]);
  for (const s of meta.entry.styles) {
    assert.ok(z.getEntry(`files/${s.file}`), s.file);
    assert.ok(z.getEntry(`previews/${s.preview}`), s.preview);
  }
});

test('a style dropped takes its files with it, and a deleted draft is gone from disk', () => {
  const { creator, vpk } = setup();
  const d = creator.save(null, { styles: [{ label: 'a' }, { label: 'b' }] });
  const withFile = creator.attach(d.id, 1, 'vpk', vpk);
  const file = path.join(creator.folder(d.id), withFile.styles[1].vpk!);
  assert.ok(fs.existsSync(file));
  creator.save(d.id, { styles: [{ label: 'a' }] });
  assert.ok(!fs.existsSync(file));
  creator.remove(d.id);
  assert.deepEqual(creator.list(), []);
});
