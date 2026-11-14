// Recorded answers: what a function answered for an input, kept as a short hash so the Rust side
// can be checked without the TypeScript it was ported from. A case is keyed by its function and
// its input, with a file named in the input ({$file}) taken by its contents rather than its path,
// since the tests write such files to fresh temporary folders. Objects hash with their keys
// sorted, so the order a side writes them in does not matter (assert.deepEqual ignores it too).
// An answer compared within some ulps keeps its numbers whole instead of a hash.
//
// GOLDEN_RECORD=1 writes what was seen back to the file; otherwise a case missing from it fails.
// Inputs carry paths, which differ between systems, so each system has a file of its own; where
// there is none yet, `on` is false and only the comparison with the TypeScript runs. A fresh
// temporary folder (mkdtemp's random characters after its prefix's last dash, with anything a
// test appends to them) reads as <TMP>/<its prefix> on both the
// input and the answer side, in any spelling of the separators, so a run does not change a key.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

type Table = Record<string, Record<string, string | { whole: unknown }>>;

const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

const SEP = String.raw`[\\/]+`;
const escaped = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean).map(escaped);
const roots = [...new Set([os.tmpdir(), fs.realpathSync.native(os.tmpdir())])].map(parts);
const TMP = new RegExp(String.raw`(?:${roots.map((r) => r.join(SEP)).join('|')})${SEP}([^\\/"]*?-)[A-Za-z0-9]+(?=[\\/"]|$)`, 'gi');

/** A string with every fresh temporary folder in it named the same way on every run. */
export const stable = (s: string) => s.replace(TMP, '<TMP>/$1');

/** JSON with every object's keys in order. */
export function sorted(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(stable(v));
  if (Array.isArray(v)) return `[${v.map(sorted).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${sorted((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

const files = new Map<string, string>();
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    if ('$file' in v) {
      const f = (v as { $file: string }).$file;
      if (!files.has(f)) files.set(f, sha(fs.readFileSync(f)));
      return { $file: files.get(f) };
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canon(x)]));
  }
  return v;
}

export class Golden {
  readonly file: string;
  readonly record = process.env.GOLDEN_RECORD === '1';
  readonly on: boolean;
  private table: Table;
  private seen: Table = {};

  constructor(file: string) {
    this.file = file;
    this.on = fs.existsSync(file);
    this.table = this.on ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }

  key(args: unknown[]): string {
    return sha(sorted(canon(args)));
  }

  /** The recorded answer for this case, if there is one. */
  want(name: string, args: unknown[]): string | { whole: unknown } | undefined {
    return this.table[name]?.[this.key(args)];
  }

  /** The form an answer is kept in. */
  static form(answer: unknown, whole: boolean): string | { whole: unknown } {
    return whole ? { whole: answer } : sha(sorted(answer));
  }

  note(name: string, args: unknown[], answer: unknown, whole: boolean) {
    (this.seen[name] ??= {})[this.key(args)] = Golden.form(answer, whole);
  }

  /** Writes what this run saw over the functions it ran; the others keep their record. */
  save() {
    if (!this.record) return;
    const out: Table = { ...this.table };
    for (const [name, cases] of Object.entries(this.seen)) out[name] = cases;
    const ordered = Object.fromEntries(Object.keys(out).sort().map((n) => [n, Object.fromEntries(Object.keys(out[n]).sort().map((k) => [k, out[n][k]]))]));
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(ordered, null, 0).replace(/\},"/g, '},\n"') + '\n');
  }
}
