/**
 * Where things are in a picture of the bench's game, worked out from the units' health bars
 * (tools/dota-bench/bars.ps1), and what the bench does with each ability. Nothing here touches the
 * game: it is the arithmetic the scenario in tools/dota-bench.mjs leans on, kept apart to be tested.
 *
 * Positions are pixels of the 1920x1080 window. A unit's body is below its bar by a distance that
 * shrinks as the camera moves away; 110 px was measured at the camera distance of 700.
 */

/** The bars from bars.ps1's output: colour, left and right end, the mana row's height, the middle. */
export function readBars(output) {
  return String(output).split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 4 && /^(red|green|other)$/.test(p[0]))
    .map(([kind, x0, x1, y]) => ({ kind, x0: +x0, x1: +x1, y: +y, x: Math.round((+x0 + +x1) / 2) }));
}

/** Where to click a unit: its body, under its bar. */
export function bodyOf(bar, camera = 700) {
  return [bar.x, bar.y + Math.round(110 * 700 / camera)];
}

const near = (a, b, d = 30) => Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d;

/** The bar of `kind` that is in `after` and was not in `before`: the unit just spawned. */
export function spawned(before, after, kind = 'red') {
  return after.find((b) => b.kind === kind && !before.some((o) => o.kind === kind && near(o, b))) ?? null;
}

/**
 * The bar of `kind` closest to where a unit was, skipping the ones near `not` (another unit of
 * the same colour): the enemy hero is told from the dummy by where each stood.
 */
export function follow(bars, last, kind, not = []) {
  const left = bars.filter((b) => b.kind === kind && !not.some((n) => n && near(n, b)));
  if (!left.length) return null;
  const d = (b) => (b.x - last.x) ** 2 + (b.y - last.y) ** 2;
  return left.reduce((a, b) => (d(b) < d(a) ? b : a));
}

/** A rectangle around points, at least `min` big, kept inside the window: [x, y, w, h]. */
export function frame(points, { pad = 220, min = [640, 480], win = [1920, 1080] } = {}) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  let [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  const grow = (a, b, want) => { const m = Math.max(0, want - (b - a)); return [a - m / 2, b + m / 2]; };
  [x0, x1] = grow(x0, x1, min[0]);
  [y0, y1] = grow(y0, y1, min[1]);
  const w = Math.min(win[0], Math.round(x1 - x0));
  const h = Math.min(win[1], Math.round(y1 - y0));
  const x = Math.max(0, Math.min(win[0] - w, Math.round(x0)));
  const y = Math.max(0, Math.min(win[1] - h, Math.round(y0)));
  return [x, y, w, h];
}

/**
 * The abilities to cast, from "q,w,r@enemy": a key each, and whether it is aimed at the enemy
 * hero. An aimed one is cast with the cursor already on the enemy, which works for quick cast as
 * much as for the click after the key; one with no target is cast where it stands.
 */
export function readSkills(spec) {
  return String(spec).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).map((s) => {
    const [key, at] = s.split('@');
    if (!/^[a-z]$/.test(key)) throw new Error(`bench: "${s}" is not a key`);
    if (at && at !== 'enemy') throw new Error(`bench: "${s}": the only target is @enemy`);
    return { key, enemy: at === 'enemy' };
  });
}

/**
 * The key a player bound to an action, from their dotakeys_personal.lst ("Console", "InspectHeroInWorld"),
 * or null. The file is KeyValues with no escapes: the action's block holds "Key" "\\" for the backslash key.
 */
export function bindOf(lst, action) {
  const m = String(lst).match(new RegExp(`"${action}"\\s*\\{([^}]*)\\}`));
  const key = m && m[1].match(/"Key"[ \t]+"([^"\r\n]*)"/);
  return key ? key[1] : null;
}

/**
 * The commands of a batch the game answered "Unknown command" to, by their first word: the
 * retail game drops the developers' ones (dota_camera_yaw) although their names are in its dlls.
 */
export function unknownCommands(log, cmds) {
  const names = cmds.map((c) => String(c).trim().split(/\s+/)[0]).filter(Boolean);
  return [...new Set(names)].filter((n) => new RegExp(`Unknown command: ${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(log));
}

/** The scan code of a key as dotakeys names it, for the ones the bench presses. */
export const SCAN = { '`': 0x29, '\\': 0x2B, I: 0x17, F11: 0x57, F12: 0x58, INSERT: 0x52 };

/**
 * What each hero casts when --skills is not given: its abilities, Aghanim's Scepter's and Shard's
 * (both are given before), the ultimate last, since it can kill the enemy the others aim at.
 */
export const SKILLS = {
  terrorblade: 'e,w',
  necrolyte: 'q,w,d@enemy,f,r@enemy',
};
export const DEFAULT_SKILLS = 'q,w,e,d,f,r@enemy';
