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
import { attributeToken, dataBlock, rewriteExpressions, withConstant } from './material.ts';
import { buildVpk, entryAt, listVpkPathsFile, openVpkIndex, type VpkEntry } from './vpk.ts';

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

/**
 * Make the gem's tint give the chosen colour. Such an operator maps control point 15 from
 * [0, m_vInputMax] to [m_vOutputMin, m_vOutputMax] into the colour field (6); scaling each
 * channel's range by chosen / gem turns the gem's colour into the chosen one, at the strength the
 * game gives the tint.
 * @returns how many operators were changed, and how many could not be (no bytes to write to)
 */
function retarget(kv: Kv3Block, gem: Rgb, target: Rgb): { changed: number; skipped: number } {
  let changed = 0;
  let skipped = 0;
  const vector = (n: Kv3Node | undefined) => (n?.kind === 'array' && n.items.length >= 3 && n.items.every((x) => x.kind === 'number')
    ? n.items as Extract<Kv3Node, { kind: 'number' }>[] : null);
  const visit = (node: Kv3Node) => {
    if (node.kind === 'array') { node.items.forEach(visit); return; }
    if (node.kind !== 'object') return;
    const m = node.members;
    const cls = m.get('_class');
    const cp = m.get('m_nCPInput');
    const field = m.get('m_nFieldOutput');
    if (cls?.kind === 'string' && GEM_TINT.test(cls.value) && cp?.kind === 'number' && numberOf(kv, cp) === 15
      && field?.kind === 'number' && numberOf(kv, field) === 6) {
      const hi = vector(m.get('m_vOutputMax'));
      const lo = vector(m.get('m_vOutputMin'));
      const from = vector(m.get('m_vInputMin'));
      if (!hi || hi.some((x) => !x.cell) || from?.some((x) => numberOf(kv, x) !== 0)) skipped++;
      else {
        for (let c = 0; c < 3; c++) {
          if (!gem[c]) continue; // a channel the gem has none of cannot be scaled into anything
          const low = lo ? numberOf(kv, lo[c]) : 0;
          writeCell(kv, hi[c].cell!, low + (readCell(kv, hi[c].cell!) - low) * (target[c] / gem[c]));
        }
        changed++;
      }
    }
    m.forEach(visit);
  };
  visit(kv.root);
  return { changed, skipped };
}

/** The colours written in a particle moved to the chosen one; `skipped` counts those with no room. */
function shadeColors(kv: Kv3Block, target: Rgb): { changed: number; skipped: number } {
  let changed = 0;
  let skipped = 0;
  for (const a of kv.arrays) {
    if (!COLOR_KEY.test(a.key) || (a.cells.length !== 3 && a.cells.length !== 4)) continue;
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
 */
export function recolorResource(file: Buffer, target: Rgb, { gem, own = true }: { gem?: Rgb; own?: boolean } = {}): {
  file: Buffer; changed: number; skipped: number;
} {
  const block = dataBlock(file);
  const kv = readKv3(block.data);
  const tint = gem ? retarget(kv, gem, target) : { changed: 0, skipped: 0 };
  const written = own && !tint.changed ? shadeColors(kv, target) : { changed: 0, skipped: 0 };
  const changed = tint.changed + written.changed;
  return { file: changed ? block.replace(kv.encode()) : file, changed, skipped: tint.skipped + written.skipped };
}

const GEM_COLOR = attributeToken('$GemColor');

/** One material with its reads of the gem's colour replaced by the chosen colour. */
export function recolorMaterial(file: Buffer, target: Rgb): { file: Buffer; changed: number } {
  const value = target.map((n) => n / 255);
  return rewriteExpressions(file, (e) => withConstant(e.code, GEM_COLOR, value));
}

/**
 * A set recoloured into one VPK, from the game's pak01. Files that fail to read are reported and
 * left out, so the mod carries Valve's own version of them.
 */
export function buildRecolor({ pak01, set, target }: { pak01: string; set: string; target: Rgb }): {
  vpk: Buffer; files: number; changed: number; skipped: number; failed: { path: string; error: string }[];
} {
  const def = RECOLOR_SETS[set];
  if (!def) throw new Error(`recolor: no set ${set}`);
  const index = openVpkIndex(pak01);
  const entries: VpkEntry[] = [];
  const failed: { path: string; error: string }[] = [];
  let changed = 0;
  let skipped = 0;
  const under = (p: string, prefixes: string[]) => prefixes.some((f) => p.startsWith(f));
  for (const p of listVpkPathsFile(pak01)) {
    const particle = p.endsWith('.vpcf_c') && (under(p, def.own) || under(p, def.shared));
    const material = p.endsWith('.vmat_c') && under(p, def.materials);
    if (!particle && !material) continue;
    try {
      const file = index.read(p) as Buffer;
      const r = particle ? recolorResource(file, target, { gem: def.gem, own: under(p, def.own) }) : { skipped: 0, ...recolorMaterial(file, target) };
      changed += r.changed;
      skipped += r.skipped;
      if (r.changed) entries.push(entryAt(p, r.file));
    } catch (e) {
      failed.push({ path: p, error: (e as Error).message });
    }
  }
  if (!entries.length) throw new Error('recolor: nothing in the set took the colour');
  return { vpk: buildVpk(entries), files: entries.length, changed, skipped, failed };
}
