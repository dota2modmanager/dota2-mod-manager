// The Rust rewrite (crates/mm-core) answers exactly what the TypeScript it replaces answers.
//
// Each case runs the TypeScript module and the Rust one (through target/debug/mm-cli) on the same
// input and compares: built VPKs here, and the sandbox's real catalog mods and its pak01 when
// `npm run sandbox:seed` has been run. Skipped where mm-cli is not built (`cargo build -p mm-cli`),
// so a checkout without Rust still runs the rest of the suite. docs/rust-migration.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildVpk, entryAt, listVpkEntries, fingerprintVpk, mergeVpkToSingle, openVpkIndex, crc32 } from '../src/vpk.ts';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'target', 'debug', process.platform === 'win32' ? 'mm-cli.exe' : 'mm-cli');
const skip = !fs.existsSync(cli) && 'mm-cli is not built (cargo build -p mm-cli)';
const rust = (...args: string[]) => JSON.parse(execFileSync(cli, args, { encoding: 'utf8', maxBuffer: 1 << 30 }));

/** The VPKs to compare on: a few built here, and the sandbox's real ones when it is there. */
function inputs() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-parity-'));
  const built = path.join(tmp, 'built_dir.vpk');
  const shared = Buffer.from('one model under two paths');
  fs.writeFileSync(built, buildVpk([
    entryAt('models/heroes/axe/axe.vmdl_c', shared),
    entryAt('models/heroes/axe/axe_alt.vmdl_c', shared),
    entryAt('README', Buffer.from('no extension')),
    entryAt('materials/x.vmat_c', Buffer.alloc(0)),
  ]));
  const files = [built];
  const mods = path.join(root, 'sandbox', 'mods');
  if (fs.existsSync(mods)) for (const f of fs.readdirSync(mods)) if (f.endsWith('_dir.vpk')) files.push(path.join(mods, f));
  return { tmp, files };
}

test('VPK: the index lists the same paths and CRCs, in the same order', { skip }, () => {
  const { files } = inputs();
  for (const f of files) {
    const ts = listVpkEntries(fs.readFileSync(f)).map((e) => [e.path, e.crc]);
    assert.deepEqual(rust('vpk-entries', f), ts, f);
  }
});

test('VPK: the content fingerprint is the same', { skip }, () => {
  const { files } = inputs();
  for (const f of files) assert.equal(rust('vpk-fingerprint', f), fingerprintVpk(fs.readFileSync(f)), f);
});

test('VPK: a file merged to a single VPK comes out byte for byte the same', { skip }, () => {
  const { tmp, files } = inputs();
  for (const f of files) {
    const out = path.join(tmp, `rust-${path.basename(f)}`);
    rust('vpk-merge', f, out);
    assert.ok(fs.readFileSync(out).equals(mergeVpkToSingle(f)), f);
  }
});

test('VPK: one file read out of the sandbox pak01 by a seek is the same file', { skip }, (t) => {
  const pak01 = path.join(root, 'sandbox', 'steamapps', 'common', 'dota 2 beta', 'game', 'dota', 'pak01_dir.vpk');
  if (!fs.existsSync(pak01)) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const wanted = 'scripts/items/items_game.txt';
  const ts = openVpkIndex(pak01).read(wanted);
  assert.deepEqual(rust('vpk-read', pak01, wanted), ts ? { size: ts.length, crc: crc32(ts) } : null);
});

test('items_game: every numbered item reads the same, byte ranges included', { skip }, async (t) => {
  const game = path.join(root, 'sandbox', 'steamapps', 'common', 'dota 2 beta', 'game');
  if (!fs.existsSync(path.join(game, 'dota', 'pak01_dir.vpk'))) { t.skip('no sandbox (npm run sandbox:seed)'); return; }
  const { readGameSchema, listItems } = await import('../src/schema-items.ts');
  const ts = readGameSchema(game);
  const rs = rust('schema-items', game);
  assert.equal(rs.stamp, ts.stamp);
  const want = listItems(ts.text);
  assert.equal(rs.items.length, want.length);
  for (let i = 0; i < want.length; i++) assert.deepEqual(rs.items[i], want[i], `item ${want[i].id}`);
});
