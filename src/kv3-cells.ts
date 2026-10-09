/**
 * The numbers in a parsed KV3 block (src/kv3.ts): read one where it lies, change it there, and the
 * 0s and 1s stored as a type alone, which can only become each other.
 */
import type { Kv3Block, Kv3Cell, Kv3Node } from './kv3.ts';

/** A number's value. */
export function readCell(kv: Kv3Block, c: Kv3Cell): number {
  const b = kv.buffers[c.buffer];
  if (c.float) return c.width === 4 ? b.readFloatLE(c.offset) : b.readDoubleLE(c.offset);
  if (c.width === 1) return c.signed ? b.readInt8(c.offset) : b.readUInt8(c.offset);
  if (c.width === 2) return c.signed ? b.readInt16LE(c.offset) : b.readUInt16LE(c.offset);
  if (c.width === 4) return c.signed ? b.readInt32LE(c.offset) : b.readUInt32LE(c.offset);
  return Number(c.signed ? b.readBigInt64LE(c.offset) : b.readBigUInt64LE(c.offset));
}

/** Change a number where it lies. */
export function writeCell(kv: Kv3Block, c: Kv3Cell, v: number): void {
  const b = kv.buffers[c.buffer];
  if (c.float) { if (c.width === 4) b.writeFloatLE(v, c.offset); else b.writeDoubleLE(v, c.offset); return; }
  if (c.width === 1) { if (c.signed) b.writeInt8(v, c.offset); else b.writeUInt8(v, c.offset); return; }
  if (c.width === 2) { if (c.signed) b.writeInt16LE(v, c.offset); else b.writeUInt16LE(v, c.offset); return; }
  if (c.width === 4) { if (c.signed) b.writeInt32LE(v, c.offset); else b.writeUInt32LE(v, c.offset); return; }
  if (c.signed) b.writeBigInt64LE(BigInt(v), c.offset); else b.writeBigUInt64LE(BigInt(v), c.offset);
}

/** A number node's value: from its bytes, or from its type for the 0s and 1s stored as a type alone. */
export function numberOf(kv: Kv3Block, node: Extract<Kv3Node, { kind: 'number' }>): number {
  if (node.cell) return readCell(kv, node.cell);
  return node.type === 16 || node.type === 18 ? 1 : 0;
}

/**
 * Set a number node where it lies. A number with bytes takes any value its width holds; one stored
 * as a type alone can only turn into the other of 0 and 1, by rewriting that type byte, which keeps
 * every lane the length it was.
 * @returns whether the value could be set
 */
export function setNumber(kv: Kv3Block, node: Extract<Kv3Node, { kind: 'number' }>, v: number): boolean {
  if (node.cell) { writeCell(kv, node.cell, v); return true; }
  if (!node.typeAt || (v !== 0 && v !== 1)) return false;
  const want = node.type <= 16 ? (v ? 16 : 15) : (v ? 18 : 17);
  const b = kv.buffers[node.typeAt.buffer];
  const mask = kv.version >= 3 ? 0x3f : 0x7f;
  b[node.typeAt.offset] = (b[node.typeAt.offset] & ~mask) | want;
  node.type = want;
  return true;
}
