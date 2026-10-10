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
 * - no gem, so its tint is off: the colour is written into the particles and materials instead
 *   (`bake`). Built once from Valve's files and kept in the mod, it is the same after a patch only
 *   until the files it was built from change, so the app builds it again then.
 * Not here: the kill effect (a modifier the item adds), the arcana's sounds and voice lines.
 */
import { readKv3, numberOf, setString, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { recolorFiles, recolorResource, RECOLOR_SETS, type Rgb } from './recolor.ts';
import { dataBlock, resourceBlock, withReferences } from './resource.ts';
import { buildVpk, entryAt, listVpkPathsFile, openVpkIndex } from './vpk.ts';

export interface ArcanaSet {
  /** the recolour set with the arcana's particles and materials */
  recolor: string;
  /** models to put under another name: game path -> the model in pak01, and the activity modifier
   *  the item turns on for it, whose animations are to play without it */
  models: Record<string, { from: string; modifier?: string }>;
  /** images whose name with this removed is the plain one (`_alt1`) */
  images: { under: string[]; mark: string; hero: string };
  /** a particle the hero creates, the arcana's version of it, and the arcana's own particles to hang on it */
  host: { at: string; from: string; children: Child[] };
}

/** A particle to hang on another, and the model attachment it is drawn at (none: its parent's first point). */
export interface Child { path: string; attachment?: string }

const TB = 'particles/units/heroes/hero_terrorblade';
const ARCANA = 'particles/econ/items/terrorblade/terrorblade_horns_arcana';

export const ARCANA_SETS: Record<string, ArcanaSet> = {
  'terrorblade-arcana': {
    recolor: 'terrorblade-arcana',
    models: {
      'models/heroes/terrorblade/terrorblade.vmdl_c': { from: 'models/heroes/terrorblade/terrorblade_arcana.vmdl_c', modifier: 'abysm' },
      'models/heroes/terrorblade/horns.vmdl_c': { from: 'models/heroes/terrorblade/horns_arcana.vmdl_c' },
    },
    images: { under: ['panorama/images/heroes/', 'panorama/images/spellicons/'], mark: '_alt1', hero: 'terrorblade' },
    host: {
      at: `${TB}/terrorblade_ambient_eyes.vpcf_c`,
      from: `${ARCANA}/terrorblade_ambient_eyes_arcana_horns.vpcf_c`,
      // its own preview puts it on the horns' attach_hitloc, the chest
      children: [{ path: `${ARCANA}/terrorblade_ambient_body_arcana_horns.vpcf`, attachment: 'attach_hitloc' }],
    },
  },
};

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

const nameOf = (n: Kv3Node | undefined) => {
  const v = n?.kind === 'object' ? n.members.get('m_name') : undefined;
  return v?.kind === 'string' ? v.value : '';
};

/**
 * A model put under another path that plays without the item what it played with it: its
 * animations that need `modifier` made the ones its activities play.
 *
 * A sequence lists the activities it plays (ACT_DOTA_ATTACK) and the modifiers it needs ("abysm"),
 * told apart by name alone. The game picks, for an activity, the sequence whose modifiers match the
 * ones on: with "abysm" never on, the arcana's attacks lost to "attack_injured". So the modifier's
 * entry is pointed at the sequence's activity instead, and the activity of the plain ones beside
 * them (death, sunder, loadout) at their own name, which no activity is: the choice the game makes
 * when the modifier is on.
 *
 * Only string indexes change, where they lie; every other byte stays the game's. Written anew from
 * the tree, typed or not, the sequences were still read and the game played none of them, and the
 * skeleton's arrays in DATA the same: the arcana stood still through its attacks (issue #118).
 */
export function asModel(file: Buffer, modifier?: string): Buffer {
  if (!modifier) return file;
  const block = resourceBlock(file, 'ASEQ');
  const seqs = readKv3(block.data);
  const list = seqs.root.kind === 'object' ? seqs.root.members.get('m_localS1SeqDescArray') : undefined;
  if (list?.kind !== 'array') return file;
  const activities = (sq: Kv3Node) => {
    const a = sq.kind === 'object' ? sq.members.get('m_activityArray') : undefined;
    return a?.kind === 'array' ? a.items : [];
  };
  const point = (entry: Kv3Node, to: string) => {
    const name = entry.kind === 'object' ? entry.members.get('m_name') : undefined;
    if (name?.kind !== 'string' || !setString(seqs, name, to)) throw new Error(`arcana: "${nameOf(entry)}" cannot be pointed at "${to}"`);
  };
  const isAct = (a: Kv3Node) => nameOf(a).startsWith('ACT_');
  const needed = new Set<Kv3Node>();
  const taken = new Set<string>();
  for (const sq of list.items) {
    const acts = activities(sq);
    const act = acts.find(isAct);
    const mod = acts.find((a) => nameOf(a) === modifier);
    if (!act || !mod) continue;
    needed.add(sq);
    for (const a of acts) if (isAct(a)) taken.add(nameOf(a));
    point(mod, nameOf(act));
  }
  // the plain ones beside them, with no modifier of their own: their activity is the arcana's now
  for (const sq of list.items) {
    const acts = activities(sq);
    if (needed.has(sq) || acts.some((a) => !isAct(a))) continue;
    const own = sq.kind === 'object' ? sq.members.get('m_sName') : undefined;
    for (const a of acts) if (taken.has(nameOf(a)) && own?.kind === 'string') point(a, own.value);
  }
  return block.replace(seqs.encode());
}

/** The arcana in the chosen colour, as one VPK from the game's pak01. */
export function buildArcana({ pak01, set, target }: { pak01: string; set: string; target: Rgb }): {
  vpk: Buffer; files: number; changed: number; failed: { path: string; error: string }[];
} {
  const def = ARCANA_SETS[set];
  if (!def) throw new Error(`arcana: no set ${set}`);
  const index = openVpkIndex(pak01);
  const all = listVpkPathsFile(pak01);
  const have = new Set(all);
  const r = recolorFiles({ pak01, set: def.recolor, target, bake: true });
  const files = r.files;
  for (const [to, { from, modifier }] of Object.entries(def.models)) files.set(to, asModel(index.read(from) as Buffer, modifier));
  const { under, mark, hero } = def.images;
  for (const p of all) {
    if (!under.some((u) => p.startsWith(u)) || !p.includes(hero) || !p.includes(mark)) continue;
    const plain = p.replace(mark, '');
    if (have.has(plain)) files.set(plain, index.read(p) as Buffer);
  }
  const host = withChildren(index.read(def.host.from) as Buffer, def.host.children);
  files.set(def.host.at, recolorResource(host, target, { gem: RECOLOR_SETS[def.recolor].gem, bake: true }).file);
  return { vpk: buildVpk([...files].map(([p, f]) => entryAt(p, f))), files: files.size, changed: r.changed, failed: r.failed };
}
