// The Rust KV3 and resource code (crates/mm-core/src/kv3.rs, resource.rs) answers what
// src/kv3*.ts and src/resource.ts answer, on blocks built here in every shape the helpers know
// (versions 1, 2 and 5 with zstd) and, when the game is on this machine, a spread of its own
// particles, materials, models and sounds read out of pak01 (read only, as the sandbox does).
// Skipped where mm-cli is not built, like test/rust-parity.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { listVpkEntries, openVpkIndex } from '../src/vpk.ts';
import { readKv3, numberOf, type Kv3Node, type Kv3Block } from '../src/kv3.ts';
import { writeKv3 } from '../src/kv3-write.ts';
import { resourceBlocks, resourceBlock, references, resourceId, withReferences } from '../src/resource.ts';
import { encodeKv3, kv3Block, host, model, particle, resource, rerl, type V } from './helpers/kv3-build.ts';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'target', 'debug', process.platform === 'win32' ? 'mm-cli.exe' : 'mm-cli');
const skip = !fs.existsSync(cli) && 'mm-cli is not built (cargo build -p mm-cli)';
const rust = (...args: string[]) => JSON.parse(execFileSync(cli, args, { encoding: 'utf8', maxBuffer: 1 << 30 }));
const sha = (b: Buffer) => crypto.createHash('sha1').update(b).digest('hex');
const GAME_PAK01 = 'c:/program files (x86)/steam/steamapps/common/dota 2 beta/game/dota/pak01_dir.vpk';

const values: V = { obj: [
  ['m_int', { int: -7 }], ['m_ints', { i32s: [0, 210, 255, 255] }], ['m_str', { str: 'hello' }], ['m_yes', { yes: true }],
  ['m_one', { one: true }], ['m_dbl', { dbl: 0.25 }], ['m_i64', { i64: 1234567 }], ['m_zero', { i64zero: true }],
  ['m_f64s', { f64s: [1.5, -2, 3e10] }], ['m_blob', { blob: Buffer.from('some bytes of a blob') }], ['m_ref', { ref: 'materials/a.vmat' }],
  ['m_bool', { bool: false }], ['m_objs', { objs: [[['m_name', { str: 'a' }]], [['m_name', { str: 'b' }]]] }],
  ['m_rows', { i32rows: [[1, 2], [3]] }], ['m_u32', { u32bit: 1 }], ['m_ones', { typedOnes: 3 }],
  ['m_arr', { arr: [{ int: 1 }, { str: 'x' }, { arr: [] }] }],
] };

/** The resources to compare on, each also written to a file for the Rust side. */
function resources(tmp: string) {
  const files: { name: string; file: Buffer }[] = [
    { name: 'v1', file: particle(encodeKv3(values, 1)) },
    { name: 'v2', file: particle(encodeKv3(values, 2)) },
    { name: 'v5', file: particle(encodeKv3(values, 5)) },
    { name: 'colour', file: particle(kv3Block()) },
    { name: 'host', file: host(['particles/eye.vpcf', 'particles/tail.vpcf']) },
    { name: 'model', file: model('axe', [['idle', ['ACT_DOTA_IDLE']]]) },
    { name: 'refs', file: resource([['RERL', rerl(['materials/x.vmat', 'particles/y.vpcf'])], ['DATA', encodeKv3(values)]]) },
  ];
  if (fs.existsSync(GAME_PAK01)) {
    const index = openVpkIndex(GAME_PAK01);
    const paths = listVpkEntries(fs.readFileSync(GAME_PAK01)).map((e) => e.path);
    for (const ext of ['.vpcf_c', '.vmat_c', '.vmdl_c', '.vsndevts_c', '.vanim_c']) {
      const all = paths.filter((p) => p.endsWith(ext));
      const step = Math.max(1, Math.floor(all.length / 40));
      for (let k = 0; k < all.length; k += step) {
        const file = index.read(all[k]);
        if (file) files.push({ name: all[k], file });
      }
    }
  }
  return files.map(({ name, file }, k) => {
    const at = path.join(tmp, `r${k}.bin`);
    fs.writeFileSync(at, file);
    return { name, file, at };
  });
}

/** The TypeScript tree in the shape mm-cli's kv3-dump prints. */
function dump(kv: Kv3Block) {
  const node = (n: Kv3Node): unknown => {
    const flag = n.flag ? { flag: n.flag } : {};
    switch (n.kind) {
      case 'object': return { kind: 'object', members: [...n.members].map(([k, v]) => [k, node(v)]), ...flag };
      case 'array': return { kind: 'array', type: n.type, items: n.items.map(node), ...(n.element ? { element: n.element } : {}), ...flag };
      case 'number': { const v = numberOf(kv, n); return { kind: 'number', type: n.type, cell: n.cell, typeAt: n.typeAt, value: v === 0 ? 0 : v, ...flag }; }
      case 'string': return { kind: 'string', value: n.value, ...flag };
      case 'blob': return { kind: 'blob', data: n.data.toString('hex'), ...flag };
      default: return { kind: 'other', type: n.type, ...(n.value !== undefined ? { value: n.value } : {}), ...flag };
    }
  };
  return JSON.parse(JSON.stringify({ version: kv.version, strings: kv.strings, root: node(kv.root), arrays: kv.arrays }));
}

const attempt = (f: () => Buffer): string | { error: string } => {
  try { return sha(f()); } catch (e) { return { error: (e as Error).message }; }
};

test('KV3: every block reads as the same tree, encodes back and writes anew the same', { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-kv3-'));
  const blocks: { name: string; at: string; data: Buffer }[] = [];
  for (const r of resources(tmp)) {
    const seen = new Map<string, number>();
    for (const b of resourceBlocks(r.file)) {
      const nth = seen.get(b.name) ?? 0;
      seen.set(b.name, nth + 1);
      const data = Buffer.from(resourceBlock(r.file, b.name, nth).data);
      if (data.length < 4 || (data.readUInt32LE(0) & 0xffffff00) >>> 0 !== 0x4b563300) continue;
      const at = path.join(tmp, `b${blocks.length}.bin`);
      fs.writeFileSync(at, data);
      blocks.push({ name: `${r.name} ${b.name}#${nth}`, at, data });
    }
  }
  fs.writeFileSync(path.join(tmp, 'list.json'), JSON.stringify(blocks.map((b) => b.at)));
  const rs = rust('kv3-dump', path.join(tmp, 'list.json'));
  assert.equal(rs.length, blocks.length);
  let compared = 0;
  blocks.forEach((b, i) => {
    let kv: Kv3Block;
    try { kv = readKv3(b.data); } catch (e) {
      assert.ok(rs[i].error, `${b.name}: TypeScript refuses it (${(e as Error).message}), Rust reads it`);
      return;
    }
    assert.ok(!rs[i].error, `${b.name}: Rust refuses it: ${rs[i].error}`);
    assert.deepEqual(rs[i].dump, dump(kv), `${b.name}: the tree`);
    const written = attempt(() => writeKv3(kv));
    if (typeof written === 'string') assert.equal(rs[i].write, written, `${b.name}: written anew`);
    else assert.ok(rs[i].write.error, `${b.name}: TypeScript cannot write it anew (${written.error}), Rust can`);
    // zstd's bytes differ from Node's compressor; that it reads back the same is what counts
    if (b.data.readUInt32LE(20) !== 2) assert.equal(rs[i].encode, sha(kv.encode()), `${b.name}: encoded back`);
    assert.equal(rs[i].reread, true, `${b.name}: encoded back reads the same`);
    compared++;
  });
  assert.ok(compared >= 7, `compared ${compared} blocks`);
});

test('resources: the blocks, the names in RERL and a name added come out the same', { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-res-'));
  const files = resources(tmp);
  fs.writeFileSync(path.join(tmp, 'list.json'), JSON.stringify(files.map((f) => f.at)));
  const rs = rust('resource', path.join(tmp, 'list.json'));
  files.forEach((f, i) => {
    let refs: string[];
    try { refs = references(f.file); } catch (e) {
      assert.ok(rs[i].error, `${f.name}: TypeScript refuses it (${(e as Error).message}), Rust reads it`);
      return;
    }
    assert.ok(!rs[i].error, `${f.name}: Rust refuses it: ${rs[i].error}`);
    assert.deepEqual(rs[i].blocks, resourceBlocks(f.file), `${f.name}: blocks`);
    assert.deepEqual(rs[i].references, refs, `${f.name}: references`);
    assert.deepEqual(rs[i].ids, refs.map((r) => resourceId(r).toString()), `${f.name}: ids`);
    const added = attempt(() => withReferences(f.file, ['particles/added/one.vpcf_c']));
    if (typeof added === 'string') assert.equal(rs[i].added, added, `${f.name}: a name added`);
    else assert.ok(rs[i].added.error, `${f.name}: refused in TypeScript (${added.error}), not in Rust`);
  });
});
