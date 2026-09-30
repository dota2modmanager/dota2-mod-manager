// Every zip the app opens was written by somebody else: the catalog's CDN, a stranger's
// .d2mm on Discord, whatever the user dropped on the window. An archive describes itself,
// so these tests pin what happens when it lies (a few KB claiming to unpack to 4 GB, the
// GHSA-xcpc-8h2w-3j85 shape), when it tells the truth but the truth is a bomb, and when it
// names a file so that writing it would land outside the folder we meant.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Thrown } from './helpers/thrown.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';

import { openZip, safeJoin, isUnsafeName } from '../src/safe-zip.ts';
import { FileTx } from '../src/file-tx.ts';
import rawZipJs from './fixtures/raw-zip.js';
const { rawZip } = rawZipJs;

const MB = 1024 * 1024;

function tempDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-zip-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** An ordinary archive, written the way any tool would write it. */
function makeZip(entries: [string, Buffer | string][]) {
  const zip = new AdmZip();
  for (const [name, body] of entries) zip.addFile(name, Buffer.isBuffer(body) ? body : Buffer.from(body));
  return zip.toBuffer();
}


const file = (name: string, body: string | Buffer, declaredSize?: number) => ({ name, data: Buffer.from(body), declaredSize });

test('a normal archive lists its files and hands back their bytes', () => {
  const archive = openZip(makeZip([['mod/pak01_dir.vpk', 'payload'], ['mod/readme.txt', 'hi']]));
  assert.deepEqual(archive.files.map((f) => f.path), ['mod/pak01_dir.vpk', 'mod/readme.txt']);
  assert.equal(archive.get('mod/pak01_dir.vpk')?.read().toString(), 'payload');
  assert.equal(archive.get('nothing/here.vpk'), null);
});

test('an archive that claims 4 GB in its header is refused, not allocated', () => {
  const buf = rawZip([file('pak01_dir.vpk', 'a few bytes pretending to be four gigabytes', 4_000_000_000)]);
  assert.throws(() => openZip(buf, { label: 'Nude Drow' }), (err: Thrown) => {
    assert.equal(err.safeZip, true);
    assert.match(err.message, /Nude Drow/);
    return true;
  });
});

test('a truthful archive is read even when the same file is stored uncompressed', () => {
  const archive = openZip(rawZip([file('mod/pak01_dir.vpk', 'payload')]));
  assert.equal(archive.files[0].read().toString(), 'payload');
});

test('a bomb that tells the truth is refused too', () => {
  // 4 MB of zeros deflate to a couple of KB: nothing legitimate packs that tight at that size
  const archive = () => openZip(makeZip([['bomb.bin', Buffer.alloc(4 * MB)]]));
  assert.throws(archive, (err: Thrown) => err.safeZip === true);
});

test('a file that is big but compresses like a real mod passes', () => {
  // a VPK is already-compressed game assets: it barely shrinks, the way this noise does not
  const archive = openZip(makeZip([['pak01_dir.vpk', crypto.randomBytes(2 * MB)]]));
  assert.equal(archive.files.length, 1);
  assert.equal(archive.files[0].read().length, 2 * MB);
});

test('names that would escape the folder never reach the caller', () => {
  const archive = openZip(rawZip([
    file('../evil.txt', 'no'),
    file('mod/../../evil2.txt', 'no'),
    file('/etc/passwd', 'no'),
    file('C:/Windows/System32/evil.dll', 'no'),
    file('mod\\..\\..\\evil3.dll', 'no'),
    file('mod/pak01_dir.vpk', 'yes'),
  ]));
  assert.deepEqual(archive.files.map((f) => f.path), ['mod/pak01_dir.vpk']);
});

test('unpacking writes under the target folder and nothing outside it', (t) => {
  const root = tempDir(t);
  const dest = path.join(root, 'tools', 'SomeTool');
  const written = openZip(rawZip([
    file('../escaped.exe', 'no'),
    file('bin/tool.exe', 'yes'),
    file('readme.txt', 'ok'),
  ])).extractTo(dest);

  assert.equal(written, 2);
  assert.equal(fs.readFileSync(path.join(dest, 'bin', 'tool.exe'), 'utf-8'), 'yes');
  assert.equal(fs.existsSync(path.join(root, 'tools', 'escaped.exe')), false);
  assert.equal(fs.existsSync(path.join(root, 'escaped.exe')), false);
});

test('unpacking inside a transaction can be taken back whole', (t) => {
  /* Installs and tool downloads unpack through a FileTx, so a failure halfway leaves nothing
     behind. The plain unpack above never takes that path. */
  const dest = path.join(tempDir(t), 'SomeTool');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'readme.txt'), 'old');

  const tx = new FileTx();
  const written = openZip(rawZip([file('bin/tool.exe', 'yes'), file('readme.txt', 'new')])).extractTo(dest, tx);
  assert.equal(written, 2);
  assert.equal(fs.readFileSync(path.join(dest, 'readme.txt'), 'utf-8'), 'new');

  tx.rollback();
  assert.equal(fs.readFileSync(path.join(dest, 'readme.txt'), 'utf-8'), 'old');
  assert.equal(fs.existsSync(path.join(dest, 'bin', 'tool.exe')), false);
});

test('safeJoin keeps a path inside its root and refuses one that climbs out', (t) => {
  const root = tempDir(t);
  assert.equal(safeJoin(root, 'a/b/c.vpk'), path.join(root, 'a', 'b', 'c.vpk'));
  assert.throws(() => safeJoin(root, '../outside.vpk'), (err: Thrown) => err.safeZip === true);
  assert.throws(() => safeJoin(root, 'a/../../outside.vpk'), (err: Thrown) => err.safeZip === true);
  assert.equal(isUnsafeName('a/../b'), true);
  assert.equal(isUnsafeName('a/b/c.vpk'), false);
});

test('each budget refuses on its own', (t) => {
  const three = makeZip([['a.txt', 'aaa'], ['b.txt', 'bbb'], ['c.txt', 'ccc']]);
  const refusal = (err: Thrown) => err.safeZip === true;

  assert.throws(() => openZip(three, { limits: { entries: 2 } }), refusal);
  assert.throws(() => openZip(three, { limits: { entryBytes: 2 } }), refusal);
  assert.throws(() => openZip(three, { limits: { totalBytes: 5 } }), refusal);
  assert.doesNotThrow(() => openZip(three, { limits: { entries: 3, totalBytes: 9 } }));

  // the file on disk is weighed before adm-zip reads it into memory
  const dir = tempDir(t);
  const onDisk = path.join(dir, 'big.zip');
  fs.writeFileSync(onDisk, three);
  assert.throws(() => openZip(onDisk, { limits: { archiveBytes: 10 } }), refusal);

  // bytes already in memory (a download, a dropped file) are weighed the same way
  assert.throws(() => openZip(three, { limits: { archiveBytes: 10 } }), refusal);
  assert.doesNotThrow(() => openZip(three, { limits: { archiveBytes: three.length } }));
});

test('safeJoin refuses the folder next door whose name starts the same way', (t) => {
  /* The textbook form of this bug: with "…/tools" as the root, "…/tools-evil/a.exe" passes a check
     that only asks whether the path starts with the root's text. */
  const root = path.join(tempDir(t), 'tools');
  assert.throws(() => safeJoin(root, '../tools-evil/a.exe'), (err: Thrown) => err.safeZip === true);
  assert.throws(() => safeJoin(root, '../toolsX'), (err: Thrown) => err.safeZip === true);
  assert.equal(safeJoin(root, '.'), path.resolve(root), 'the root itself is not outside the root');
});

test('names Windows itself refuses never reach the caller', () => {
  /* None of these escapes the folder: a probe on NTFS put every one of them inside it. They land as
     names Explorer cannot open or delete, and for fonts and cursors that folder is the game's. */
  const archive = openZip(rawZip([
    file('mod.../x.vpk', 'no'),
    file('mod /x.vpk', 'no'),
    file('.. /x.vpk', 'no'),
    file('fonts/CON', 'no'),
    file('fonts/nul.ttf', 'no'),
    file('COM1/x.vpk', 'no'),
    file('readme.', 'no'),
    file('./mod/ok.vpk', 'yes'),
    file('mod/pak01_dir.vpk', 'yes'),
    file('fonts/console.ttf', 'yes'),
    file(' lead/ok.txt', 'yes'),
  ]));
  assert.deepEqual(archive.files.map((f) => f.path),
    ['./mod/ok.vpk', 'mod/pak01_dir.vpk', 'fonts/console.ttf', ' lead/ok.txt']);
});

test('an archive that is not really one is refused as damaged, by its name', () => {
  assert.throws(() => openZip(Buffer.from('PK not really a zip at all'), { label: 'Broken Mod' }), (err: Thrown) => {
    assert.equal(err.safeZip, true, `came out as ${err.constructor.name}: ${err.message}`);
    assert.match(err.message, /Broken Mod/);
    return true;
  });
});

test('a file whose bytes do not match their checksum is refused when it is read', () => {
  const name = 'mod/pak01_dir.vpk';
  const buf = rawZip([{ name, data: Buffer.from('payload bytes') }]);
  buf[30 + name.length] ^= 0xff; // the first byte of the stored data, after the local header and name
  const archive = openZip(buf, { label: 'Broken Mod' });
  assert.throws(() => archive.files[0].read(), (err: Thrown) => {
    assert.equal(err.safeZip, true, `came out as ${err.constructor.name}: ${err.message}`);
    assert.match(err.message, /Broken Mod/);
    assert.match(err.message, /pak01_dir\.vpk/);
    return true;
  });
});
