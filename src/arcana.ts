/**
 * An arcana as a mod, built from the game's own files: the look of an item a player has not got,
 * in a colour they choose, in safe mode (issue #118, starting with Terrorblade).
 *
 * In the game the arcana is an item: the hero's model is swapped for the arcana's, the item creates
 * its own particles, and a gem tints the rest (src/recolor.ts). A mod cannot give an item, so it
 * puts the arcana's files where the plain hero's are:
 * - the arcana's models under the names of the hero's own, each named inside for the path it now
 *   has; the hero's model also told to play its arcana animations, which in the game the item
 *   turns on as the activity modifier "abysm" (issue #118: without it, an attack played the
 *   injured one);
 * - a particle the hero already creates, taken from the arcana's version and given the arcana's
 *   own particles as children, since nothing else would create them; the children are named in
 *   the file's RERL block too, as the compiler names them. A child is drawn at the control points
 *   its parent hands it, so a new one gets a point of its own on the attachment it needs (the
 *   glow of the body on the chest, where the eyes would put it at the right eye);
 * - the arcana's portraits and ability icons under the plain ones' names;
 * - its versions of other items' particles, which it swaps in while both are worn, under theirs;
 * - no gem, so its tint is off: the colour is written into the particles and materials instead
 *   (`bake`). Built once from Valve's files and kept in the mod, it is the same after a patch only
 *   until the files it was built from change, so the app builds it again then.
 * Not here: the kill effect (a modifier the item adds), the arcana's sounds and voice lines.
 */
import { readKv3, numberOf, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { recolorFiles, recolorResource, RECOLOR_SETS, type Rgb } from './recolor.ts';
import { dataBlock, resourceBlock, resourceBlocks, withReferences } from './resource.ts';
import { buildVpk, entryAt, sharedVpkIndex } from './vpk.ts';
import { ARCANA_SETS, type Child } from './arcana-sets.ts';

export { ARCANA_SETS, type ArcanaSet, type Child } from './arcana-sets.ts';


type Obj = Extract<Kv3Node, { kind: 'object' }>;
type Arr = Extract<Kv3Node, { kind: 'array' }>;

/** A whole number made, not read: an INT32 with its bytes. */
const int32 = (n: number): Kv3Node => { const raw = Buffer.alloc(4); raw.writeInt32LE(n); return { kind: 'number', type: 11, cell: null, typeAt: null, raw }; };

/**
 * A particle with more children: each new entry in `m_Children` is a copy of the first one there,
 * pointing at another file, and the file names them in RERL. A child with an attachment gets a
 * control point of its own: the parent hands point k to child k (C_OP_SetParentControlPointsToChildCP)
 * and binds its points to attachments in its first configuration, so both grow by one.
 */
export function withChildren(file: Buffer, children: Child[]): Buffer {
  const block = dataBlock(file);
  const kv = readKv3(block.data);
  const root = kv.root.kind === 'object' ? kv.root.members : null;
  const list = root?.get('m_Children');
  const first = list?.kind === 'array' ? list.items[0] : undefined;
  const ref = first?.kind === 'object' ? first.members.get('m_ChildRef') : undefined;
  if (!root || list?.kind !== 'array' || first?.kind !== 'object' || ref?.kind !== 'string') throw new Error('arcana: the host has no children to copy');
  for (const child of children) {
    if (child.attachment) {
      const config = (root.get('m_controlPointConfigurations') as Arr | undefined)?.items[0] as Obj | undefined;
      const drivers = config?.members.get('m_drivers') as Arr | undefined;
      const spread = ((root.get('m_PreEmissionOperators') as Arr | undefined)?.items ?? [])
        .find((o) => o.kind === 'object' && (o.members.get('_class') as { value?: string })?.value === 'C_OP_SetParentControlPointsToChildCP') as Obj | undefined;
      const count = spread?.members.get('m_nNumControlPoints');
      const k = list.items.length;
      if (!drivers || count?.kind !== 'number' || numberOf(kv, count) !== k || drivers.items.length !== k) {
        throw new Error('arcana: the host does not hand its children control points one by one');
      }
      const binds = (d: Kv3Node, ...keys: string[]) => d.kind === 'object' && keys.every((x) => d.members.has(x));
      const like = (drivers.items.find((d) => binds(d, 'm_attachmentName', 'm_iControlPoint')) ?? drivers.items.find((d) => binds(d, 'm_attachmentName'))) as Obj | undefined;
      const name = like?.members.get('m_attachmentName');
      if (!like || name?.kind !== 'string') throw new Error('arcana: the host binds no control point to an attachment');
      const driver = new Map(like.members);
      driver.set('m_iControlPoint', int32(k));
      driver.set('m_attachmentName', { ...name, value: child.attachment });
      drivers.items.push({ kind: 'object', members: driver } as Kv3Node);
      spread!.members.set('m_nNumControlPoints', int32(k + 1));
    }
    const members = new Map(first.members);
    members.set('m_ChildRef', { ...ref, value: child.path });
    list.items.push({ kind: 'object', members } as Kv3Node);
  }
  return withReferences(block.replace(writeKv3(kv)), children.map((c) => c.path));
}

/** The highest control point the operators name, -1 for none. A point set with no number is 1. */
function usedPoints(kv: Kv3Block, ops: Obj[]): number {
  let top = -1;
  for (const o of ops) {
    if ((o.members.get('_class') as { value?: string } | undefined)?.value === 'C_OP_SetSingleControlPointPosition' && !o.members.has('m_nCP1')) top = Math.max(top, 1);
    for (const [key, v] of o.members) if (v.kind === 'number' && /^m_n\w*(CP|ControlPoint)\w*$/.test(key)) top = Math.max(top, numberOf(kv, v));
  }
  return top;
}

/**
 * A particle with one more child, drawn at an attachment its parent did not bind: the host binds a
 * new control point to it in its first configuration, and hands that point to the child as its
 * first (C_OP_SetParentControlPointsToChildCP, which counts children from the first, so the new one
 * goes first and the others keep the points they had). For a host withChildren cannot extend:
 * Terrorblade's metamorphosis binds 17 points and hands none.
 */
export function withChildAt(file: Buffer, child: string, attachment: string): Buffer {
  const block = dataBlock(file);
  const kv = readKv3(block.data);
  const root = kv.root.kind === 'object' ? kv.root.members : null;
  const list = root?.get('m_Children') as Arr | undefined;
  const first = list?.items[0] as Obj | undefined;
  const drivers = ((root?.get('m_controlPointConfigurations') as Arr | undefined)?.items[0] as Obj | undefined)?.members.get('m_drivers') as Arr | undefined;
  // a driver with no m_iControlPoint binds the first point (Techies' ambient has only that one)
  const binds = (d: Kv3Node, ...keys: string[]) => d.kind === 'object' && keys.every((x) => d.members.has(x));
  const like = (drivers?.items.find((d) => binds(d, 'm_attachmentName', 'm_iControlPoint')) ?? drivers?.items.find((d) => binds(d, 'm_attachmentName'))) as Obj | undefined;
  const ref = first?.kind === 'object' ? first.members.get('m_ChildRef') : undefined;
  const name = like?.members.get('m_attachmentName');
  if (!root || !list || first?.kind !== 'object' || ref?.kind !== 'string' || !drivers || !like || name?.kind !== 'string') {
    throw new Error('arcana: the host binds no control point to an attachment');
  }
  const pre = root.get('m_PreEmissionOperators') as Arr | undefined;
  const ops = (pre?.items ?? []).filter((o): o is Obj => o.kind === 'object');
  if (ops.some((o) => (o.members.get('_class') as { value?: string } | undefined)?.value === 'C_OP_SetParentControlPointsToChildCP')) {
    throw new Error('arcana: the host already hands its children points');
  }
  // a point nobody uses: the host's own operators may place points it never binds (Techies' ambient
  // sets 1 and 2 beside the cart), and the new one must not land on them
  const point = Math.max(drivers.items.length, usedPoints(kv, ops) + 1);
  const driver = new Map(like.members);
  driver.set('m_iControlPoint', int32(point));
  driver.set('m_attachmentName', { ...name, value: attachment });
  drivers.items.push({ kind: 'object', members: driver });
  const members = new Map(first.members);
  members.set('m_ChildRef', { ...ref, value: child }); // the copy keeps its flag: a resource it names
  list.items.unshift({ kind: 'object', members });
  const hand = new Map<string, Kv3Node>([['_class', { kind: 'string', value: 'C_OP_SetParentControlPointsToChildCP' }],
    ['m_nNumControlPoints', int32(1)], ['m_nFirstSourcePoint', int32(point)]]);
  if (pre) pre.items.push({ kind: 'object', members: hand });
  else root.set('m_PreEmissionOperators', { ...list, items: [{ kind: 'object', members: hand }] });
  return withReferences(block.replace(writeKv3(kv)), [child]);
}

/**
 * The forms' particles for the items among `items` (the builder's picks): each host from `files`
 * (a base's, in colour) or the game, with the item's particle hung on it, and that particle in the
 * chosen colour under its own path. A host that cannot take it stays as it was.
 */
export function arcanaForms(pak01: string, set: string, target: Rgb, items: string[], files: Map<string, Buffer>, log: (msg: string) => void = () => {}): void {
  const def = ARCANA_SETS[set];
  const index = sharedVpkIndex(pak01);
  for (const f of def?.forms || []) {
    if (!items.includes(f.item)) continue;
    const host = files.get(f.at) ?? index.read(f.at);
    const child = index.read(`${f.child}_c`);
    if (!host || !child) continue;
    try {
      files.set(f.at, withChildAt(host, f.child, f.attachment));
      files.set(`${f.child}_c`, recolorResource(child, target, { gem: RECOLOR_SETS[def.recolor].gem, bake: true }).file);
    } catch (err) {
      log(`arcana: ${f.child} not hung on ${f.at}: ${(err as Error).message}`);
    }
  }
}

const nameOf = (n: Kv3Node | undefined) => {
  const v = n?.kind === 'object' ? n.members.get('m_name') : undefined;
  return v?.kind === 'string' ? v.value : '';
};

/**
 * In a list of sequences or animation clips, the ones that need `modifier` made the ones their
 * activities play: the modifier taken off them, and their activity off the plain ones beside them
 * (death, sunder, loadout), which is the choice the game makes when the modifier is on.
 * @returns whether anything changed
 */
function playWithout(list: Kv3Node[], modifier: string): boolean {
  const activities = (x: Kv3Node) => {
    const a = x.kind === 'object' ? x.members.get('m_activityArray') : undefined;
    return a?.kind === 'array' ? a : null;
  };
  const isAct = (a: Kv3Node) => nameOf(a).startsWith('ACT_');
  const needed = new Set<Kv3Node>();
  const taken = new Set<string>();
  for (const x of list) {
    const acts = activities(x);
    if (!acts?.items.some((a) => nameOf(a) === modifier)) continue;
    needed.add(x);
    for (const a of acts.items) if (isAct(a)) taken.add(nameOf(a));
    acts.items = acts.items.filter((a) => nameOf(a) !== modifier);
  }
  for (const x of list) {
    const acts = activities(x);
    if (!acts || needed.has(x) || acts.items.some((a) => !isAct(a))) continue;
    acts.items = acts.items.filter((a) => !taken.has(nameOf(a)));
  }
  return needed.size > 0;
}

/**
 * A model put under another path that plays without the item what it played with it: its
 * animations that need `modifier` made the ones its activities play (playWithout).
 *
 * A sequence and an animation clip each list the activity they play (ACT_DOTA_ATTACK) and after it
 * the modifiers they need ("abysm"). The game picks by the clips' lists (ANIM): with "abysm" taken
 * off the sequences alone, the arcana still stood still through its attacks, and the plain hero
 * still swung with its sequences pointed elsewhere (both found on the bench, issue #118). An entry
 * pointed at the activity instead of taken off counts as a modifier: the entries are taken off, and
 * both blocks written anew.
 */
export function asModel(file: Buffer, modifier?: string): Buffer {
  if (!modifier) return file;
  let out = file;
  for (const [name, listKey] of [['ASEQ', 'm_localS1SeqDescArray'], ['ANIM', 'm_animArray']]) {
    if (!resourceBlocks(out).some((b) => b.name === name)) continue;
    const block = resourceBlock(out, name);
    const kv = readKv3(block.data);
    const list = kv.root.kind === 'object' ? kv.root.members.get(listKey) : undefined;
    if (list?.kind === 'array' && playWithout(list.items, modifier)) out = block.replace(writeKv3(kv));
  }
  return out;
}

/** The arcana's portraits and ability icons out of pak01, under the plain ones' names. */
export function arcanaPictures(pak01: string, set: string): Map<string, Buffer> {
  const def = ARCANA_SETS[set];
  if (!def) throw new Error(`arcana: no set ${set}`);
  // the one the item builder holds: an open of the game's index is 270 ms, and this made two
  const index = sharedVpkIndex(pak01);
  const all = [...index.paths()];
  const have = new Set(all);
  const files = new Map<string, Buffer>();
  const { under, mark, hero } = def.images;
  for (const p of all) {
    if (!under.some((u) => p.startsWith(u)) || !p.includes(hero) || !p.includes(mark)) continue;
    const plain = p.replace(mark, '');
    if (have.has(plain)) files.set(plain, index.read(p) as Buffer);
  }
  return files;
}

/**
 * The arcana's versions of other items' particles, under those items' paths and in the chosen
 * colour: nothing in the game swaps them without the item. What the swapped-in particle hangs
 * below keeps its own path, which the recolour (or a base) covers.
 */
export function arcanaSwaps(pak01: string, set: string, target: Rgb): Map<string, Buffer> {
  const def = ARCANA_SETS[set];
  const index = sharedVpkIndex(pak01);
  const files = new Map<string, Buffer>();
  for (const [at, from] of Object.entries(def?.swaps || {})) {
    const data = index.read(from);
    if (data) files.set(at, recolorResource(data, target, { gem: RECOLOR_SETS[def.recolor].gem, bake: true }).file);
  }
  return files;
}

/** The arcana in the chosen colour, as one VPK from the game's pak01 (but the paths `skip` names, lowercased). */
export function buildArcana({ pak01, set, target, skip, forms = [] }: { pak01: string; set: string; target: Rgb; skip?: (p: string) => boolean; forms?: string[] }): {
  vpk: Buffer; files: number; changed: number; failed: { path: string; error: string }[];
} {
  const def = ARCANA_SETS[set];
  if (!def) throw new Error(`arcana: no set ${set}`);
  const index = sharedVpkIndex(pak01);
  const r = recolorFiles({ pak01, set: def.recolor, target, bake: true });
  const files = r.files;
  for (const [to, { from, modifier }] of Object.entries(def.models)) files.set(to, asModel(index.read(from) as Buffer, modifier));
  for (const [p, data] of arcanaPictures(pak01, set)) files.set(p, data);
  for (const [p, data] of arcanaSwaps(pak01, set, target)) files.set(p, data);
  const from = index.read(def.host.from) as Buffer;
  const host = def.host.bind
    ? def.host.children.reduce((f, c) => withChildAt(f, c.path, c.attachment || ''), from)
    : withChildren(from, def.host.children);
  files.set(def.host.at, recolorResource(host, target, { gem: RECOLOR_SETS[def.recolor].gem, bake: true }).file);
  arcanaForms(pak01, set, target, forms, files);
  for (const p of files.keys()) if (skip?.(p.toLowerCase())) files.delete(p);
  return { vpk: buildVpk([...files].map(([p, f]) => entryAt(p, f))), files: files.size, changed: r.changed, failed: r.failed };
}
