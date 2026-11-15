/* The weather over the map, as one simulation drawn many times. The game plays its weather round
 * the player's camera, and its systems are of three kinds (map-game-weather.ts tells them apart):
 * - on the ground (puddles, splashes, drifts, the plague's fog and roaches): a patch a few hundred
 *   units across, laid side by side over the ground in view, each card on the ground under it
 *   (map-heights.ts), the grid jittered so it does not show, faded seen from far off (the game never
 *   shows its ground glows from that far, and a whole map of them was one sheet of light);
 * - falling past the camera (rain, snow): brought down to the ground and laid the same way;
 * - hanging round the camera (the aurora's curtains, the moon's motes): one copy round the window's
 *   camera, turned with it and grown with its distance, so it stands to the camera as it does in
 *   the game at any zoom (laid over the ground, the aurora was a carpet; left where it was, the
 *   camera flew into it).
 * Past a budget, patches are thinned the same way each time, so the cards stay a few hundred
 * thousand and not millions. */
import * as THREE from 'three';
import type { Heights } from './map-heights.ts';

/** Most patches one system is drawn as; past it, they are thinned. */
const CAP = 900;
/** How far a patch strays from its cell, as a share of the cell: the grid is not seen. */
const JITTER = 0.3;

// the particle runtime's card shader (vendor/dota-loadout/src/fx.js), each card turned, grown and
// moved to its patch (tile: x, z, scale, turn), set on the ground or raised, and faded
const VERT = `
attribute vec4 color; attribute vec4 uvA; attribute vec4 uvB; attribute float blend; attribute vec4 tile;
uniform sampler2D uHeight; uniform vec4 uHeightBox; uniform float uFloor; uniform float uLift; uniform float uFollow; uniform float uFade;
varying vec4 vColor; varying vec2 vUvA; varying vec2 vUvB; varying float vBlend;
float ground(vec2 xz) {
  vec2 st = clamp(vec2((xz.x - uHeightBox.x) / uHeightBox.z, 1.0 - (xz.y - uHeightBox.y) / uHeightBox.w), 0.0, 1.0);
  vec4 h = texture2D(uHeight, st); return h.a > 0.5 ? h.r : uFloor;
}
void main() {
  vColor = vec4(color.rgb, color.a * uFade); vUvA = mix(uvA.xy, uvA.zw, uv); vUvB = mix(uvB.xy, uvB.zw, uv); vBlend = blend;
  vec4 w = modelMatrix * vec4(position, 1.0);
  float c = cos(tile.w), s = sin(tile.w);
  w.xz = vec2(c * w.x - s * w.z, s * w.x + c * w.z) * tile.z + tile.xy;
  w.y = w.y * tile.z + uLift + (uFollow > 0.5 ? ground(w.xz) : 0.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export type WeatherKind = 'ground' | 'falling' | 'camera';

/** One system's cards, drawn once per patch, or once round the camera. */
export interface TiledSystem {
  kind: WeatherKind;
  /** the patch's centre and size on the ground, in the scene */
  centre: THREE.Vector2;
  size: THREE.Vector2;
  meshes: THREE.Mesh[];
  tiles: THREE.InstancedBufferAttribute;
  /** the materials' own uniforms: the fade and the lift, set each frame */
  uniforms: { uFade: THREE.IUniform<number>; uLift: THREE.IUniform<number> }[];
  /** most patches it is drawn as: fewer for a system of many particles (map-game-weather.ts's budget) */
  cap: number;
  key: string;
}

/** A system's card meshes made to be drawn once per patch over the ground in `heights`. */
export function tileMeshes(meshes: THREE.Mesh[], heights: Heights, kind: WeatherKind, lift: number): Pick<TiledSystem, 'tiles' | 'uniforms'> {
  const tiles = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const uniforms: TiledSystem['uniforms'] = [];
  for (const mesh of meshes) {
    const was = mesh.geometry;
    const g = new THREE.InstancedBufferGeometry();
    // the same buffers: the runtime fills them each frame through mesh.geometry, which is this one now
    g.setIndex(was.index);
    for (const [name, a] of Object.entries(was.attributes)) g.setAttribute(name, a);
    g.setAttribute('tile', tiles);
    g.instanceCount = 0;
    g.setDrawRange(0, 0);
    // the old geometry is not disposed: its buffers are the new one's, and disposing frees them on the GPU
    mesh.geometry = g;
    const m = mesh.material as THREE.ShaderMaterial;
    m.vertexShader = VERT;
    const own = { uFade: { value: 1 }, uLift: { value: lift } };
    Object.assign(m.uniforms, own, { uHeight: { value: heights.texture }, uHeightBox: { value: heights.box }, uFloor: { value: heights.floor }, uFollow: { value: kind === 'camera' ? 0 : 1 } });
    uniforms.push(own);
    m.needsUpdate = true;
  }
  return { tiles, uniforms };
}

/**
 * The ground in view: where the corners of the screen meet the plane at the point looked at, inside
 * the map, and no further from that point than `reach` (towards the horizon the view runs to the
 * map's end, and the game never shows its weather that far from the player).
 */
export function groundInView(camera: THREE.PerspectiveCamera, target: THREE.Vector3, reach: number, map: THREE.Vector4): THREE.Box2 {
  const out = new THREE.Box2();
  const far = camera.far * 0.5;
  const eye = camera.position;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
    const dir = new THREE.Vector3(sx, sy, 0.5).unproject(camera).sub(eye).normalize();
    const t = dir.y < -1e-3 ? Math.min((target.y - eye.y) / dir.y, far) : far;
    const p = eye.clone().addScaledVector(dir, t);
    out.expandByPoint(new THREE.Vector2(p.x, p.z));
  }
  const near = new THREE.Box2(new THREE.Vector2(target.x - reach, target.z - reach), new THREE.Vector2(target.x + reach, target.z + reach));
  return out.intersect(near).intersect(new THREE.Box2(new THREE.Vector2(map.x, map.y), new THREE.Vector2(map.x + map.z, map.y + map.w)));
}

/** A cell's own numbers in 0..1, the same each time: which patches stay, and where in the cell. */
const hash = (x: number, z: number, k: number) => { const h = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453; return h - Math.floor(h); };

/** The patches of a system over `view`, on a grid fixed to the map so they do not swim as the view moves; the count. */
export function placeTiles(sys: TiledSystem, view: THREE.Box2): number {
  if (view.isEmpty()) { setCount(sys, 0, 'empty'); return 0; }
  const sx = sys.size.x, sz = sys.size.y;
  const x0 = Math.floor(view.min.x / sx), x1 = Math.ceil(view.max.x / sx);
  const z0 = Math.floor(view.min.y / sz), z1 = Math.ceil(view.max.y / sz);
  const key = `${x0}|${x1}|${z0}|${z1}`;
  if (key === sys.key) return count(sys);
  const cap = Math.min(CAP, sys.cap);
  const keep = Math.min(1, cap / ((x1 - x0 + 1) * (z1 - z0 + 1)));
  const a = sys.tiles.array as Float32Array;
  let n = 0;
  for (let ix = x0; ix <= x1 && n < cap; ix++) {
    for (let iz = z0; iz <= z1 && n < cap; iz++) {
      if (keep < 1 && hash(ix, iz, 0) >= keep) continue;
      // the patch's centre lands in the cell, off its middle by a little of its own
      a[n * 4] = (ix + (hash(ix, iz, 1) - 0.5) * JITTER) * sx - sys.centre.x;
      a[n * 4 + 1] = (iz + (hash(ix, iz, 2) - 0.5) * JITTER) * sz - sys.centre.y;
      a[n * 4 + 2] = 1;
      a[n * 4 + 3] = 0;
      n++;
    }
  }
  sys.tiles.needsUpdate = true;
  setCount(sys, n, key);
  return n;
}

/** A system that hangs round the camera, once: its origin at (x, y, z), turned by `yaw`, grown by `scale`. */
export function placeAtCamera(sys: TiledSystem, x: number, y: number, z: number, scale: number, yaw: number): void {
  const a = sys.tiles.array as Float32Array;
  a[0] = x; a[1] = z; a[2] = scale; a[3] = yaw;
  sys.tiles.needsUpdate = true;
  for (const u of sys.uniforms) u.uLift.value = y;
  setCount(sys, 1, 'camera');
}

const count = (sys: TiledSystem) => (sys.meshes[0] ? (sys.meshes[0].geometry as THREE.InstancedBufferGeometry).instanceCount : 0);

function setCount(sys: TiledSystem, n: number, key: string): void {
  sys.key = key;
  for (const m of sys.meshes) (m.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
}

/** Where a system's particles lie on the ground, in the scene: all but the farthest few. */
export function footprint(points: THREE.Vector3[], fallback: number): { centre: THREE.Vector2; size: THREE.Vector2 } {
  if (points.length < 8) return { centre: new THREE.Vector2(), size: new THREE.Vector2(fallback, fallback) };
  const xs = points.map((p) => p.x).sort((a, b) => a - b);
  const zs = points.map((p) => p.z).sort((a, b) => a - b);
  const q = (v: number[], f: number) => v[Math.min(v.length - 1, Math.floor(v.length * f))];
  const lo = new THREE.Vector2(q(xs, 0.02), q(zs, 0.02)), hi = new THREE.Vector2(q(xs, 0.98), q(zs, 0.98));
  const size = hi.clone().sub(lo).max(new THREE.Vector2(fallback * 0.25, fallback * 0.25));
  return { centre: lo.add(hi).multiplyScalar(0.5), size };
}
