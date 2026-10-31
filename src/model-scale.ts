/* A compiled model made bigger about its origin, and how much bigger one model is than another.
 *
 * A persona is worn as the plain hero (src/item-builder-personas.ts), and the server draws the
 * plain hero at his own ModelScale: Invoker at 0.74, where Valve draws the Acolyte at 1 through the
 * persona's hero_scale, which the server applies only to the persona's owner. A persona body
 * compiled 1.35 times bigger stands at Valve's size, but its items do not follow: a wearable is
 * bone-merged, its bones put where the body's are, and its vertices hang off those bones at the
 * distances it was compiled with. The Acolyte's hair, weighted to the head alone, sat inside a head
 * 1.35 times bigger, and Invoker came out bald (hero-base-fixes 5f977421, 2026-10-27).
 *
 * So each item worn on such a body is made bigger by the same factor, here, from the game's own
 * file: its vertices' positions, the translation of each bone's inverse bind pose (which the
 * skinning uses, so the vertices stay on their bones), its skeleton's bone positions, and its
 * bounds, hitboxes and attachment offsets. 107 of the 168 vertex buffers the five personas' items
 * have are meshopt-compressed, the codec Valve uses; they are decoded, scaled and encoded again in
 * the same version (0, "0xa0"), and every flag and size the model names stays as it was.
 *
 * Not scaled: an item's own animations (its jiggle and cloth bones keep their compiled distances
 * where an animation moves them), its physics, and its morphs.
 */
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readKv3, numberOf, setNumber, type Kv3Block, type Kv3Node } from './kv3.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';
import { entryAt, entryPath, type VpkEntry } from './vpk.ts';

// the codec is WebAssembly, made ready once, long before a build needs it
let codecReady = false;
const codec = Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]).then(() => { codecReady = true; });
/** Resolves once models can be scaled: for a caller that starts before the codec is ready, a test. */
export const modelScaleReady = (): Promise<void> => codec;

type Num = Extract<Kv3Node, { kind: 'number' }>;
const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);
const items = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);
const num = (kv: Kv3Block, n: Kv3Node | undefined) => (n?.kind === 'number' ? numberOf(kv, n) : -1);
/** A KV3 boolean, which is stored as its type alone: 13 true, 14 false (CTRL's buffer flags). */
const truth = (n: Kv3Node | undefined) => n?.kind === 'other' && n.type === 13;

/** Lengths in a model's blocks, by the key they are under: each number below one is scaled. */
const LENGTHS = new Set([
  'm_vMinBounds', 'm_vMaxBounds', 'm_vecCenter', 'm_vecSize', 'm_flSphereRadius', 'm_vInfluenceOffsets',
  'm_bonePosParent', 'm_boneSphere', 'm_vHullMin', 'm_vHullMax', 'm_vViewMin', 'm_vViewMax', 'm_vEyePosition',
]);

/** Every number under `n`, each times `s`; an inverse bind pose's translation alone (a 3x4 row-major matrix). */
function scaleNumbers(kv: Kv3Block, n: Kv3Node, s: number, all: boolean): void {
  if (n.kind === 'number') { if (all) setNumber(kv, n, numberOf(kv, n) * s); return; }
  if (n.kind === 'array') { for (const x of n.items) scaleNumbers(kv, x, s, all); return; }
  if (n.kind !== 'object') return;
  for (const [key, v] of n.members) {
    if (key === 'm_invBindPose' && v.kind === 'array' && v.items.length === 12) {
      for (const i of [3, 7, 11]) { const x = v.items[i]; if (x.kind === 'number') setNumber(kv, x, numberOf(kv, x) * s); }
    } else scaleNumbers(kv, v, s, all || LENGTHS.has(key));
  }
}

/** A KV3 block of a model with its lengths times `s`. */
function scaledKv3(data: Buffer, s: number): Buffer {
  const kv = readKv3(data);
  scaleNumbers(kv, kv.root, s, false);
  return kv.encode();
}

/** One vertex buffer's bytes with each position times `s`: float3 at `offset` in each `size`-byte vertex. */
function scaledVertices(data: Buffer, count: number, size: number, offset: number, compressed: boolean, s: number): Buffer {
  if (!codecReady) throw new Error('model-scale: the meshopt codec is not ready');
  const raw = Buffer.alloc(count * size);
  if (compressed) MeshoptDecoder.decodeVertexBuffer(raw, count, size, data);
  else data.copy(raw, 0, 0, count * size);
  for (let v = 0; v < count; v++) {
    const at = v * size + offset;
    for (let c = 0; c < 3; c++) raw.writeFloatLE(raw.readFloatLE(at + 4 * c) * s, at + 4 * c);
  }
  return compressed ? Buffer.from(MeshoptEncoder.encodeVertexBufferLevel(raw, count, size, 2, 0)) : raw;
}

const FLOAT3 = 6; // DXGI_FORMAT_R32G32B32_FLOAT, the only position format the personas' items have
const align16 = (n: number) => Math.ceil(n / 16) * 16;

/**
 * An MBUF (or VBIB) block with its vertex buffers' positions scaled: a header of where the vertex
 * and index buffer headers are, each 24 bytes (count, size, attributes, data and its length, each
 * offset counted from where it is written), the attributes 56 bytes each. A compressed buffer is
 * one whose length is not count times size. The data after a buffer that grew moves, and every
 * offset that points past it with it.
 */
function scaledVbib(block: Buffer, s: number): Buffer {
  let out = Buffer.from(block);
  const vbAt = out.readUInt32LE(0);
  // every buffer's data offset field, vertex and index, as a position in the block
  const dataFields = () => {
    const ibAt = 8 + out.readUInt32LE(8);
    return [[vbAt, out.readUInt32LE(4)], [ibAt, out.readUInt32LE(12)]].flatMap(([first, n]) => Array.from({ length: n }, (_, k) => first + k * 24 + 16));
  };
  for (let i = 0; i < out.readUInt32LE(4); i++) {
    const h = vbAt + i * 24;
    const count = out.readUInt32LE(h);
    const size = out.readUInt32LE(h + 4) & 0x3ffffff;
    const attrs = h + 8 + out.readUInt32LE(h + 8);
    let position: number | null = null;
    for (let a = 0; a < out.readUInt32LE(h + 12); a++) {
      const at = attrs + a * 56;
      if (out.toString('latin1', at, at + 32).replace(/\0[\s\S]*$/, '') !== 'POSITION') continue;
      if (out.readUInt32LE(at + 36) !== FLOAT3) throw new Error(`model-scale: positions in format ${out.readUInt32LE(at + 36)}`);
      position = out.readUInt32LE(at + 40);
    }
    if (position === null) continue;
    const dataAt = h + 16 + out.readUInt32LE(h + 16);
    const length = out.readUInt32LE(h + 20);
    const next = scaledVertices(out.subarray(dataAt, dataAt + length), count, size, position, length !== count * size, s);
    // the room up to the data after this one, grown by a multiple of 16 where the bytes need more
    const later = dataFields().map((f) => f + out.readUInt32LE(f)).filter((at) => at > dataAt);
    const gap = (later.length ? Math.min(...later) : dataAt + length) - dataAt;
    const room = next.length <= gap ? gap : gap + align16(next.length - gap);
    out = Buffer.concat([out.subarray(0, dataAt), next, Buffer.alloc(room - next.length), out.subarray(dataAt + gap)]);
    out.writeUInt32LE(next.length, h + 20);
    for (const f of dataFields()) if (f + out.readUInt32LE(f) > dataAt) out.writeUInt32LE(out.readUInt32LE(f) + room - gap, f);
  }
  return out;
}

/**
 * A compiled model (vmdl_c) `s` times bigger about its origin. Its meshes are named in CTRL: the
 * older models keep their buffers in one MBUF block per mesh (vbib_block), the newer in an MVTX
 * block per buffer with the layout in CTRL itself (m_vertexBuffers).
 */
export function scaleModel(file: Buffer, s: number): Buffer {
  if (s === 1) return file;
  const blocks = resourceBlocks(file);
  const ctrl = readKv3(resourceBlock(file, 'CTRL').data);
  const nth = (index: number) => blocks.slice(0, index).filter((b) => b.name === blocks[index].name).length;
  const swaps: { index: number; next: (data: Buffer) => Buffer }[] = [];
  for (const mesh of items(member(ctrl.root, 'embedded_meshes'))) {
    const data = num(ctrl, member(mesh, 'm_nDataBlock') ?? member(mesh, 'data_block'));
    if (data >= 0) swaps.push({ index: data, next: (d) => scaledKv3(d, s) });
    const vbib = num(ctrl, member(mesh, 'm_nVBIBBlock') ?? member(mesh, 'vbib_block'));
    if (vbib >= 0) { swaps.push({ index: vbib, next: (d) => scaledVbib(d, s) }); continue; }
    for (const vb of items(member(mesh, 'm_vertexBuffers'))) {
      if (truth(member(vb, 'm_bCompressedZSTD'))) throw new Error('model-scale: a zstd vertex buffer');
      const pos = items(member(vb, 'm_inputLayoutFields')).find((f) => member(f, 'm_pSemanticName')?.kind === 'string'
        && (member(f, 'm_pSemanticName') as { value: string }).value === 'POSITION');
      if (!pos) continue;
      if (num(ctrl, member(pos, 'm_Format')) !== FLOAT3) throw new Error(`model-scale: positions in format ${num(ctrl, member(pos, 'm_Format'))}`);
      const [count, size, offset] = ['m_nElementCount', 'm_nElementSizeInBytes'].map((k) => num(ctrl, member(vb, k))).concat(num(ctrl, member(pos, 'm_nOffset')));
      const compressed = truth(member(vb, 'm_bMeshoptCompressed'));
      swaps.push({ index: num(ctrl, member(vb, 'm_nBlockIndex')), next: (d) => scaledVertices(d, count, size, offset, compressed, s) });
    }
  }
  let out = file;
  for (const { index, next } of swaps) {
    const block = resourceBlock(out, blocks[index].name, nth(index));
    out = block.replace(next(block.data));
  }
  return resourceBlock(out, 'DATA').replace(scaledKv3(resourceBlock(out, 'DATA').data, s));
}

/** A model's bones by name, each with its distance from its parent. */
function boneLengths(file: Buffer): Map<string, number> {
  const kv = readKv3(resourceBlock(file, 'DATA').data);
  const skeleton = member(kv.root, 'm_modelSkeleton');
  const names = items(member(skeleton, 'm_boneName'));
  const out = new Map<string, number>();
  items(member(skeleton, 'm_bonePosParent')).forEach((p, i) => {
    const name = names[i];
    if (name?.kind !== 'string') return;
    out.set(name.value, Math.hypot(...items(p).map((x) => numberOf(kv, x as Num))));
  });
  return out;
}

/**
 * How much bigger `model` is than `reference`, from the bones they share: their total distance from
 * their parents, one over the other. A persona's base compiled at 1.35 measures 1.35 against
 * Valve's persona model, one compiled as Valve's measures 1. Null where they share no bone.
 */
export function modelScaleAgainst(model: Buffer, reference: Buffer): number | null {
  const mine = boneLengths(model);
  let a = 0, b = 0;
  for (const [name, length] of boneLengths(reference)) {
    const other = mine.get(name);
    if (other !== undefined) { a += other; b += length; }
  }
  return b > 1 ? a / b : null;
}

/**
 * A pick's files with its models `scale` times bigger (src/schema-build.ts, a persona's items). A
 * model that cannot be is left at its own size, and `skipped` is told which and why.
 */
export function scaledModels(entries: VpkEntry[], scale: number | undefined, skipped: (path: string, why: string) => void): VpkEntry[] {
  if (!scale) return entries;
  return entries.map((e) => {
    if (!entryPath(e).toLowerCase().endsWith('.vmdl_c')) return e;
    try {
      return entryAt(entryPath(e), scaleModel(e.data, scale));
    } catch (err) {
      skipped(entryPath(e), String((err as Error)?.message || err));
      return e;
    }
  });
}
