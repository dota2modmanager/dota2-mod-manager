/**
 * An item's effects in a colour of the user's choosing, built from the game's own particles.
 *
 * Issue #118 asked for Terrorblade's arcana in any RGB. Its glow, eyes, mouth and kill effect are
 * particles whose colours are numbers in the compiled file (`m_ConstantColor = [ 0, 210, 255, 255 ]`)
 * over textures that are white, so changing the numbers is changing the colour. The files are read
 * out of Valve's pak01, recoloured where the numbers lie (src/kv3.ts) and packed as one mod.
 *
 * The colour is moved, not painted over. Every colour in the set takes the chosen hue, and keeps
 * its own brightness and saturation scaled by the chosen colour's: the arcana's main cyan becomes
 * exactly the colour picked, its dark teals become dark shades of it, and black, white and greys,
 * which carry no hue, stay as they are.
 */
import { readKv3, readCell, writeCell } from './kv3.ts';
import { buildVpk, entryAt, listVpkPathsFile, openVpkIndex, type VpkEntry } from './vpk.ts';

export type Rgb = [number, number, number];

/** What can be recoloured, and the files each is made of (folders of compiled particles in pak01). */
export const RECOLOR_SETS: Record<string, { name: string; folders: string[] }> = {
  'terrorblade-arcana': {
    name: 'Fractal Horns of Inner Abysm',
    folders: ['particles/econ/items/terrorblade/terrorblade_horns_arcana/'],
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

/** The DATA block of a compiled resource, and the file with a new one in its place. */
export function dataBlock(file: Buffer): { data: Buffer; replace(next: Buffer): Buffer } {
  const table = 8 + file.readUInt32LE(8);
  const count = file.readUInt32LE(12);
  let entry = -1;
  let off = 0;
  let size = 0;
  let last = 0;
  for (let k = 0; k < count; k++) {
    const e = table + k * 12;
    const at = e + 4 + file.readUInt32LE(e + 4);
    last = Math.max(last, at);
    if (file.toString('ascii', e, e + 4) === 'DATA') { entry = e; off = at; size = file.readUInt32LE(e + 8); }
  }
  if (entry === -1) throw new Error('resource: no DATA block');
  if (off !== last) throw new Error('resource: DATA is not the last block');
  return {
    data: file.subarray(off, off + size),
    replace(next) {
      const out = Buffer.concat([file.subarray(0, off), next, file.subarray(off + size)]);
      out.writeUInt32LE(next.length, entry + 8);
      out.writeUInt32LE(out.length, 0);
      return out;
    },
  };
}

/** One compiled resource with its colours moved; `changed` counts the colours, `skipped` those with no room. */
export function recolorResource(file: Buffer, target: Rgb): { file: Buffer; changed: number; skipped: number } {
  const block = dataBlock(file);
  const kv = readKv3(block.data);
  let changed = 0;
  let skipped = 0;
  for (const a of kv.arrays) {
    if (!COLOR_KEY.test(a.key) || (a.cells.length !== 3 && a.cells.length !== 4)) continue;
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
  return { file: changed ? block.replace(kv.encode()) : file, changed, skipped };
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
  for (const p of listVpkPathsFile(pak01).filter((x) => x.endsWith('.vpcf_c') && def.folders.some((f) => x.startsWith(f)))) {
    try {
      const r = recolorResource(index.read(p) as Buffer, target);
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
