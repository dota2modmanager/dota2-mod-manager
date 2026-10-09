/**
 * Compiled Source 2 resources at the block level: the blocks of a file, one replaced by new bytes,
 * and the list of other resources a file names (RERL), which can be added to.
 *
 * A resource is a header, a table of blocks (name, offset from the entry, size) and the blocks.
 * A block replaced in the middle moves the ones after it by a multiple of 16 bytes, so they keep
 * the alignment they had. RERL entries are a 64-bit id, MurmurHash64B of the path with Valve's
 * seed, and the path; a particle that gains a child names it there too, as the compiler would.
 */

export interface Block { name: string; entry: number; at: number; size: number }

/** The blocks of a compiled resource: name, where its table entry is, where its data is and how long. */
export function resourceBlocks(file: Buffer): Block[] {
  const table = 8 + file.readUInt32LE(8);
  const out: Block[] = [];
  for (let k = 0; k < file.readUInt32LE(12); k++) {
    const e = table + k * 12;
    out.push({ name: file.toString('ascii', e, e + 4), entry: e, at: e + 4 + file.readUInt32LE(e + 4), size: file.readUInt32LE(e + 8) });
  }
  return out;
}

const align16 = (n: number) => Math.ceil(n / 16) * 16;

/** One block of a compiled resource, and the file with new bytes in its place. */
export function resourceBlock(file: Buffer, name: string): { data: Buffer; replace(next: Buffer): Buffer } {
  const blocks = resourceBlocks(file);
  const block = blocks.find((b) => b.name === name);
  if (!block) throw new Error(`resource: no ${name} block`);
  const after = blocks.filter((b) => b.at > block.at);
  const end = after.length ? Math.min(...after.map((b) => b.at)) : block.at + block.size;
  return {
    data: file.subarray(block.at, block.at + block.size),
    replace(next) {
      const gap = end - block.at;
      const room = after.length ? gap + align16(next.length - gap) : next.length;
      const body = Buffer.concat([next, Buffer.alloc(room - next.length)]);
      const out = Buffer.concat([file.subarray(0, block.at), body, file.subarray(end)]);
      out.writeUInt32LE(next.length, block.entry + 8);
      for (const b of after) out.writeUInt32LE(out.readUInt32LE(b.entry + 4) + room - gap, b.entry + 4);
      out.writeUInt32LE(out.length, 0);
      return out;
    },
  };
}

/** The DATA block of a compiled resource, and the file with a new one in its place. */
export const dataBlock = (file: Buffer) => resourceBlock(file, 'DATA');

/** The id a resource is named by in RERL: MurmurHash64B of its path, seed 0xEDABCDEF. */
export function resourceId(path: string): bigint {
  const d = Buffer.from(path);
  const m = 0x5bd1e995;
  let h1 = (0xedabcdef ^ d.length) >>> 0;
  let h2 = 0;
  const mix = (h: number, k: number) => {
    k = Math.imul(k, m);
    k ^= k >>> 24;
    return Math.imul(h, m) ^ Math.imul(k, m);
  };
  let i = 0;
  for (; d.length - i >= 8; i += 8) { h1 = mix(h1, d.readUInt32LE(i)); h2 = mix(h2, d.readUInt32LE(i + 4)); }
  if (d.length - i >= 4) { h1 = mix(h1, d.readUInt32LE(i)); i += 4; }
  const rest = d.length - i;
  if (rest === 3) h2 ^= d[i + 2] << 16;
  if (rest >= 2) h2 ^= d[i + 1] << 8;
  if (rest >= 1) h2 = Math.imul(h2 ^ d[i], m);
  h1 ^= h2 >>> 18; h1 = Math.imul(h1, m);
  h2 ^= h1 >>> 22; h2 = Math.imul(h2, m);
  h1 ^= h2 >>> 17; h1 = Math.imul(h1, m);
  h2 ^= h1 >>> 19; h2 = Math.imul(h2, m);
  return (BigInt(h1 >>> 0) << 32n) | BigInt(h2 >>> 0);
}

/** The resources a file names in its RERL block (none when it has no such block). */
export function references(file: Buffer): string[] {
  if (!resourceBlocks(file).some((b) => b.name === 'RERL')) return [];
  const { data } = resourceBlock(file, 'RERL');
  const first = data.readUInt32LE(0);
  const out: string[] = [];
  for (let k = 0; k < data.readUInt32LE(4); k++) {
    const e = first + k * 16;
    const s = e + 8 + data.readUInt32LE(e + 8);
    out.push(data.toString('utf8', s, data.indexOf(0, s)));
  }
  return out;
}

/**
 * The file with `paths` added to the resources its RERL block names (those already there are kept
 * once). A file with no RERL block is refused: adding a block is not done here.
 */
export function withReferences(file: Buffer, paths: string[]): Buffer {
  const names = [...references(file)];
  for (const p of paths) if (!names.includes(p)) names.push(p);
  const entries = Buffer.alloc(names.length * 16);
  const text: Buffer[] = [];
  let at = 8 + entries.length;
  names.forEach((n, k) => {
    const e = k * 16;
    entries.writeBigUInt64LE(resourceId(n), e);
    entries.writeUInt32LE(at - (8 + e + 8), e + 8);
    const s = Buffer.from(`${n}\0`);
    text.push(s);
    at += s.length;
  });
  const head = Buffer.alloc(8);
  head.writeUInt32LE(8, 0);
  head.writeUInt32LE(names.length, 4);
  return resourceBlock(file, 'RERL').replace(Buffer.concat([head, entries, ...text]));
}
