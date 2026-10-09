/**
 * An item's effects in a colour of the user's choosing, built from the game's own files.
 *
 * Issue #118 asked for Terrorblade's arcana in any RGB. The arcana is red because it comes with a
 * gem, Reflection's Shade (#FF3C28), and the game passes a gem's colour to the hero's particles
 * through control point 15 and to its materials as `$GemColor`. Neither can be set from a mod, so
 * the mod changes what the files do with the gem's colour instead:
 *
 * - a particle that takes its colour from control point 15 scales it, channel by channel, into a
 *   range (`m_vOutputMax`); the range is scaled again by chosen / gem, so the arcana's gem comes
 *   out as the chosen colour. Plain Terrorblade has no gem, the game turns that tint off for him
 *   (control point 16), and he looks as he did;
 * - a material reads `exists($GemColor) ? $GemColor : <its own colour>`; the read becomes the
 *   chosen colour (src/material.ts) and the other branch stays;
 * - a particle only the arcana uses, with colours written in it and no gem tint, has those colours
 *   moved to the chosen one: every colour takes the chosen hue and keeps its own brightness and
 *   saturation scaled by the chosen colour's; black, white and greys stay as they are.
 */
import { readKv3, readCell, writeCell, numberOf, type Kv3Block, type Kv3Node } from './kv3.ts';
import { attributeToken, constantExpression, rewriteExpressions, withConstant } from './material.ts';
import { dataBlock } from './resource.ts';
import { buildVpk, entryAt, listVpkPathsFile, openVpkIndex } from './vpk.ts';

export type Rgb = [number, number, number];

/** What can be recoloured, by path prefix in pak01, and the colour of the gem the item comes with. */
export interface RecolorSet {
  name: string;
  gem: Rgb;
  /** particles only this item uses: colours written in them follow the chosen one */
  own: string[];
  /** particles it shares with the hero and his other items: only the gem's tint changes */
  shared: string[];
  /** materials that read the gem's colour */
  materials: string[];
}

export const RECOLOR_SETS: Record<string, RecolorSet> = {
  'terrorblade-arcana': {
    name: 'Fractal Horns of Inner Abysm',
    // items_game, colors: unusual_terrorblade_abysm, "Reflection's Shade"
    gem: [255, 60, 40],
    own: ['particles/econ/items/terrorblade/terrorblade_horns_arcana/'],
    shared: ['particles/units/heroes/hero_terrorblade/', 'particles/models/heroes/terrorblade/', 'particles/econ/items/terrorblade/'],
    materials: ['materials/models/heroes/terrorblade/', 'materials/models/items/terrorblade/'],
  },
};

/** A member name that holds a colour. Not m_bSaturateColorPreAlphaBlend: that one is a switch. */
const COLOR_KEY = /^m_(?!b)\w*(Colou?r|Tint)\w*$/i;

function toHsv([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r / 255) h = ((g - b) / 255 / d) % 6;
    else if (max === g / 255) h = (b - r) / 255 / d + 2;
    else h = (r - g) / 255 / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0, max];
}

function fromHsv([h, s, v]: [number, number, number]): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((n) => Math.round((n + m) * 255)) as Rgb;
}

/**
 * One colour moved to the chosen one. A colour with almost no saturation has no hue to move and is
 * left alone; anything else takes the target's hue, with saturation and brightness scaled by it.
 */
export function shade(color: Rgb, target: Rgb): Rgb {
  const [, s, v] = toHsv(color);
  if (s < 0.1) return color;
  const [th, ts, tv] = toHsv(target);
  return fromHsv([th, Math.min(1, s * ts), Math.min(1, v * tv)]);
}

/** The operators that colour a particle from control point 15, where the game puts a gem's colour. */
const GEM_TINT = /^C_(INIT|OP)_RemapCPtoVector$/;

type Num = Extract<Kv3Node, { kind: 'number' }>;

/** A gem tint in a particle: its range, whether it scales the colour or replaces it, and its bytes. */
interface Tint { hi: Num[] | null; lo: Num[] | null; from: Num[] | null; scale: boolean }

/** The operators in a particle that colour it from control point 15, where the game puts a gem's colour. */
function gemTints(kv: Kv3Block): Tint[] {
  const out: Tint[] = [];
  const vector = (n: Kv3Node | undefined) => (n?.kind === 'array' && n.items.length >= 3 && n.items.every((x) => x.kind === 'number')
    ? n.items as Num[] : null);
  const visit = (node: Kv3Node) => {
    if (node.kind === 'array') { node.items.forEach(visit); return; }
    if (node.kind !== 'object') return;
    const m = node.members;
    const cls = m.get('_class');
    const cp = m.get('m_nCPInput');
    const field = m.get('m_nFieldOutput');
    const method = m.get('m_nSetMethod');
    if (cls?.kind === 'string' && GEM_TINT.test(cls.value) && cp?.kind === 'number' && numberOf(kv, cp) === 15
      && field?.kind === 'number' && numberOf(kv, field) === 6) {
      out.push({ hi: vector(m.get('m_vOutputMax')), lo: vector(m.get('m_vOutputMin')), from: vector(m.get('m_vInputMin')), scale: method?.kind === 'string' && method.value === 'PARTICLE_SET_SCALE_INITIAL_VALUE' });
    }
    m.forEach(visit);
  };
  visit(kv.root);
  return out;
}

/** A tint's range, channel by channel: what a full channel of the gem comes out as (null: cannot be read). */
function range(kv: Kv3Block, t: Tint): number[] | null {
  if (!t.hi || t.from?.some((x) => numberOf(kv, x) !== 0)) return null;
  return [0, 1, 2].map((c) => numberOf(kv, t.hi![c]) - (t.lo ? numberOf(kv, t.lo[c]) : 0));
}

/**
 * Make the gem's tint give the chosen colour. Such an operator maps control point 15 from
 * [0, m_vInputMax] to [m_vOutputMin, m_vOutputMax] into the colour field (6); scaling each
 * channel's range by chosen / gem turns the gem's colour into the chosen one, at the strength the
 * game gives the tint.
 * @returns how many operators were changed, and how many could not be (no bytes to write to)
 */
function retarget(kv: Kv3Block, tints: Tint[], gem: Rgb, target: Rgb): { changed: number; skipped: number } {
  let changed = 0;
  let skipped = 0;
  for (const t of tints) {
    if (!range(kv, t) || t.hi!.some((x) => !x.cell)) { skipped++; continue; }
    for (let c = 0; c < 3; c++) {
      if (!gem[c]) continue; // a channel the gem has none of cannot be scaled into anything
      const low = t.lo ? numberOf(kv, t.lo[c]) : 0;
      writeCell(kv, t.hi![c].cell!, low + (readCell(kv, t.hi![c].cell!) - low) * (target[c] / gem[c]));
    }
    changed++;
  }
  return { changed, skipped };
}

/** The colours a particle starts from, which a gem's tint replaces or scales. */
const INITIAL = /^m_(ConstantColor|ColorMin|ColorMax)$/;

/**
 * For a hero with no gem: write into the colours a particle starts from what the gem's tint would
 * have made of them in the chosen colour, the colour times the tint's range (or, for a tint that
 * scales, times the colour that was there).
 */
function bakeTint(kv: Kv3Block, tint: Tint, target: Rgb): { changed: number; skipped: number } {
  const span = range(kv, tint);
  if (!span) return { changed: 0, skipped: 1 };
  let changed = 0;
  let skipped = 0;
  for (const a of kv.arrays) {
    if (!INITIAL.test(a.key) || (a.cells.length !== 3 && a.cells.length !== 4) || a.cells.some((c) => c && c.float)) continue;
    if (a.cells.some((c) => c === null)) { skipped++; continue; }
    const cells = a.cells as NonNullable<(typeof a.cells)[number]>[];
    for (let c = 0; c < 3; c++) {
      const was = readCell(kv, cells[c]);
      const tinted = target[c] * span[c] * (tint.scale ? was / 255 : 1);
      writeCell(kv, cells[c], Math.max(0, Math.min(255, Math.round(tinted))));
    }
    changed++;
  }
  return { changed, skipped };
}

/** The colours written in a particle moved to the chosen one (but those `skip` names); `skipped` counts those with no room. */
function shadeColors(kv: Kv3Block, target: Rgb, skip?: RegExp): { changed: number; skipped: number } {
  let changed = 0;
  let skipped = 0;
  for (const a of kv.arrays) {
    if (!COLOR_KEY.test(a.key) || skip?.test(a.key) || (a.cells.length !== 3 && a.cells.length !== 4)) continue;
    if (a.cells.some((c) => c && c.float)) continue; // a colour is whole numbers; floats here are scales
    // a zero written as "zero" has no bytes to change; recolouring the other channels alone would
    // give a hue nobody chose
    if (a.cells.some((c) => c === null)) { skipped++; continue; }
    const cells = a.cells as NonNullable<(typeof a.cells)[number]>[];
    const rgb = cells.slice(0, 3).map((c) => readCell(kv, c)) as Rgb;
    if (rgb.some((n) => n < 0 || n > 255)) continue;
    const next = shade(rgb, target);
    if (next.every((n, i) => n === rgb[i])) continue;
    next.forEach((n, i) => writeCell(kv, cells[i], n));
    changed++;
  }
  return { changed, skipped };
}

/**
 * One compiled particle in the chosen colour. With `gem`, the gem's tint is pointed at the chosen
 * colour; with `own` (the default), a particle the gem does not tint has its written colours moved.
 * With `bake`, for a hero who has no gem (src/arcana.ts), that tint is off and what is written is
 * what shows: a particle the gem would tint starts from what the tint would have given, and its
 * other colours move to the chosen one.
 */
export function recolorResource(file: Buffer, target: Rgb, { gem, own = true, bake = false }: { gem?: Rgb; own?: boolean; bake?: boolean } = {}): {
  file: Buffer; changed: number; skipped: number;
} {
  const block = dataBlock(file);
  const kv = readKv3(block.data);
  const none = { changed: 0, skipped: 0 };
  const tints = gemTints(kv);
  const baked = bake && tints.length ? bakeTint(kv, tints[0], target) : none;
  const tint = gem ? retarget(kv, tints, gem, target) : none;
  const written = bake && tints.length ? shadeColors(kv, target, INITIAL) : (bake ? own : own && !tint.changed) ? shadeColors(kv, target) : none;
  const changed = baked.changed + tint.changed + written.changed;
  return { file: changed ? block.replace(kv.encode()) : file, changed, skipped: baked.skipped + tint.skipped + written.skipped };
}

const GEM_COLOR = attributeToken('$GemColor');

/**
 * One material with its reads of the gem's colour replaced by the chosen colour. With `bake`, an
 * expression that reads the gem becomes the chosen colour whole: with no gem, the other branch is
 * the one that shows.
 */
export function recolorMaterial(file: Buffer, target: Rgb, { bake = false }: { bake?: boolean } = {}): { file: Buffer; changed: number } {
  const value = target.map((n) => n / 255);
  return rewriteExpressions(file, (e) => {
    const next = withConstant(e.code, GEM_COLOR, value);
    return next && bake ? constantExpression(value) : next;
  });
}

type Failed = { path: string; error: string }[];

/**
 * The files of a set in the chosen colour, read from the game's pak01 (`bake`: as above). Files
 * that fail to read are reported and left out, so a mod carries Valve's own version of them.
 */
export function recolorFiles({ pak01, set, target, bake = false }: { pak01: string; set: string; target: Rgb; bake?: boolean }): {
  files: Map<string, Buffer>; changed: number; skipped: number; failed: Failed;
} {
  const def = RECOLOR_SETS[set];
  if (!def) throw new Error(`recolor: no set ${set}`);
  const index = openVpkIndex(pak01);
  const files = new Map<string, Buffer>();
  const failed: Failed = [];
  let changed = 0;
  let skipped = 0;
  const under = (p: string, prefixes: string[]) => prefixes.some((f) => p.startsWith(f));
  for (const p of listVpkPathsFile(pak01)) {
    const particle = p.endsWith('.vpcf_c') && (under(p, def.own) || under(p, def.shared));
    const material = p.endsWith('.vmat_c') && under(p, def.materials);
    if (!particle && !material) continue;
    try {
      const file = index.read(p) as Buffer;
      const r = particle ? recolorResource(file, target, { gem: def.gem, own: under(p, def.own), bake }) : { skipped: 0, ...recolorMaterial(file, target, { bake }) };
      changed += r.changed;
      skipped += r.skipped;
      if (r.changed) files.set(p, r.file);
    } catch (e) {
      failed.push({ path: p, error: (e as Error).message });
    }
  }
  return { files, changed, skipped, failed };
}

/** A set recoloured into one VPK, from the game's pak01, for a hero whose item brings its gem. */
export function buildRecolor({ pak01, set, target }: { pak01: string; set: string; target: Rgb }): {
  vpk: Buffer; files: number; changed: number; skipped: number; failed: Failed;
} {
  const r = recolorFiles({ pak01, set, target });
  if (!r.files.size) throw new Error('recolor: nothing in the set took the colour');
  return { vpk: buildVpk([...r.files].map(([p, f]) => entryAt(p, f))), files: r.files.size, changed: r.changed, skipped: r.skipped, failed: r.failed };
}
