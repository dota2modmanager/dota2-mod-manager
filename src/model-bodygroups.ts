/**
 * A model with some of its body groups shown differently by default.
 *
 * An item hides parts of the hero through `bodygroup_visibility`: Sniper's hats take his head group
 * to its second choice, which has no hair. The game reads that from its table. A model says the same
 * for itself: each mesh belongs to a choice of a group, `m_meshGroups` names the choices
 * ("head_@1_#&1" is choice 1 of "head"), and `m_nDefaultMeshGroupMask` holds a bit per choice. So a
 * file can make any choice the model's own default, and no line of the table is needed.
 */
import { numberOf, readKv3, setNumber, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock } from './resource.ts';

type Num = Extract<Kv3Node, { kind: 'number' }>;
const CHOICE = /^(.+?)_@(\d+)_/;
/** The bits a mask can hold exactly in the number this reads it into. */
const SAFE_BITS = 52;

/** The default mask with these groups set; null when the model has none of them. */
function maskWith(kv: Kv3Block, groups: Map<string, number>): { held: Num; mask: bigint } | null {
  const root = kv.root.kind === 'object' ? kv.root.members : null;
  const names = root?.get('m_meshGroups');
  const held = root?.get('m_nDefaultMeshGroupMask');
  if (names?.kind !== 'array' || held?.kind !== 'number' || names.items.length > SAFE_BITS) return null;
  let mask = BigInt(Math.round(numberOf(kv, held) ?? 0));
  let did = false;
  names.items.forEach((n, bit) => {
    const m = n.kind === 'string' ? CHOICE.exec(n.value) : null;
    const want = m ? groups.get(m[1].toLowerCase()) : undefined;
    if (!m || want === undefined) return;
    const on = BigInt(1) << BigInt(bit);
    mask = Number(m[2]) === want ? mask | on : mask & ~on;
    did = true;
  });
  return did ? { held, mask } : null;
}

/**
 * The model with these groups set, or null when it has none of them.
 * @param groups  the group's name and the choice to make
 */
export function withBodygroups(model: Buffer, groups: Map<string, number>): Buffer | null {
  const block = resourceBlock(model, 'DATA');
  const kv = readKv3(block.data);
  const made = maskWith(kv, groups);
  if (!made || !setNumber(kv, made.held, Number(made.mask))) return null;
  return block.replace(writeKv3(kv));
}

/**
 * The model with nothing to draw. A stock item's second model comes from the table whatever goes
 * under the item's path, so a pick without one leaves that file empty. Null: not a model this reads.
 */
export function withoutMeshes(model: Buffer): Buffer | null {
  const block = resourceBlock(model, 'DATA');
  const kv = readKv3(block.data);
  const root = kv.root.kind === 'object' ? kv.root.members : null;
  const masks = root?.get('m_refMeshGroupMasks');
  const held = root?.get('m_nDefaultMeshGroupMask');
  if (masks?.kind !== 'array' || held?.kind !== 'number') return null;
  const all = [held, ...masks.items];
  if (!all.every((n) => n.kind === 'number' && setNumber(kv, n, 0))) return null;
  return block.replace(writeKv3(kv));
}

/**
 * The names of the meshes these groups turn off: the toolchain exports every mesh of a model
 * whatever its mask, so the 3D preview hides them by name.
 */
export function hiddenMeshes(model: Buffer, groups: Map<string, number>): string[] {
  const kv = readKv3(resourceBlock(model, 'DATA').data);
  const made = maskWith(kv, groups);
  const masks = kv.root.kind === 'object' ? kv.root.members.get('m_refMeshGroupMasks') : null;
  if (!made || masks?.kind !== 'array') return [];
  const ctrl = readKv3(resourceBlock(model, 'CTRL').data);
  const list = ctrl.root.kind === 'object' ? ctrl.root.members.get('embedded_meshes') : null;
  if (list?.kind !== 'array') return [];
  return list.items.flatMap((m) => {
    if (m.kind !== 'object') return [];
    const field = (a: string, b: string) => m.members.get(a) ?? m.members.get(b);
    const name = field('name', 'm_Name');
    const index = field('mesh_index', 'm_nMeshIndex');
    const bits = masks.items[index?.kind === 'number' ? numberOf(ctrl, index) ?? 0 : 0];
    if (name?.kind !== 'string' || bits?.kind !== 'number') return [];
    return (BigInt.asUintN(64, BigInt(Math.round(numberOf(kv, bits) ?? 0))) & made.mask) === BigInt(0) ? [name.value.toLowerCase()] : [];
  });
}
