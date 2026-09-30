// The portable build's own update path.
//
// A portable copy cannot install over itself, so the app downloads the new build and puts it
// beside the current one. Everything that makes that safe lives in one manifest: the name, the
// size and the hash of the exe that release actually produced. So the manifest is what these
// tests are about, and mostly about the cases where it should be refused - a manifest that is
// trusted when it should not be is a downloaded exe nobody checked.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { parseManifest, releaseUrl } from '../src/portable-update.ts';
import portableManifestJs from '../tools/portable-manifest.js';
const { build } = portableManifestJs;

function tmpDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-portable-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// What CI writes is what the app reads. If these two ever drift, the portable build stops
// updating and nobody finds out until somebody complains.
test('the manifest CI writes is the manifest the app can read', (t) => {
  const dir = tmpDir(t);
  const bytes = Buffer.from('pretend this is a 100 MB portable exe');
  fs.writeFileSync(path.join(dir, 'Dota-2-Mod-Manager-Portable.exe'), bytes);

  const { text } = build(dir, 'v2.3.0');
  const parsed = parseManifest(text);

  assert.equal(parsed.file, 'Dota-2-Mod-Manager-Portable.exe');
  assert.equal(parsed.size, bytes.length);
  assert.equal(parsed.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.match(text, /^version: 2\.3\.0$/m, 'the leading v is dropped');
});

test('a manifest missing any of the three fields is refused', () => {
  const full = 'version: 2.3.0\nfile: Dota-2-Mod-Manager-Portable.exe\nsize: 12\nsha256: ' + 'a'.repeat(64);
  assert.ok(parseManifest(full), 'the complete one passes');
  for (const drop of ['file', 'size', 'sha256']) {
    const text = full.split('\n').filter((l) => !l.startsWith(`${drop}:`)).join('\n');
    assert.throws(() => parseManifest(text), new RegExp(drop), `missing ${drop}`);
  }
});

test('a file name that is a path, or not an exe, is refused', () => {
  const withFile = (f: string) => `file: ${f}\nsize: 12\nsha256: ${'a'.repeat(64)}`;
  for (const bad of ['../evil.exe', 'sub/dir.exe', 'C:\\evil.exe', 'evil.bat', 'evil.exe.txt', '']) {
    assert.throws(() => parseManifest(withFile(bad)), /file name/, `refused: ${JSON.stringify(bad)}`);
  }
  assert.ok(parseManifest(withFile('Dota-2-Mod-Manager-Portable.exe')));
});

test('a hash that is not a sha256 is refused', () => {
  const withHash = (h: string) => `file: a.exe\nsize: 12\nsha256: ${h}`;
  for (const bad of ['nope', 'a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64), '']) {
    assert.throws(() => parseManifest(withHash(bad)), /sha256/, `refused: ${JSON.stringify(bad)}`);
  }
  assert.ok(parseManifest(withHash('A'.repeat(64))), 'uppercase is still a hash');
});

test('a size that is not a positive number is refused', () => {
  const withSize = (s: string) => `file: a.exe\nsize: ${s}\nsha256: ${'a'.repeat(64)}`;
  for (const bad of ['0', '-5', 'lots', '']) {
    assert.throws(() => parseManifest(withSize(bad)), /size/, `refused: ${JSON.stringify(bad)}`);
  }
});

// The app builds this URL itself rather than trusting one from the network, which is the
// point: a rewritten manifest cannot send the download somewhere else.
test('the download address is built from the version and always points at the project', () => {
  const url = releaseUrl('2.3.0', 'portable.yml');
  assert.equal(url, 'https://github.com/dota2modmanager/dota2-mod-manager/releases/download/v2.3.0/portable.yml');
});
