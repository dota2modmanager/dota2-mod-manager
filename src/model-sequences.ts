/**
 * A model put under another model's path that numbers its sequences as that one does.
 *
 * Online the server picks a unit's animation in its own copy of the plain model and sends the
 * client a number: the place of the sequence in the model's name list (ASEQ
 * m_localSequenceNameArray), which also counts the clips a sequence plays under a name of its own.
 * A model from an item lists them in an order of its own. Infernus, Invoker's forged spirit, has 24
 * names where the plain spirit has 8, and number 2, the plain idle, is its turn_center: put under
 * the plain path as it is, the spirit would play its turns for its idle in a lobby.
 *
 * So the plain model's names come first, in the plain order, each matched to the item's sequence of
 * the same name (written any case, with or without underscores) or, failing that, of the same
 * activity (the plain run is Infernus's runx); the rest
 * follow in their own order, and every reference into the list is moved with its entry.
 */
import { readKv3, numberOf, setNumber, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';

type Num = Extract<Kv3Node, { kind: 'number' }>;
const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);
const items = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);
const text = (n: Kv3Node | undefined) => (n?.kind === 'string' ? n.value : '');

/** A sequence's name and the activity it plays (the first ACT_ of its list), or null for none. */
function described(kv: Kv3Block) {
  return items(member(kv.root, 'm_localS1SeqDescArray')).map((d) => ({
    name: text(member(d, 'm_sName')),
    act: items(member(d, 'm_activityArray')).map((a) => text(member(a, 'm_name'))).find((n) => n.startsWith('ACT_')) ?? null,
    desc: d,
  }));
}

/** The numbers in a sequence that point into the name list: what it fetches and the layers it plays. */
function pointers(desc: Kv3Node): { node: Num; set(n: Num): void }[] {
  const out: { node: Num; set(n: Num): void }[] = [];
  const refs = member(member(desc, 'm_fetch'), 'm_localReferenceArray');
  if (refs?.kind === 'array') {
    refs.items.forEach((r, i) => { if (r.kind === 'number') out.push({ node: r, set: (n) => { refs.items[i] = n; } }); });
  }
  for (const layer of items(member(desc, 'm_autoLayerArray'))) {
    const r = member(layer, 'm_nLocalReference');
    if (r?.kind === 'number' && layer.kind === 'object') out.push({ node: r, set: (n) => { layer.members.set('m_nLocalReference', n); } });
  }
  return out;
}

/** A number written anew, for one stored as its type alone (a 0 or 1), which cannot take another value. */
const madeInt = (v: number): Num => {
  const raw = Buffer.alloc(4);
  raw.writeInt32LE(v);
  return { kind: 'number', type: 11, cell: null, typeAt: null, raw };
};

/**
 * `model` with its sequences numbered as `plain` numbers its own, or null where that cannot be
 * done: a plain sequence with nothing in the model to stand for it, a list either one has not got,
 * or sequences of kinds this does not move the references of (multi, synth, command).
 */
export function numberedAs(model: Buffer, plain: Buffer): Buffer | null {
  try {
    if (![model, plain].every((f) => resourceBlocks(f).some((b) => b.name === 'ASEQ'))) return null;
    const theirs = readKv3(resourceBlock(plain, 'ASEQ').data);
    const block = resourceBlock(model, 'ASEQ');
    const kv = readKv3(block.data);
    const list = member(kv.root, 'm_localSequenceNameArray');
    const plainList = member(theirs.root, 'm_localSequenceNameArray');
    if (list?.kind !== 'array' || plainList?.kind !== 'array') return null;
    for (const key of ['m_localMultiSeqDescArray', 'm_localSynthAnimDescArray', 'm_localCmdSeqDescArray']) {
      if (items(member(kv.root, key)).length) return null;
    }
    const names = list.items.map(text);
    const wanted = plainList.items.map(text);
    if (names.length === wanted.length && names.every((n, i) => n === wanted[i])) return model;

    const plainActs = new Map(described(theirs).map((s) => [s.name, s.act]));
    const seqs = described(kv);
    const used = new Set<number>();
    const order: number[] = [];
    // "bindPose" is "bind_pose" in half of Invoker's spirits, and it plays no activity to find it by
    const loose = (n: string) => n.toLowerCase().replace(/[^a-z0-9@]/g, '');
    for (const name of wanted) {
      let at = names.indexOf(name);
      if (at !== -1 && used.has(at)) at = -1;
      if (at === -1) at = names.findIndex((n, i) => !used.has(i) && loose(n) === loose(name));
      if (at === -1) {
        const act = plainActs.get(name);
        // a sequence of its own name before one played through another ("@forge_spirit_runx")
        const same = act ? seqs.filter((s) => s.act === act && !used.has(names.indexOf(s.name))) : [];
        const pick = same.find((s) => !s.name.startsWith('@')) ?? same[0];
        at = pick ? names.indexOf(pick.name) : -1;
      }
      if (at === -1) return null;
      used.add(at);
      order.push(at);
    }
    names.forEach((_, i) => { if (!used.has(i)) order.push(i); });
    const placeOf = new Map(order.map((old, place) => [old, place]));

    for (const s of seqs) {
      for (const p of pointers(s.desc)) {
        const old = numberOf(kv, p.node);
        if (old < 0) continue;
        const place = placeOf.get(old);
        if (place === undefined) return null;
        if (place !== old && !setNumber(kv, p.node, place)) p.set(madeInt(place));
      }
    }
    list.items = order.map((i) => list.items[i]);
    return block.replace(writeKv3(kv));
  } catch {
    return null;
  }
}
