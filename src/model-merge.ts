/**
 * Two models as one file: the mesh of a second model carried inside the first.
 *
 * An item can wear a second model (`additional_wearable`): Death Prophet's skirts bring their
 * spirits, Phoenix's wings their fire. The game makes that second wearable from its table, and a
 * pick that goes as files has only its slot's one stock path to sit under. A compiled model keeps
 * its meshes inside itself, each mesh a pair of blocks that `CTRL.embedded_meshes` names, so the
 * second model's blocks can come along:
 *  - its blocks are added to the file and named in CTRL, under the next mesh index;
 *  - DATA gets a line for the mesh in its group and LOD masks, the same as the first mesh's;
 *  - a bone the first model lacks joins its skeleton, under the parent it had. A vertex names its
 *    bones through `m_remappingTable`, so the mesh keeps its own numbering and only its table is
 *    rewritten to the joined skeleton;
 *  - its materials join the resources the file names, and every material set, which keep the same
 *    length and order (src/model-skin.ts).
 *
 * A wearable follows the hero by bone name, so what is merged follows as it did by itself. Its own
 * clips stay behind, and a second model with morphs is refused, as is the older mesh layout.
 */
import { numberOf, readKv3, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { references, resourceBlock, resourceBlocks, withReferences } from './resource.ts';

const align16 = (n: number) => Math.ceil(n / 16) * 16;
/** KV3's type of a plain 32-bit number. */
const INT32 = 11;
type Num = Extract<Kv3Node, { kind: 'number' }>;
type Arr = Extract<Kv3Node, { kind: 'array' }>;

const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);
const items = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);
const array = (n: Kv3Node | undefined): Arr | null => (n?.kind === 'array' ? n : null);
const int = (kv: Kv3Block, n: Kv3Node | undefined) => (n?.kind === 'number' ? numberOf(kv, n) ?? 0 : 0);

/** A number of the same kind as `like`, holding `v`. */
function numberLike(like: Num, v: number): Num {
  // a 0 or a 1 written as a type alone holds no bytes to copy the width of
  if (!like.cell && !like.raw) return { kind: 'number', type: INT32, cell: null, typeAt: null, raw: Buffer.from(new Int32Array([v]).buffer) };
  const width = like.cell?.width ?? like.raw?.length ?? 4;
  const raw = Buffer.alloc(width);
  if (like.cell?.float) { if (width === 4) raw.writeFloatLE(v); else raw.writeDoubleLE(v); }
  else if (width === 1) raw.writeInt8(v);
  else if (width === 2) raw.writeInt16LE(v);
  else if (width === 4) raw.writeInt32LE(v);
  else raw.writeBigInt64LE(BigInt(v));
  return { ...like, cell: null, typeAt: null, raw };
}

/** A node of another file, standing by itself: a number keeps its bytes, not a place in that file. */
function detached(kv: Kv3Block, n: Kv3Node): Kv3Node {
  if (n.kind === 'number') {
    const c = n.cell;
    return { ...n, cell: null, typeAt: null, raw: n.raw ?? (c ? Buffer.from(kv.buffers[c.buffer].subarray(c.offset, c.offset + c.width)) : undefined) };
  }
  if (n.kind === 'array') return { ...n, items: n.items.map((x) => detached(kv, x)) };
  if (n.kind === 'object') return { ...n, members: new Map([...n.members].map(([k, v]) => [k, detached(kv, v)])) };
  return n;
}

/** The file with these blocks after its own, each on a 16-byte line, as the compiler lays them. */
export function withBlocks(file: Buffer, blocks: { name: string; data: Buffer }[]): Buffer {
  const table = 8 + file.readUInt32LE(8);
  const count = file.readUInt32LE(12);
  const end = table + count * 12;
  const shift = align16(blocks.length * 12);
  const parts: Buffer[] = [];
  let at = align16(file.length + shift);
  const entries = Buffer.alloc(shift);
  const tail: Buffer[] = [Buffer.alloc(at - (file.length + shift))];
  blocks.forEach((b, i) => {
    const e = i * 12;
    entries.write(b.name, e, 'ascii');
    entries.writeUInt32LE(at - (end + e + 4), e + 4);
    entries.writeUInt32LE(b.data.length, e + 8);
    const room = i === blocks.length - 1 ? b.data.length : align16(b.data.length);
    tail.push(b.data, Buffer.alloc(room - b.data.length));
    at += room;
  });
  parts.push(file.subarray(0, end), entries, file.subarray(end), ...tail);
  const out = Buffer.concat(parts);
  for (let k = 0; k < count; k++) out.writeUInt32LE(out.readUInt32LE(table + k * 12 + 4) + shift, table + k * 12 + 4);
  out.writeUInt32LE(count + blocks.length, 12);
  out.writeUInt32LE(out.length, 0);
  return out;
}

/** The skeleton's arrays joined: bones of `from` that `to` lacks go on the end. A bone's new number, by its number in `from`. */
function joinSkeleton(to: Kv3Block, from: Kv3Block): number[] | null {
  const a = member(to.root, 'm_modelSkeleton');
  const b = member(from.root, 'm_modelSkeleton');
  const names = array(member(a, 'm_boneName'));
  const added = items(member(b, 'm_boneName'));
  const parents = array(member(a, 'm_nParent'));
  const first = parents?.items[0];
  if (a?.kind !== 'object' || !names || !parents || first?.kind !== 'number') return null;
  const known = new Map(names.items.map((n, i) => [n.kind === 'string' ? n.value.toLowerCase() : '', i]));
  const out: number[] = [];
  for (const [i, n] of added.entries()) {
    const key = n.kind === 'string' ? n.value.toLowerCase() : '';
    const had = known.get(key);
    if (had !== undefined) { out.push(had); continue; }
    const at = names.items.length;
    for (const [field, list] of a.members) {
      if (list.kind !== 'array') continue;
      const own = items(member(b, field))[i];
      if (!own) return null;
      const parent = int(from, own);
      list.items.push(field === 'm_nParent' ? numberLike(first, parent < 0 ? -1 : out[parent] ?? -1) : detached(from, own));
    }
    known.set(key, at);
    out.push(at);
  }
  return out;
}

/** The hints of how much a model takes in memory, grown by the other's. */
function grow(to: Kv3Block, from: Kv3Block): void {
  if (to.root.kind !== 'object') return;
  for (const key of ['pool_size_hint_mesh', 'pool_size_hint']) {
    const held = to.root.members.get(key);
    if (held?.kind === 'number') to.root.members.set(key, numberLike(held, int(to, held) + int(from, member(from.root, key))));
  }
}

/**
 * The first model with the second's meshes in it, or null where the two cannot go together.
 * @param first   the wearable's model
 * @param second  the model it brings along
 */
export function mergedModel(first: Buffer, second: Buffer): Buffer | null {
  const ctrlA = readKv3(resourceBlock(first, 'CTRL').data);
  const ctrlB = readKv3(resourceBlock(second, 'CTRL').data);
  const dataA = readKv3(resourceBlock(first, 'DATA').data);
  const dataB = readKv3(resourceBlock(second, 'DATA').data);
  const meshesA = array(member(ctrlA.root, 'embedded_meshes'));
  const meshesB = items(member(ctrlB.root, 'embedded_meshes'));
  const sample = meshesA?.items[0];
  if (!meshesA || !sample || !meshesB.length || !member(sample, 'mesh_index') || !meshesB.every((m) => member(m, 'mesh_index') && int(ctrlB, member(m, 'morph_block')) < 0)) return null;

  const groups = array(member(dataA.root, 'm_refMeshGroupMasks'));
  const lods = array(member(dataA.root, 'm_refLODGroupMasks'));
  const table = array(member(dataA.root, 'm_remappingTable'));
  const starts = array(member(dataA.root, 'm_remappingTableStarts'));
  const row = table?.items[0];
  const startAt = starts?.items[0];
  if (!groups?.items[0] || !lods?.items[0] || row?.kind !== 'number' || startAt?.kind !== 'number') return null;

  const bones = joinSkeleton(dataA, dataB);
  if (!bones) return null;

  const blocksA = resourceBlocks(first).length;
  const blocksB = resourceBlocks(second);
  const moved: { name: string; data: Buffer }[] = [];
  const carry = (index: number) => {
    const b = blocksB[index];
    if (!b) return -1;
    moved.push({ name: b.name, data: second.subarray(b.at, b.at + b.size) });
    return blocksA + moved.length - 1;
  };
  const oldTable = items(member(dataB.root, 'm_remappingTable'));
  const oldStarts = items(member(dataB.root, 'm_remappingTableStarts'));
  let index = Math.max(...meshesA.items.map((m) => int(ctrlA, member(m, 'mesh_index')))) + 1;
  for (const m of meshesB) {
    const own = int(ctrlB, member(m, 'mesh_index'));
    const made = detached(ctrlB, m);
    if (made.kind !== 'object') return null;
    const like = member(sample, 'mesh_index') as Num;
    made.members.set('mesh_index', numberLike(like, index));
    made.members.set('data_block', numberLike(like, carry(int(ctrlB, member(m, 'data_block')))));
    made.members.set('vbib_block', numberLike(like, carry(int(ctrlB, member(m, 'vbib_block')))));
    made.members.set('morph_block', numberLike(like, -1));
    meshesA.items.push(made);
    groups.items.push(groups.items[0]);
    lods.items.push(lods.items[0]);
    starts!.items.push(numberLike(startAt, table!.items.length));
    const from = int(dataB, oldStarts[own]);
    const to = own + 1 < oldStarts.length ? int(dataB, oldStarts[own + 1]) : oldTable.length;
    for (const n of oldTable.slice(from, to)) table!.items.push(numberLike(row, bones[int(dataB, n)] ?? 0));
    index += 1;
  }
  grow(ctrlA, ctrlB);

  const materials = references(second).filter((p) => /\.vmat$/i.test(p));
  for (const set of items(member(dataA.root, 'm_materialGroups'))) {
    const list = array(member(set, 'm_materials'));
    const one = list?.items[0];
    if (list && one?.kind === 'string') for (const p of materials) list.items.push({ ...one, value: p });
  }

  let out = withBlocks(first, moved);
  out = resourceBlock(out, 'CTRL').replace(writeKv3(ctrlA));
  out = resourceBlock(out, 'DATA').replace(writeKv3(dataA));
  return withReferences(out, materials);
}
