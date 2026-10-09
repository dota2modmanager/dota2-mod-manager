/**
 * An arcana as a mod, built from the game's own files: the look of an item a player has not got,
 * in a colour they choose, in safe mode (issue #118, starting with Terrorblade).
 *
 * In the game the arcana is an item: the hero's model is swapped for the arcana's, the item creates
 * its own particles, and a gem tints the rest (src/recolor.ts). A mod cannot give an item, so it
 * puts the arcana's files where the plain hero's are:
 * - the arcana's models under the names of the hero's own;
 * - a particle the hero already creates, taken from the arcana's version and given the arcana's
 *   own particles as children, since nothing else would create them; the children are named in
 *   the file's RERL block too, as the compiler names them;
 * - the arcana's portraits and ability icons under the plain ones' names;
 * - no gem, so its tint is off: the colour is written into the particles and materials instead
 *   (`bake`). Built once from Valve's files and kept in the mod, it is the same after a patch only
 *   until the files it was built from change, so the app builds it again then.
 * Not here: the kill effect (a modifier the item adds), the arcana's sounds and voice lines.
 */
import { readKv3, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { recolorFiles, recolorResource, RECOLOR_SETS, type Rgb } from './recolor.ts';
import { dataBlock, withReferences } from './resource.ts';
import { buildVpk, entryAt, listVpkPathsFile, openVpkIndex } from './vpk.ts';

export interface ArcanaSet {
  /** the recolour set with the arcana's particles and materials */
  recolor: string;
  /** files to put under another name: game path -> path in pak01 */
  copies: Record<string, string>;
  /** images whose name with this removed is the plain one (`_alt1`) */
  images: { under: string[]; mark: string; hero: string };
  /** a particle the hero creates, the arcana's version of it, and the arcana's own particles to hang on it */
  host: { at: string; from: string; children: string[] };
}

const TB = 'particles/units/heroes/hero_terrorblade';
const ARCANA = 'particles/econ/items/terrorblade/terrorblade_horns_arcana';

export const ARCANA_SETS: Record<string, ArcanaSet> = {
  'terrorblade-arcana': {
    recolor: 'terrorblade-arcana',
    copies: {
      'models/heroes/terrorblade/terrorblade.vmdl_c': 'models/heroes/terrorblade/terrorblade_arcana.vmdl_c',
      'models/heroes/terrorblade/horns.vmdl_c': 'models/heroes/terrorblade/horns_arcana.vmdl_c',
    },
    images: { under: ['panorama/images/heroes/', 'panorama/images/spellicons/'], mark: '_alt1', hero: 'terrorblade' },
    host: {
      at: `${TB}/terrorblade_ambient_eyes.vpcf_c`,
      from: `${ARCANA}/terrorblade_ambient_eyes_arcana_horns.vpcf_c`,
      children: [`${ARCANA}/terrorblade_ambient_body_arcana_horns.vpcf`],
    },
  },
};

/**
 * A particle with more children: each new entry in `m_Children` is a copy of the first one there,
 * pointing at another file, and the file names them in RERL.
 */
export function withChildren(file: Buffer, children: string[]): Buffer {
  const block = dataBlock(file);
  const kv = readKv3(block.data);
  const list = kv.root.kind === 'object' ? kv.root.members.get('m_Children') : undefined;
  const first = list?.kind === 'array' ? list.items[0] : undefined;
  const ref = first?.kind === 'object' ? first.members.get('m_ChildRef') : undefined;
  if (list?.kind !== 'array' || first?.kind !== 'object' || ref?.kind !== 'string') throw new Error('arcana: the host has no children to copy');
  for (const path of children) {
    const members = new Map(first.members);
    members.set('m_ChildRef', { ...ref, value: path });
    list.items.push({ kind: 'object', members } as Kv3Node);
  }
  return withReferences(block.replace(writeKv3(kv)), children);
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
  for (const [to, from] of Object.entries(def.copies)) files.set(to, index.read(from) as Buffer);
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
