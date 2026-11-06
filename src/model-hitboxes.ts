/**
 * Hitboxes laid over a wearable's surface, so an effect started on it spreads over the item.
 *
 * A particle system can start on a hitbox set of a model and pick points on those boxes. A wearable
 * has no hitboxes, and the mesh the game's effects read instead it keeps only for a hero's body, so
 * on an item the same system piles up in a ball at the model's origin, in the hand. Calvin's
 * constructor (dota-studio) showed the way out: boxes made from the item's own vertices, in a set
 * the particle points at, with `m_bUseBones` off (src/particle-surface.ts makes that copy).
 *
 * Each vertex goes to its heaviest bone and into the bone's own space (a box follows its bone), and
 * the vertices of a bone are gathered into cells, one box per cell: small enough to read as the
 * item's shape, and at most MAX_BOXES of them, since a system picks among boxes on every spawn.
 */
import { MeshoptDecoder } from 'meshoptimizer';
import { readKv3, numberOf, setNumber, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';

const MAX_BOXES = 256;
/** The set the boxes go in, which a system made to spread over them names. */
export const SURFACE_SET = 'mm_surface';
const FLOAT3 = 6; // DXGI_FORMAT_R32G32B32_FLOAT, every wearable's positions
const HITBOX_BONE = 0x100; // a bone's flag that the game computes it for hitboxes
const SHELL = 1.5; // how far a box stands off the points it was made from, so that a flat cell has a volume

const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);
const items = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);
const num = (kv: Kv3Block, n: Kv3Node | undefined) => (n?.kind === 'number' ? numberOf(kv, n) : -1);
const text = (n: Kv3Node | undefined) => (n?.kind === 'string' ? n.value : '');
const truth = (n: Kv3Node | undefined) => n?.kind === 'other' && n.type === 13;

/** One box: the bone it follows, its corners in that bone's space. */
export interface SurfaceBox { bone: string; min: number[]; max: number[] }

/** One vertex buffer's layout, however the model stores it. */
interface Layout { count: number; size: number; bytes: Buffer; compressed: boolean; position: number; indices: number; weights: number }

/** The 32-bit MurmurHash2 the game keeps its names by: a lowercase name, seed 0x31415926. */
export function nameHash(name: string): number {
  const d = Buffer.from(name.toLowerCase());
  const m = 0x5bd1e995;
  let h = (0x31415926 ^ d.length) | 0;
  let i = 0;
  for (; d.length - i >= 4; i += 4) {
    let k = Math.imul(d.readUInt32LE(i), m);
    k ^= k >>> 24;
    h = Math.imul(h, m) ^ Math.imul(k, m);
  }
  const rest = d.length - i;
  if (rest === 3) h ^= d[i + 2] << 16;
  if (rest >= 2) h ^= d[i + 1] << 8;
  if (rest >= 1) h = Math.imul(h ^ d[i], m);
  h ^= h >>> 13;
  h = Math.imul(h, m);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Layouts of an MBUF or VBIB block: 24-byte buffer headers, 56-byte attributes (src/model-scale.ts). */
function vbibLayouts(b: Buffer): Layout[] {
  const first = b.readUInt32LE(0);
  return Array.from({ length: b.readUInt32LE(4) }, (_, i) => {
    const h = first + i * 24;
    const count = b.readUInt32LE(h);
    const size = b.readUInt32LE(h + 4) & 0x3ffffff;
    const attrs = h + 8 + b.readUInt32LE(h + 8);
    const at: Record<string, [number, number]> = {};
    for (let a = 0; a < b.readUInt32LE(h + 12); a++) {
      const p = attrs + a * 56;
      at[b.toString('latin1', p, p + 32).replace(/\0[\s\S]*$/, '')] = [b.readUInt32LE(p + 40), b.readUInt32LE(p + 36)];
    }
    const dataAt = h + 16 + b.readUInt32LE(h + 16);
    const length = b.readUInt32LE(h + 20);
    return {
      count, size, bytes: b.subarray(dataAt, dataAt + length), compressed: length !== count * size,
      position: at.POSITION?.[1] === FLOAT3 ? at.POSITION[0] : -1,
      indices: at.BLENDINDICES?.[0] ?? -1,
      weights: at.BLENDWEIGHT?.[0] ?? at.BLENDWEIGHTS?.[0] ?? -1,
    };
  });
}

/** Layouts of a mesh that keeps each buffer in an MVTX block and says how in CTRL. */
function ctrlLayouts(file: Buffer, ctrl: Kv3Block, mesh: Kv3Node): Layout[] {
  const blocks = resourceBlocks(file);
  return items(member(mesh, 'm_vertexBuffers')).flatMap((vb) => {
    if (truth(member(vb, 'm_bCompressedZSTD'))) return [];
    const field = (name: string) => items(member(vb, 'm_inputLayoutFields')).find((f) => text(member(f, 'm_pSemanticName')) === name);
    const pos = field('POSITION');
    if (!pos || num(ctrl, member(pos, 'm_Format')) !== FLOAT3) return [];
    const offset = (f: Kv3Node | undefined) => (f ? num(ctrl, member(f, 'm_nOffset')) : -1);
    const index = num(ctrl, member(vb, 'm_nBlockIndex'));
    const nth = blocks.slice(0, index).filter((b) => b.name === blocks[index].name).length;
    return [{
      count: num(ctrl, member(vb, 'm_nElementCount')), size: num(ctrl, member(vb, 'm_nElementSizeInBytes')),
      bytes: resourceBlock(file, blocks[index].name, nth).data, compressed: truth(member(vb, 'm_bMeshoptCompressed')),
      position: offset(pos), indices: offset(field('BLENDINDICES')), weights: offset(field('BLENDWEIGHT') ?? field('BLENDWEIGHTS')),
    }];
  });
}

const raw = (l: Layout): Buffer => {
  if (!l.compressed) return l.bytes;
  const out = Buffer.alloc(l.count * l.size);
  MeshoptDecoder.decodeVertexBuffer(out, l.count, l.size, l.bytes);
  return out;
};

/** The bones a mesh's blend indices name, by index: through the model's remapping table where it has one. */
function meshBones(data: Block, meshIndex: number): (i: number) => string {
  const names = items(member(member(data.root, 'm_modelSkeleton'), 'm_boneName')).map(text);
  const table = items(member(data.root, 'm_remappingTable')).map((n) => num(data, n));
  const start = num(data, items(member(data.root, 'm_remappingTableStarts'))[meshIndex]);
  return (i) => names[table[Math.max(start, 0) + i] ?? i] ?? names[0] ?? '';
}
type Block = Kv3Block;

/** A mesh's inverse bind poses, 3x4 rows by bone name, from its skeleton. */
function bindPoses(mesh: Block): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const b of items(member(member(mesh.root, 'm_skeleton'), 'm_bones'))) {
    const pose = items(member(b, 'm_invBindPose')).map((n) => num(mesh, n));
    if (pose.length === 12) out.set(text(member(b, 'm_boneName')), pose);
  }
  return out;
}

const apply = (m: number[], p: number[]) => [0, 4, 8].map((r) => m[r] * p[0] + m[r + 1] * p[1] + m[r + 2] * p[2] + m[r + 3]);

/** Every vertex of the first mesh as its heaviest bone and its place in that bone's space. */
function surface(file: Buffer, ctrl: Kv3Block, data: Kv3Block): { bone: string; at: number[] }[] {
  const meshes = items(member(ctrl.root, 'embedded_meshes'));
  const blocks = resourceBlocks(file);
  const mesh = meshes[0];
  const blockOf = (index: number) => {
    const nth = blocks.slice(0, index).filter((b) => b.name === blocks[index].name).length;
    return resourceBlock(file, blocks[index].name, nth).data;
  };
  const vbib = num(ctrl, member(mesh, 'm_nVBIBBlock') ?? member(mesh, 'vbib_block'));
  const layouts = vbib >= 0 ? vbibLayouts(blockOf(vbib)) : ctrlLayouts(file, ctrl, mesh);
  const dataBlock = num(ctrl, member(mesh, 'm_nDataBlock') ?? member(mesh, 'data_block'));
  const poses = bindPoses(readKv3(blockOf(dataBlock)));
  const bone = meshBones(data, num(ctrl, member(mesh, 'm_nMeshIndex') ?? member(mesh, 'mesh_index')));
  const out: { bone: string; at: number[] }[] = [];
  for (const l of layouts) {
    if (l.position < 0) continue;
    const b = raw(l);
    for (let v = 0; v < l.count; v++) {
      const at = v * l.size;
      const p = [0, 4, 8].map((c) => b.readFloatLE(at + l.position + c));
      let heaviest = 0;
      if (l.indices >= 0 && l.weights >= 0) {
        let w = -1;
        for (let k = 0; k < 4; k++) if (b[at + l.weights + k] > w) { w = b[at + l.weights + k]; heaviest = k; }
      }
      const name = bone(l.indices >= 0 ? b[at + l.indices + heaviest] : 0);
      const pose = poses.get(name);
      out.push({ bone: name, at: pose ? apply(pose, p) : p });
    }
  }
  return out;
}

/** Vertices gathered into cells of `size`, a box per cell. */
function cells(points: { bone: string; at: number[] }[], size: number): SurfaceBox[] {
  const boxes = new Map<string, SurfaceBox>();
  for (const { bone, at } of points) {
    const key = `${bone}|${at.map((c) => Math.floor(c / size)).join('|')}`;
    const box = boxes.get(key);
    if (!box) { boxes.set(key, { bone, min: [...at], max: [...at] }); continue; }
    for (let c = 0; c < 3; c++) { box.min[c] = Math.min(box.min[c], at[c]); box.max[c] = Math.max(box.max[c], at[c]); }
  }
  return [...boxes.values()];
}

/** The boxes for a model's surface: as fine as MAX_BOXES lets them be. None for a model with no vertices. */
export function surfaceBoxes(file: Buffer): SurfaceBox[] {
  const ctrl = readKv3(resourceBlock(file, 'CTRL').data);
  const points = surface(file, ctrl, readKv3(resourceBlock(file, 'DATA').data));
  if (!points.length) return [];
  const span = (c: number) => { const v = points.map((p) => p.at[c]); return Math.max(...v.slice(0, 200000)) - Math.min(...v.slice(0, 200000)); };
  let size = Math.max(Math.hypot(span(0), span(1), span(2)) / 24, 2);
  let boxes = cells(points, size);
  while (boxes.length > MAX_BOXES) { size *= 1.3; boxes = cells(points, size); }
  return boxes.map((b) => ({ bone: b.bone, min: b.min.map((v) => v - SHELL), max: b.max.map((v) => v + SHELL) }));
}

// numbers in the oldest types a block can have, since a wearable's block can be version 2
const double = (v: number): Kv3Node => { const raw = Buffer.alloc(8); raw.writeDoubleLE(v); return { kind: 'number', type: 5, cell: null, typeAt: null, raw }; };
const int = (v: number): Kv3Node => { const raw = Buffer.alloc(4); raw.writeInt32LE(v); return { kind: 'number', type: 11, cell: null, typeAt: null, raw }; };
const uint = (v: number): Kv3Node => { const raw = Buffer.alloc(4); raw.writeUInt32LE(v >>> 0); return { kind: 'number', type: 12, cell: null, typeAt: null, raw }; };
const word = (value: string): Kv3Node => ({ kind: 'string', value });
const vector = (v: number[]): Kv3Node => ({ kind: 'array', items: v.map(double), element: { type: 5 } });
const object = (o: Record<string, Kv3Node>): Kv3Node => ({ kind: 'object', members: new Map(Object.entries(o)) });

function hitbox(b: SurfaceBox, index: number): Kv3Node {
  return object({
    m_name: word(`surface_${index}`), m_sSurfaceProperty: word('default'), m_sBoneName: word(b.bone),
    m_vMinBounds: vector(b.min), m_vMaxBounds: vector(b.max), m_flShapeRadius: double(0),
    m_nBoneNameHash: uint(nameHash(b.bone)), m_nGroupId: int(0), m_nShapeType: int(0),
    m_bTranslationOnly: { kind: 'other', type: 14 }, m_CRC: uint(0),
    m_cRenderColor: { kind: 'array', items: [0, 0, 0, 0].map(int), element: { type: 11 } },
    m_nHitBoxIndex: int(index),
  });
}

const hitboxSet = (name: string, boxes: SurfaceBox[]): Kv3Node => object({
  key: word(name),
  value: object({
    m_name: word(name), m_nNameHash: uint(nameHash(name)),
    m_HitBoxes: { kind: 'array', items: boxes.map(hitbox), element: { type: 9 } },
  }),
});

/**
 * The model's bones under these boxes flagged for hitboxes. Stock items have the flag, a store
 * weapon's one bone may not: Blackthorn's boxes were in the file and the game drew nothing on them.
 */
function flagged(model: Buffer, boxes: SurfaceBox[]): Buffer {
  const block = resourceBlock(model, 'DATA');
  const kv = readKv3(block.data);
  const skeleton = member(kv.root, 'm_modelSkeleton');
  const flags = items(member(skeleton, 'm_nFlag'));
  const used = new Set(boxes.map((b) => b.bone));
  items(member(skeleton, 'm_boneName')).forEach((name, i) => {
    const flag = flags[i];
    if (used.has(text(name)) && flag?.kind === 'number') setNumber(kv, flag, numberOf(kv, flag) | HITBOX_BONE);
  });
  return block.replace(kv.encode());
}

/**
 * `model` with its surface boxes as a hitbox set under each of `names` on each of its meshes, or null
 * for a model this cannot read or that has no vertices of its own. A set it already has stays.
 */
export function withSurfaceHitboxes(model: Buffer, names: string[] = [SURFACE_SET]): Buffer | null {
  try {
    const boxes = surfaceBoxes(model);
    if (!boxes.length) return null;
    const ctrl = readKv3(resourceBlock(model, 'CTRL').data);
    const blocks = resourceBlocks(model);
    let out = model;
    for (const mesh of items(member(ctrl.root, 'embedded_meshes'))) {
      const index = num(ctrl, member(mesh, 'm_nDataBlock') ?? member(mesh, 'data_block'));
      if (index < 0) continue;
      const nth = blocks.slice(0, index).filter((b) => b.name === blocks[index].name).length;
      const block = resourceBlock(out, blocks[index].name, nth);
      const kv = readKv3(block.data);
      if (kv.root.kind !== 'object') return null;
      const sets = kv.root.members.get('m_hitboxsets');
      const old = items(sets);
      const have = new Set(old.map((s) => text(member(s, 'key')).toLowerCase()));
      kv.root.members.set('m_hitboxsets', {
        kind: 'array',
        items: [...old, ...names.filter((n) => !have.has(n.toLowerCase())).map((n) => hitboxSet(n, boxes))],
        element: { type: 9 },
      });
      out = block.replace(writeKv3(kv));
    }
    return flagged(out, boxes);
  } catch {
    return null;
  }
}
