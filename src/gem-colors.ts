/**
 * The game's own prismatic gem colours, read out of items_game.txt (issue #392). The table keeps
 * them in its "colors" section, one block per gem: "unusual_creators_light" with a color_name
 * ("UnusualCreatorsLight") and a hex_color ("#..."). A colour picker can offer these next to free
 * RGB, so "Creator's Light" on an arcana is the colour a real gem gives it.
 *
 * The section sits near the top of a 50 MB table, so it is found by its line rather than by
 * walking every block before it.
 */
import { blockBounds, eachChild } from './schema-kv.ts';
import { pngFromVtex } from './vtex.ts';
import type { VpkIndex } from './vpk.ts';
import type { Rgb } from './recolor.ts';

/** One prismatic gem colour. */
export interface GemColor { key: string; name: string; rgb: Rgb; picture?: string }

/** The shared prismatic socket artwork and its color overlay, from the installed game. */
export function prismaticGemArt(index: Pick<VpkIndex, 'read'>): { image: string; mask: string | null } | null {
  const read = (name: string) => {
    const png = pngFromVtex(index.read(`panorama/images/econ/sockets/${name}_png.vtex_c`));
    return png && `data:image/png;base64,${png.toString('base64')}`;
  };
  const image = read('gem_color');
  return image ? { image, mask: read('gem_color_mask') } : null;
}

/** Some client builds ship individual socket art alongside the shared layers. */
export function prismaticGemPictures(gems: GemColor[], index: Pick<VpkIndex, 'has' | 'read'>): GemColor[] {
  return gems.map(gem => {
    const slug = gem.key.replace(/^unusual_/, '');
    for (const name of [`gem_color_${slug}`, `gem_color_${gem.key}`]) {
      const path = `panorama/images/econ/sockets/${name}_png.vtex_c`;
      if (!index.has(path)) continue;
      const png = pngFromVtex(index.read(path));
      if (png) return { ...gem, picture: `data:image/png;base64,${png.toString('base64')}` };
    }
    return gem;
  });
}

/** "UnusualCreatorsLight" as "Creators Light"; digits stay one word: "International 2012". */
export function gemName(colorName: string): string {
  return colorName.replace(/^Unusual/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([0-9])([A-Z])/g, '$1 $2').trim();
}

/** "#FFAF00" as [255, 175, 0], or null. */
export function rgbOf(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb : null;
}

/** The "colors" section's bounds, found by its line at the table's first level, or null. */
function colorsSection(text: string): [number, number] | null {
  const at = /\n\t"colors"\s*\n/.exec(text);
  return at ? blockBounds(text, at.index + at[0].length - 1) : null;
}

/** Every prismatic gem colour in the table, in the table's order. */
export function gemColors(text: string): GemColor[] {
  const section = colorsSection(text);
  if (!section) return [];
  const out: GemColor[] = [];
  eachChild(text, section, (c) => {
    if (!c.isBlock || !c.key.startsWith('unusual_')) return;
    let name = '';
    let rgb: Rgb | null = null;
    eachChild(text, c.body, (f) => {
      if (f.isBlock) return;
      if (f.key === 'color_name') name = gemName(f.value);
      if (f.key === 'hex_color') rgb = rgbOf(f.value);
    });
    if (name && rgb) out.push({ key: c.key, name, rgb });
  });
  return out;
}

/** The gem whose key or name this is, ignoring case, spaces and an apostrophe; or null. */
export function findGem(gems: GemColor[], what: string): GemColor | null {
  const norm = (s: string) => s.toLowerCase().replace(/^unusual_/, '').replace(/[\s_'’-]+/g, '');
  const want = norm(what);
  return gems.find((g) => norm(g.key) === want || norm(g.name) === want) || null;
}
