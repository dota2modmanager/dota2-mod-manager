/* The HUD's panels as the editor draws them: where each stands on a 1920 x 1080 screen with nothing
 * changed, read off the game at that size, and how a change moves it. A panel keeps the corner the
 * game aligns it to while it scales, and what is inside the bottom bar goes with the bar.
 * src/hud-scale.ts lists the same ids, and a test keeps the two in step. */

/** What was changed on one panel (src/hud-scale.ts). */
export interface HudPart { id: string; scale?: number; x?: number; y?: number; opacity?: number; tint?: string; hidden?: boolean }

/** A panel at rest. */
export interface PartShape {
  id: string;
  x: number; y: number; w: number; h: number;
  /** the point of the box that stays put as it scales: 0 left or top, 1 right or bottom */
  ax: number; ay: number;
  /** the repeating cells a panel is known by: ten heroes, six items */
  cols?: number; rows?: number;
  /** inside the bottom bar */
  inside?: boolean;
}

export const STAGE = { w: 1920, h: 1080 };

export const SHAPES: PartShape[] = [
  { id: 'lower_hud', x: 500, y: 935, w: 900, h: 145, ax: 0.5, ay: 1 },
  { id: 'PortraitGroup', x: 540, y: 942, w: 100, h: 138, ax: 0, ay: 1, inside: true },
  { id: 'stats_container', x: 640, y: 942, w: 60, h: 138, ax: 0, ay: 1, inside: true },
  { id: 'abilities', x: 712, y: 942, w: 413, h: 74, ax: 0, ay: 1, cols: 5, rows: 1, inside: true },
  { id: 'health_mana', x: 712, y: 1018, w: 413, h: 58, ax: 0, ay: 1, cols: 1, rows: 2, inside: true },
  { id: 'inventory', x: 1138, y: 938, w: 198, h: 142, ax: 1, ay: 1, cols: 3, rows: 2, inside: true },
  { id: 'topbar', x: 546, y: 0, w: 830, h: 42, ax: 0.5, ay: 0, cols: 10, rows: 1 },
  { id: 'minimap_container', x: 0, y: 800, w: 280, h: 280, ax: 0, ay: 1 },
  { id: 'shop_launcher_block', x: 1628, y: 976, w: 292, h: 104, ax: 1, ay: 1 },
  { id: 'combat_events', x: 0, y: 395, w: 250, h: 150, ax: 0, ay: 0 },
  { id: 'HudChat', x: 300, y: 640, w: 560, h: 160, ax: 0, ay: 1 },
];

/** A shape by id. */
export const shapeOf = (id: string): PartShape => SHAPES.find((s) => s.id === id) ?? SHAPES[0];

/** The scale a panel is at, in parts of one. */
const scaleOf = (p: HudPart | undefined) => (p?.scale ?? 100) / 100;

/** Where a panel stands with `parts` on, in the stage's pixels, and how much one of its own pixels covers. */
export function boxOf(s: PartShape, parts: HudPart[]): { x: number; y: number; w: number; h: number; unit: number } {
  const own = parts.find((p) => p.id === s.id);
  const bar = s.inside ? parts.find((p) => p.id === 'lower_hud') : undefined;
  const barShape = shapeOf('lower_hud');
  const k = scaleOf(bar);
  const k2 = k * scaleOf(own);
  // the point that holds still, carried by the bar first
  const px = s.x + s.w * s.ax;
  const py = s.y + s.h * s.ay;
  const hx = barShape.x + barShape.w * barShape.ax;
  const hy = barShape.y + barShape.h * barShape.ay;
  const ax = s.inside ? hx + (px - hx) * k + (bar?.x ?? 0) : px;
  const ay = s.inside ? hy + (py - hy) * k + (bar?.y ?? 0) : py;
  return {
    x: ax - s.w * k2 * s.ax + (own?.x ?? 0) * k,
    y: ay - s.h * k2 * s.ay + (own?.y ?? 0) * k,
    w: s.w * k2,
    h: s.h * k2,
    unit: s.inside ? k : 1,
  };
}

/** A panel with a change made, and dropped from the list when nothing is left on it. */
export function withPatch(parts: HudPart[], id: string, patch: Partial<HudPart>): HudPart[] {
  const next: HudPart = { ...(parts.find((p) => p.id === id) ?? { id }), ...patch };
  const on = (Object.keys(next) as (keyof HudPart)[]).filter((k) => k !== 'id' && next[k] !== undefined);
  const rest = parts.filter((p) => p.id !== id);
  return on.length ? [...rest, next] : rest;
}

/** A layout as a value to compare. */
export const layoutKey = (parts: HudPart[]): string =>
  JSON.stringify([...parts].sort((a, b) => a.id.localeCompare(b.id)).map((p) => [p.id, p.scale ?? 100, p.x ?? 0, p.y ?? 0, p.opacity ?? 100, p.tint ?? '', !!p.hidden]));
