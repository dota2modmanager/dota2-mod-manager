// A module of the old TypeScript main process while it is in the checkout, and the Rust core in its
// place once it is gone: each function of the stand-in runs the Rust function of the same name
// (module.function, the names crates/mm-core/src/owner/calls.rs answers to) through mm-cli. The
// parity tests build their inputs with these, so they keep running on the recorded answers
// (test/golden) after src/ is deleted. MM_NO_TS=1 acts as if it were gone already.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CLI, ROOT } from './mm-cli.ts';
import { openIndex, entryPath, crc32 } from './vpk-js.ts';

const SRC = path.join(ROOT, 'src');

/** Whether the TypeScript is there to compare with. */
export const HAVE_TS = process.env.MM_NO_TS !== '1' && fs.existsSync(path.join(SRC, 'main.ts'));

let scratch = '';
let n = 0;
// what the call being made wrote, removed once mm-cli has answered: a run makes thousands of calls,
// some with a whole items_game in them, and kept they came to gigabytes per test file
const written: string[] = [];
const tmp = (ext: string) => {
  if (!scratch) scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-tsr-'));
  const p = path.join(scratch, `${n++}${ext}`);
  written.push(p);
  return p;
};
const forget = () => { for (const p of written.splice(0)) fs.rmSync(p, { force: true }); };
/** A call's arguments as mm-cli takes them: bytes as a file ({$file}). */
const asJson = (v: unknown) => JSON.stringify(v, function (this: Record<string, unknown>, k, x) {
  const raw = this[k];
  if (Buffer.isBuffer(raw)) { const p = tmp('.bin'); fs.writeFileSync(p, raw); return { $file: p }; }
  return x;
});

/** One Rust function by its name, as mm-cli call runs it; throws what Rust answers as an error. */
export function rust(name: string, ...args: unknown[]): unknown {
  const file = tmp('.json');
  fs.writeFileSync(file, asJson([[name, ...args]]));
  let a;
  try { [a] = JSON.parse(execFileSync(CLI, ['call', file], { encoding: 'utf8', maxBuffer: 1 << 30 })); } finally { forget(); }
  if ('error' in a) throw new Error(a.error);
  return a.ok;
}

/** Many Rust functions in one mm-cli run: each answer, or null where it answered an error. */
export function rustAll(calls: unknown[][]): unknown[] {
  if (!calls.length) return [];
  const file = tmp('.json');
  fs.writeFileSync(file, asJson(calls));
  let out: { ok?: unknown }[];
  try { out = JSON.parse(execFileSync(CLI, ['call', file], { encoding: 'utf8', maxBuffer: 1 << 30 })); } finally { forget(); }
  return out.map((a) => ('ok' in a ? a.ok : null));
}

const EMPTY = Buffer.alloc(0);
/** An entry to write, as the TypeScript's entryAt made one. */
function entryAt(relPath: string, data: Buffer) {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const slash = norm.lastIndexOf('/');
  const file = slash === -1 ? norm : norm.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return { ext: dot === -1 ? ' ' : file.slice(dot + 1), folder: slash === -1 ? ' ' : norm.slice(0, slash), name: dot === -1 ? file : file.slice(0, dot), data, preload: EMPTY, crc: crc32(data) };
}
/** A VPK of these entries, built by mm-cli. */
function buildVpk(entries: { ext: string; folder: string; name: string; data: Buffer }[]): Buffer {
  const list = entries.map((e) => { const p = tmp('.bin'); fs.writeFileSync(p, e.data); return [entryPath(e), p]; });
  const listFile = tmp('.json');
  const out = tmp('_dir.vpk');
  fs.writeFileSync(listFile, JSON.stringify(list));
  try {
    execFileSync(CLI, ['vpk-build', out, listFile], { encoding: 'utf8' });
    return fs.readFileSync(out);
  } finally { forget(); }
}
/** items_game.txt as the game's pak01 holds it, and the stamp the app keeps it by. */
function readGameSchema(game: string) {
  const data = openIndex(path.join(game, 'dota', 'pak01_dir.vpk')).read('scripts/items/items_game.txt');
  if (!data) throw new Error('items_game.txt is not in the game\'s pak01');
  return { text: data.toString('latin1'), stamp: `${data.length}:${crc32(data)}` };
}
/** The blocks of a compiled resource, and one of them by its name. */
function resourceBlocks(file: Buffer) {
  const table = 8 + file.readUInt32LE(8);
  return Array.from({ length: file.readUInt32LE(12) }, (_, k) => {
    const e = table + k * 12;
    return { name: file.toString('ascii', e, e + 4), entry: e, at: e + 4 + file.readUInt32LE(e + 4), size: file.readUInt32LE(e + 8) };
  });
}
function resourceBlock(file: Buffer, name: string, nth = 0) {
  const blocks = resourceBlocks(file);
  const block = blocks.filter((b) => b.name === name)[nth];
  if (!block) throw new Error(`resource: no ${name} block`);
  const after = blocks.filter((b) => b.at > block.at);
  const end = after.length ? Math.min(...after.map((b) => b.at)) : block.at + block.size;
  return {
    data: file.subarray(block.at, block.at + block.size),
    // the file with new bytes in the block's place, the blocks after it moved along
    replace(next: Buffer) {
      const gap = end - block.at;
      const room = after.length ? gap + Math.ceil((next.length - gap) / 16) * 16 : next.length;
      const out = Buffer.concat([file.subarray(0, block.at), next, Buffer.alloc(room - next.length), file.subarray(end)]);
      out.writeUInt32LE(next.length, block.entry + 8);
      for (const b of after) out.writeUInt32LE(out.readUInt32LE(b.entry + 4) + room - gap, b.entry + 4);
      out.writeUInt32LE(out.length, 0);
      return out;
    },
  };
}
const listPaths = (f: string) => [...openIndex(f).paths()];
// the table's items, the last table's kept: the tests list one table many times
let listed: { text: string; items: unknown } | null = null;
function listItems(text: string) {
  if (listed?.text !== text) listed = { text, items: rust('schema-items.listItems', Buffer.from(text, 'latin1')) };
  return listed.items;
}

// What the tests build their inputs with that has no Rust call of its own: the game's paks are
// read here, and an index handed to Rust is its pak's path.
const HERE: Record<string, Record<string, unknown>> = {
  vpk: { buildVpk, openVpkIndex: openIndex, sharedVpkIndex: openIndex, entryPath, entryAt, crc32, listVpkPathsFile: listPaths },
  'vpk-read': { openVpkIndex: openIndex, entryPath, listVpkPathsFile: listPaths },
  'vpk-write': { entryAt, buildVpk },
  'vpk-shared': { sharedVpkIndex: openIndex },
  'schema-items': { readGameSchema, listItems },
  schema: { readGameSchema, listItems },
  resource: { resourceBlocks, resourceBlock },
  'model-scale': { modelScaleReady: async () => {} },
};

/** `import('../src/<name>.ts')`, or the Rust stand-in when the TypeScript is not there. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a module of either side, as the test uses it
export async function ts<T = any>(name: string): Promise<T> {
  const mod = name.replace(/\.ts$/, '');
  if (HAVE_TS) return (await import(new URL(`../../src/${mod}.ts`, import.meta.url).href)) as T;
  return new Proxy({}, {
    get: (_t, fn) => {
      if (typeof fn !== 'string' || fn === 'then') return undefined;
      return HERE[mod]?.[fn] ?? ((...args: unknown[]) => rust(`${mod}.${fn}`, ...args));
    },
  }) as T;
}

// The walk of a KeyValues block the parity tests pick their inputs with (the first "visuals" child
// of an item, say), as crates/mm-core/src/schema/kv.rs walks one: a token is quoted or bare, a gap
// is whitespace or a // comment, a block runs to its matching brace.
const isGap = (c: number) => (c <= 32 ? c === 32 || (c >= 9 && c <= 13) : c === 160 || (c > 255 && /\s/.test(String.fromCharCode(c))));
function skipGap(text: string, i: number): number {
  for (;;) {
    while (i < text.length && isGap(text.charCodeAt(i))) i++;
    if (text[i] === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) return text.length;
      i = nl + 1;
      continue;
    }
    return i;
  }
}
function readToken(text: string, i: number): { value: string; start: number; next: number } | null {
  i = skipGap(text, i);
  if (i >= text.length || text[i] === '}') return null;
  if (text[i] === '"') {
    const end = text.indexOf('"', i + 1);
    if (end === -1) throw new Error('an unclosed quote');
    return { value: text.slice(i + 1, end), start: i, next: end + 1 };
  }
  let end = i;
  while (end < text.length && !isGap(text.charCodeAt(end)) && !'{}"'.includes(text[end])) end++;
  return { value: text.slice(i, end), start: i, next: end };
}
/** [open, past the close] of the block that starts at or after i. */
export function blockBounds(text: string, i: number): [number, number] {
  const open = text.indexOf('{', i);
  if (open === -1) throw new Error('no block opens');
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    if (text[k] === '"') { const e = text.indexOf('"', k + 1); if (e === -1) break; k = e; continue; }
    if (text[k] === '{') depth++;
    else if (text[k] === '}' && --depth === 0) return [open, k + 1];
  }
  throw new Error('an unclosed block');
}
export type KvChild = { key: string; start: number; end: number; isBlock: boolean; value: string | null; body: [number, number] | null };
/** Each direct child of the block at `bounds`. */
export function eachChild(text: string, bounds: [number, number], fn: (c: KvChild) => void): void {
  const end = bounds[1] - 1;
  for (let i = bounds[0] + 1; i < end;) {
    const key = readToken(text, i);
    if (!key) return;
    const at = skipGap(text, key.next);
    let c: KvChild;
    if (text[at] === '{') {
      const b = blockBounds(text, at);
      c = { key: key.value, start: key.start, end: b[1], isBlock: true, value: null, body: b };
    } else {
      const val = readToken(text, at);
      if (!val) return;
      c = { key: key.value, start: key.start, end: val.next, isBlock: false, value: val.value, body: null };
    }
    fn(c);
    i = c.end;
  }
}
