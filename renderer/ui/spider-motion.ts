/* How a running spider moves, without the page: ui/spiders.ts draws what this decides.
 *
 * Kept apart so the one rule that matters can be tested: a spider that is leaving does leave. It
 * did not (#385). It steered at a point 40 px past the nearest edge and only counted as gone at
 * 60 px, and the steering stops it at its target. So every spider of a burst ended up just out of
 * sight, held there for good, and the frame loop drew a few hundred invisible spiders a frame.
 */

/** How far past an edge a spider is gone. */
export const OUT = 60;
/** Where a leaving spider heads: past the line it is gone at, so it never stops short of it. */
export const EXIT = OUT + 40;
/** How many can be out at once. A burst into a window that already holds this many adds none.
 *  160 until 3.0: each is an SVG redrawn every frame, and clicking Broodmother's mods over and over
 *  kept the window at the ceiling for as long as the clicking went on, which a slower machine felt. */
export const MAX_SPIDERS = 48;
/** How many of those can be loose ones (Broodmother's, which leave), so the bloody night's
 *  residents always have room. */
export const MAX_LOOSE = 36;

/** How many of a burst of `asked` may come out while `loose` are already about: never past the cap. */
export const burstRoom = (asked: number, loose: number): number => Math.max(0, Math.min(asked, MAX_LOOSE - loose));

export interface Runner {
  x: number; y: number; vx: number; vy: number; a: number;
  life: number; wander: number; stays: boolean;
  home?: { x: number; y: number } | null;
}

export interface Around { w: number; h: number; px: number; py: number; dt: number }

/** Leaving and not a resident: the walls let it through and the nearest edge is where it goes. */
export const leaving = (s: Runner) => s.life <= 0 && !s.stays;

/** The nearest edge to leave by. Never the top: the title bar is there. */
export function exitTarget(s: Runner, w: number, h: number): { x: number; y: number } {
  const edges = [{ x: -EXIT, y: s.y, d: s.x }, { x: w + EXIT, y: s.y, d: w - s.x }, { x: s.x, y: h + EXIT, d: h - s.y }];
  edges.sort((p, q) => p.d - q.d);
  return edges[0];
}

export const isGone = (s: Runner, w: number, h: number) => s.x < -OUT || s.x > w + OUT || s.y < -OUT || s.y > h + OUT;

/**
 * One frame of running: from the pointer, otherwise towards home or out of the window.
 * 'home' when it has reached the place it was going to rest at, 'gone' once it is out of the
 * window, otherwise its speed, which says whether its legs move.
 */
export function runStep(s: Runner, { w, h, px, py, dt }: Around, random = Math.random): 'home' | 'gone' | number {
  s.life -= dt;
  let ax = 0, ay = 0;
  const dx = s.x - px, dy = s.y - py, d = Math.hypot(dx, dy) || 1;
  const scared = d < 170;
  if (scared) { ax += (dx / d) * 2600 * (1 - d / 170); ay += (dy / d) * 2600 * (1 - d / 170); }
  s.wander += (random() - 0.5) * 6 * dt;
  const target = s.home ?? (leaving(s) ? exitTarget(s, w, h) : null);
  if (target) {
    const tx = target.x - s.x, ty = target.y - s.y, td = Math.hypot(tx, ty) || 1;
    ax += (tx / td) * 700; ay += (ty / td) * 700;
    if (s.home && td < 6 && !scared) { s.home = null; s.vx = s.vy = 0; return 'home'; }
  } else {
    ax += Math.cos(s.wander) * 260; ay += Math.sin(s.wander) * 260;
  }
  // the walls push back, unless it is leaving through one
  const m = 24;
  if (!leaving(s)) {
    if (s.x < m) ax += (m - s.x) * 60;
    if (s.x > w - m) ax -= (s.x - (w - m)) * 60;
    if (s.y < m + 30) ay += (m + 30 - s.y) * 60;
    if (s.y > h - m) ay -= (s.y - (h - m)) * 60;
  }
  s.vx += ax * dt; s.vy += ay * dt;
  s.vx *= Math.pow(0.08, dt); s.vy *= Math.pow(0.08, dt);
  const top = scared ? 330 : 150, sp = Math.hypot(s.vx, s.vy);
  if (sp > top) { s.vx *= top / sp; s.vy *= top / sp; }
  s.x += s.vx * dt; s.y += s.vy * dt;
  if (sp > 8) s.a = (Math.atan2(s.vy, s.vx) * 180) / Math.PI + 90;
  return isGone(s, w, h) ? 'gone' : sp;
}
