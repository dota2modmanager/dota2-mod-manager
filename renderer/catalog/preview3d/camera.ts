/* Moving around the hero in the 3D preview. The hero stays the one that turns, as in the game, so
 * the light stays on it where the game keeps it; the camera around that is free: up and down an
 * arc over the hero, closer and further, and off to a side, by the mouse or by keys as in a
 * free-look camera. Keys go by the key's place (`code`), so WASD works in the Russian layout too. */

/** How far the camera climbs the arc, in radians: from a little under the waist to nearly overhead. */
export const TILT = { min: -0.2, max: 1.35 };
/** The distance as a share of the framed one: close enough for a face, far enough for the whole stage. */
export const ZOOM = { min: 0.12, max: 1.6 };

type Point = { x: number; y: number; z: number };

/** The tilt held inside TILT. */
export const clampTilt = (tilt: number) => Math.min(TILT.max, Math.max(TILT.min, tilt));

/** The zoom after a wheel notch: each one is the same share of what is left, so close up it stays fine. */
export function stepZoom(zoom: number, dy: number): number {
  return Math.min(ZOOM.max, Math.max(ZOOM.min, zoom * (1 + Math.sign(dy) * 0.08)));
}

/**
 * Where the camera stands to look at `target`.
 * @param view  the flat direction from the hero toward the camera, of length 1
 */
export function cameraAt(target: Point, view: { x: number; z: number }, tilt: number, distance: number): Point {
  const flat = Math.cos(tilt) * distance;
  return { x: target.x + view.x * flat, y: target.y + Math.sin(tilt) * distance, z: target.z + view.z * flat };
}

const held = (keys: ReadonlySet<string>, plus: string, minus: string) => (keys.has(plus) ? 1 : 0) - (keys.has(minus) ? 1 : 0);

/** How far the held keys carry the camera this frame: half its distance from the hero a second, three times that with Shift. */
export function keyMove(keys: ReadonlySet<string>, dt: number, distance: number): { right: number; forward: number; up: number } {
  const step = distance * 0.5 * dt * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1);
  return { right: held(keys, 'KeyD', 'KeyA') * step, forward: held(keys, 'KeyW', 'KeyS') * step, up: held(keys, 'KeyE', 'KeyQ') * step };
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);

/**
 * The mouse and the keys on the canvas. Dragging sideways turns the hero and it coasts a little after
 * the hand lets go, as the game's does; dragging up or down tilts the camera; the right or the
 * middle button moves it; the keys work while the canvas has the focus, which a click gives it.
 */
export function viewControls(el: HTMLElement, { onTilt, onPan, onZoom, onReset }: {
  onTilt: (dy: number) => void; onPan: (dx: number, dy: number) => void; onZoom: (dy: number) => void; onReset: () => void;
}) {
  const keys = new Set<string>();
  let yaw = 0;
  let speed = 0;
  let from: { x: number; y: number; pan: boolean } | null = null;
  const down = (e: PointerEvent) => {
    from = { x: e.clientX, y: e.clientY, pan: e.button !== 0 };
    speed = 0;
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
  };
  const move = (e: PointerEvent) => {
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    from.x = e.clientX;
    from.y = e.clientY;
    if (from.pan) { onPan(dx, dy); return; }
    speed = dx * 0.012;
    yaw += speed;
    onTilt(dy * 0.006);
  };
  const up = () => { from = null; };
  const wheel = (e: WheelEvent) => { e.preventDefault(); onZoom(e.deltaY); };
  const menu = (e: Event) => e.preventDefault();
  const reset = () => { yaw = 0; speed = 0; onReset(); };
  const keyDown = (e: KeyboardEvent) => {
    if (!MOVE_KEYS.has(e.code) || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    keys.add(e.code);
  };
  const keyUp = (e: KeyboardEvent) => { keys.delete(e.code); };
  const blur = () => keys.clear();
  const events: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', down as EventListener], ['pointermove', move as EventListener], ['pointerup', up], ['pointercancel', up],
    ['wheel', wheel as EventListener, { passive: false }], ['contextmenu', menu], ['dblclick', reset],
    ['keydown', keyDown as EventListener], ['keyup', keyUp as EventListener], ['blur', blur],
  ];
  for (const [name, fn, opts] of events) el.addEventListener(name, fn, opts);
  return {
    keys: keys as ReadonlySet<string>,
    reset,
    step(): number {
      if (!from && Math.abs(speed) > 1e-4) { yaw += speed; speed *= 0.9; }
      return yaw;
    },
    dispose() {
      for (const [name, fn] of events) el.removeEventListener(name, fn);
    },
  };
}
