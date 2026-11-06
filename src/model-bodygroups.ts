/**
 * A model with some of its body groups shown differently by default.
 *
 * An item hides parts of the hero through `bodygroup_visibility`: Sniper's hats take his head group
 * to its second choice, which has no hair. The game reads that from its table. A model says the same
 * for itself: each mesh belongs to a choice of a group, `m_meshGroups` names the choices
 * ("head_@1_#&1" is choice 1 of "head"), and `m_nDefaultMeshGroupMask` holds a bit per choice. So a
 * file can make any choice the model's own default, and no line of the table is needed.
 */
import { numberOf, readKv3, setNumber, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock } from './resource.ts';

const CHOICE = /^(.+?)_@(\d+)_/;
/** The bits a mask can hold exactly in the number this reads it into. */
const SAFE_BITS = 52;

/**
 * The model with these groups set, or null when it has none of them.
 * @param groups  the group's name and the choice to make
 */
export function withBodygroups(model: Buffer, groups: Map<string, number>): Buffer | null {
  const block = resourceBlock(model, 'DATA');
  const kv = readKv3(block.data);
  const root = kv.root.kind === 'object' ? kv.root.members : null;
  const names = root?.get('m_meshGroups');
  const held = root?.get('m_nDefaultMeshGroupMask') as Kv3Node | undefined;
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
  if (!did) return null;
  if (!setNumber(kv, held, Number(mask))) return null;
  return block.replace(writeKv3(kv));
}
