/* The in-game HUD laid out by hand (issues #420 and later): the stylesheet that lays the HUD out,
 * written again with rules added at its end, for Valve's compiler.
 *
 * panorama/styles/hud/hud_reborn.vcss_c holds the HUD's styles; a compiled style keeps them in a
 * binary form, so the app reads them back as CSS with ValveResourceFormat, adds the rules, and has
 * resourcecompiler.exe compile the whole file again. A rule goes on a panel by its id, and carries
 * only what Panorama itself uses in this file: `ui-scale` scales a panel and all of it and keeps
 * clicks where the buttons are drawn, `transform` moves it, `wash-color` tints it, and
 * `visibility: collapse` takes it off the screen. Rules the game gives to a state (a flipped HUD,
 * the seconds before the match) are stronger than these and stay in force.
 *
 * A style is a whole file: a HUD mod replaces this same one, so the rules go on the copy that is
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
/** How far a panel can be moved, in the HUD's own pixels (the screen is 1080 high to it). */
export const MAX_SHIFT = 1920;

/**
 * The panels the window offers, by id in the HUD's layout. renderer/catalog/hud/parts.ts draws them,
 * and a test keeps the two in step.
 */
export const PARTS = [
  'topbar', 'minimap_container', 'lower_hud', 'PortraitGroup', 'stats_container', 'abilities', 'health_mana',
  'inventory', 'shop_launcher_block', 'combat_events', 'HudChat',
];

/** What was changed on one panel; what was not is left out. */
export interface HudPart { id: string; scale?: number; x?: number; y?: number; opacity?: number; tint?: string; hidden?: boolean }

/** A scale the window sent, as a whole step in range; 100 for anything else. */
export function clampScale(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 100;
  return Math.min(Math.max(Math.round(v / 5) * 5, MIN_SCALE), MAX_SCALE);
}

/** What the window sent, as panels this knows, values in range and defaults dropped. */
export function cleanParts(raw: unknown): HudPart[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, HudPart>();
  for (const r of raw as Partial<HudPart>[]) {
    if (!r || typeof r.id !== 'string' || !PARTS.includes(r.id)) continue;
    const p: HudPart = { id: r.id };
    const scale = clampScale(r.scale ?? 100);
    if (scale !== 100) p.scale = scale;
    for (const k of ['x', 'y'] as const) {
      const v = Math.round(Number(r[k]) || 0);
      if (v) p[k] = Math.min(Math.max(v, -MAX_SHIFT), MAX_SHIFT);
    }
    const opacity = Math.min(Math.max(Math.round(Number(r.opacity ?? 100) / 5) * 5 || 0, 10), 100);
    if (opacity !== 100) p.opacity = opacity;
    if (typeof r.tint === 'string' && /^#[0-9a-f]{6}$/i.test(r.tint)) p.tint = r.tint.toLowerCase();
    if (r.hidden === true) p.hidden = true;
    if (Object.keys(p).length > 1) out.set(p.id, p);
  }
  return [...out.values()];
}

/** The layout an older record meant by its one scale: the bottom bar and the minimap. */
export const partsOfScale = (scale: number): HudPart[] => cleanParts([{ id: 'lower_hud', scale }, { id: 'minimap_container', scale }]);

const MARK = '/* d2mm: HUD scale */';

/** The panels a flipped HUD mirrors with a transform of its own, stronger than a plain one. */
const MIRRORED = new Set(['lower_hud', 'minimap_container']);

/** One panel's rule, and a second where the flipped HUD would take its offset away. The panel's parent is mirrored there, so the same offset lands mirrored on the other side. */
function ruleOf(p: HudPart): string {
  const lines: string[] = [];
  if (p.hidden) lines.push('visibility: collapse;');
  if (p.scale) lines.push(`ui-scale: ${p.scale}%;`);
  if (p.x || p.y) lines.push(`transform: translateX(${p.x ?? 0}px) translateY(${p.y ?? 0}px);`);
  if (p.opacity) lines.push(`opacity: ${p.opacity / 100};`);
  if (p.tint) lines.push(`wash-color: ${p.tint};`);
  const rule = `#${p.id}\n{\n${lines.map((l) => `\t${l}`).join('\n')}\n}\n`;
  if (!(p.x || p.y) || !MIRRORED.has(p.id)) return rule;
  return `${rule}\n.HUDFlipped #${p.id}\n{\n\ttransform: translateX(${p.x ?? 0}px) translateY(${p.y ?? 0}px) scaleX(-1);\n}\n`;
}

/**
 * The CSS ValveResourceFormat read out of the style, with the layout at its end. The tool's own
 * banner comment goes, and rules this added before are replaced rather than stacked.
 */
export function withLayout(css: string, raw: unknown): string {
  // \s takes the byte-order mark too
  const own = css.replace(/^\s*\/\*[^\n]*Source 2 Viewer[^\n]*\*\/\s*/, '');
  const at = own.indexOf(MARK);
  const base = (at >= 0 ? own.slice(0, at) : own).replace(/\s+$/, '');
  return `${base}\n\n${MARK}\n${cleanParts(raw).map(ruleOf).join('\n')}`;
}
