/* What the own-cursor window keeps of the user's choices (stored in the record's generated.cursor,
 * crates/mm-core/src/looks/cursor_maker.rs): for each cursor, where its picture comes from. Plain
 * functions; the drawing is draw.ts, the tests are test/cursor-maker.test.ts. */

/** game: the game's own cursor stays; pack: the cursor of one of the game's cosmetic sets;
 * own: a picture of the user's, with the hotspot as a share of the cursor */
export type Source =
  | { from: 'game' }
  | { from: 'pack'; pack: string }
  | { from: 'own'; picture: string; hot: [number, number] };

export interface CursorDesign { states: Record<string, Source> }

export const EMPTY_DESIGN: CursorDesign = { states: {} };

const GAME: Source = { from: 'game' };
const share = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
const isPack = (v: unknown): v is string => typeof v === 'string' && /^(valve|workshop)\/[a-z0-9_]+$/i.test(v);

/** A stored design read back, whatever an older or a broken record holds. */
export function cleanDesign(raw: unknown): CursorDesign {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const states: Record<string, Source> = {};
  for (const [name, s] of Object.entries((r.states && typeof r.states === 'object' ? r.states : {}) as Record<string, Record<string, unknown>>)) {
    if (!/^cursor_[a-z0-9_]+$/.test(name) || !s) continue;
    if (s.from === 'pack' && isPack(s.pack)) states[name] = { from: 'pack', pack: s.pack };
    else if (s.from === 'own' && isId(s.picture)) {
      const hot = Array.isArray(s.hot) ? s.hot : [];
      states[name] = { from: 'own', picture: s.picture, hot: [share(hot[0]), share(hot[1])] };
    }
  }
  return { states };
}

export const sourceOf = (d: CursorDesign, name: string): Source => d.states[name] ?? GAME;

/** The design with one cursor's source changed; the game's own is no entry at all. */
export function withSource(d: CursorDesign, name: string, s: Source): CursorDesign {
  const states = { ...d.states };
  if (s.from === 'game') delete states[name];
  else states[name] = s;
  return { states };
}

/** Every cursor a set has takes it. */
export function withPack(d: CursorDesign, pack: string, has: string[]): CursorDesign {
  return has.reduce((out, name) => withSource(out, name, { from: 'pack', pack }), d);
}

/** The set every changed cursor comes from, when they all come from one and it covers what it has. */
export function wholePack(d: CursorDesign, packs: { id: string; names: string[] }[]): string | null {
  const used = new Set(Object.values(d.states).map((s) => (s.from === 'pack' ? s.pack : '')));
  if (used.size !== 1) return null;
  const p = packs.find((x) => used.has(x.id));
  return p && p.names.every((n) => d.states[n]?.from === 'pack') ? p.id : null;
}

/** The tip of a pointer: the opaque pixel nearest the top left corner, as a share of the picture. */
export function tipOf(alpha: ArrayLike<number>, w: number, h: number): [number, number] {
  let best = Infinity;
  let at: [number, number] = [0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[(y * w + x) * 4 + 3] < 128 || x + y >= best) continue;
      best = x + y;
      at = [x, y];
    }
  }
  return [w > 1 ? at[0] / w : 0, h > 1 ? at[1] / h : 0];
}

export interface Box { x: number; y: number; w: number; h: number }

/** Where a picture of w by h goes in a square cursor of `size`: as large as fits, in the middle. */
export function place(w: number, h: number, size: number): Box {
  const k = size / Math.max(w, h, 1);
  return { x: (size - w * k) / 2, y: (size - h * k) / 2, w: w * k, h: h * k };
}

/** The pictures of the user's a design draws with, each once. */
export function picturesOf(d: CursorDesign): string[] {
  return [...new Set(Object.values(d.states).flatMap((s) => (s.from === 'own' ? [s.picture] : [])))];
}
