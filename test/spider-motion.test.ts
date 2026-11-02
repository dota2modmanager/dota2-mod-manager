/* How a running spider moves (renderer/ui/spider-motion.ts). Written after #385: after a big
 * Broodmother burst the frame rate stayed low with no spider in sight, because every one that
 * left stopped 40 px past the edge, short of the 60 px it counted as gone at, and stayed there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runStep, exitTarget, isGone, EXIT, OUT, type Runner } from '../renderer/ui/spider-motion.ts';

const W = 1280, H = 800, DT = 1 / 60;
const far = { w: W, h: H, px: -9999, py: -9999, dt: DT };

/** A seeded random, so a failure is the same failure every run. */
function seeded(seed: number): () => number {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function runner(x: number, y: number, over: Partial<Runner> = {}): Runner {
  return { x, y, vx: 0, vy: 0, a: 0, life: 0, wander: 0, stays: false, home: null, ...over };
}

/** Frames until the step says gone, or null if it does not within the limit. */
function framesToGo(s: Runner, limit: number, random: () => number): number | null {
  for (let f = 1; f <= limit; f++) if (runStep(s, far, random) === 'gone') return f;
  return null;
}

test('a spider whose time is up leaves the window, from anywhere in it', () => {
  const random = seeded(385);
  for (let i = 0; i < 200; i++) {
    const s = runner(30 + random() * (W - 60), 60 + random() * (H - 90));
    // the farthest point from every exit is the middle of the window, about 640 px at 150 px/s
    const frames = framesToGo(s, 60 * 10, random);
    assert.ok(frames !== null, `the spider from (${s.x.toFixed(0)}, ${s.y.toFixed(0)}) is still in the list after ten seconds`);
  }
});

test('the exit is past the line a spider is gone at', () => {
  assert.ok(EXIT > OUT);
  for (const [x, y] of [[5, 400], [W - 5, 400], [640, H - 5]]) {
    const t = exitTarget(runner(x, y), W, H);
    assert.ok(isGone(runner(t.x, t.y), W, H), `the target of (${x}, ${y}) counts as gone`);
  }
});

test('a spider never leaves by the top, where the title bar is', () => {
  const t = exitTarget(runner(640, 2), W, H);
  assert.ok(t.y >= 0, 'not up');
});

test('a resident stays in the window, and one going home gets there', () => {
  const random = seeded(7);
  const resident = runner(640, 400, { stays: true });
  assert.equal(framesToGo(resident, 60 * 60, random), null, 'a resident wanders but never leaves');
  assert.ok(!isGone(resident, W, H));

  const homing = runner(200, 300, { stays: true, home: { x: 40, y: 120 } });
  let step: ReturnType<typeof runStep> = 0;
  for (let f = 0; f < 60 * 10 && step !== 'home'; f++) step = runStep(homing, far, random);
  assert.equal(step, 'home');
  assert.equal(homing.home, null, 'home is forgotten once reached');
});

test('a spider with time left wanders inside the window', () => {
  const random = seeded(11);
  const s = runner(640, 400, { life: 120 });
  assert.equal(framesToGo(s, 60 * 60, random), null);
});
