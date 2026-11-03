/* The in-game HUD made smaller or larger (issue #420): the stylesheet that lays the HUD out,
 * written again with one rule added at its end, for Valve's compiler.
 *
 * panorama/styles/hud/hud_reborn.vcss_c holds the HUD's styles; a compiled style keeps them in a
 * binary form, so the app reads them back as CSS with ValveResourceFormat, adds the rule, and has
 * resourcecompiler.exe compile the whole file again. Panorama's own `ui-scale` scales a panel and
 * all of it, and keeps clicks where the buttons are drawn; the game uses it in this file already.
 * The bottom bar (portrait, abilities, items) and the minimap are scaled; the top bar is left.
 *
 * A style is a whole file: a HUD mod replaces this same one, so the rule goes on the copy that is
 * in force (the HUD mod's when one is on), and a Dota update that changes the file means building
 * again from the new one (src/hud-scale-service.ts).
 */

/** The stylesheet in the pak. */
export const STYLE = 'panorama/styles/hud/hud_reborn.vcss_c';
/** The same stylesheet as the compiler's source in an addon. */
export const SOURCE = 'panorama/styles/hud/hud_reborn.css';

/** The smallest scale the window offers, in percent. */
export const MIN_SCALE = 60;
/** The largest scale the window offers, in percent. */
export const MAX_SCALE = 130;

/** A scale the window sent, as a whole step in range; 100 for anything else. */
export function clampScale(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 100;
  return Math.min(Math.max(Math.round(v / 5) * 5, MIN_SCALE), MAX_SCALE);
}

/** The panels the scale goes on: the bottom bar, the minimap. */
export const SCALED = ['#lower_hud', '#minimap_container'];

const MARK = '/* d2mm: HUD scale */';

/**
 * The CSS ValveResourceFormat read out of the style, with the scale at its end. The tool's own
 * banner comment goes, and a rule this added before is replaced rather than stacked.
 */
export function withScale(css: string, scale: number): string {
  // \s takes the byte-order mark too
  const own = css.replace(/^\s*\/\*[^\n]*Source 2 Viewer[^\n]*\*\/\s*/, '');
  const at = own.indexOf(MARK);
  const base = (at >= 0 ? own.slice(0, at) : own).replace(/\s+$/, '');
  return `${base}\n\n${MARK}\n${SCALED.join(', ')}\n{\n\tui-scale: ${clampScale(scale)}%;\n}\n`;
}
