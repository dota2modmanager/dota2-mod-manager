/* The game's own weather over the 3D map: its system (particles/rain_fx/econ_*.vpcf), prepared by
 * Rust as for an effect's picture (preview3d:effect, hero_preview.rs), played by the same runtime
 * as the hero preview (vendor/dota-loadout: Library, Simulation), with everything the weather is
 * made of: the rain and the splashes and puddles it makes on the ground, the snow and its drifts,
 * the moon's beams and fireflies, the plague's bats and roaches, the sandstorm's dust devils.
 *
 * The game hangs a weather on the player's camera (control point 0): the systems set their other
 * points from it themselves (16 a little ahead, 3 the strength, 10 and 20 here and there round it)
 * and trace what lies on the ground down onto the world. Here the camera stands where the game's
 * does over a point of flat ground, the weather runs there once, and map-weather-tiles.ts lays its
 * patches over the whole map in view, each card on the real ground under it (map-heights.ts). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Library, Simulation, SOURCE_TO_GLTF } from 'dota-loadout';
import { SceneSource } from 'dota-loadout/studio';
import { loadoutTextures } from '../preview3d/loadout-textures.ts';
import { loadoutEffects } from '../preview3d/loadout-source.ts';
import type { Heights } from './map-heights.ts';
import { footprint, groundInView, placeAtCamera, placeTiles, tileMeshes, type TiledSystem, type WeatherKind } from './map-weather-tiles.ts';

/** The weathers' systems by the key the record keeps (map_decor.rs WEATHER_KEYS, map_build.rs WEATHERS). */
export const WEATHER_SYSTEMS: Record<string, string> = {
  snow: 'particles/rain_fx/econ_snow.vpcf',
  rain: 'particles/rain_fx/econ_rain.vpcf',
  moonbeam: 'particles/rain_fx/econ_moonlight.vpcf',
  pestilence: 'particles/rain_fx/econ_weather_pestilence.vpcf',
  harvest: 'particles/rain_fx/econ_weather_harvest.vpcf',
  sirocco: 'particles/rain_fx/econ_weather_sirocco.vpcf',
  spring: 'particles/rain_fx/econ_weather_spring.vpcf',
  ash: 'particles/rain_fx/econ_weather_ash.vpcf',
  aurora: 'particles/rain_fx/econ_weather_aurora.vpcf',
};

/** The game's camera over the point it looks at, in game units: 1134 away, 60 degrees down, from the south. */
const CAMERA_DISTANCE = 1134;
const CAMERA_PITCH = (60 * Math.PI) / 180;
/** The control points that carry the weather's strength, at full. */
const STRENGTH = [3, 10, 11];
/** Longest step the simulation takes at once: a frame after the window slept would spawn a burst. */
const MAX_DT = 1 / 20;
/** Seconds run before the first frame, so the sky is full when the weather shows; the patches are measured over the last of them. */
const WARM = 4;
/** A system with too few particles to measure is laid in patches this wide, in game units. */
const PATCH = 1000;
/** A system whose particles all keep this high over the ground lives at the game's camera. One that
 * falls (rain, snow: faster down than FALLING) falls in front of the lens and is gone before the
 * ground: here it is brought down, the drops onto their own splashes. One that hangs there (the
 * aurora's curtains, the moon's motes) stays up: brought down, the aurora lay on the ground as one
 * sheet of light. In game units, and game units a second. */
const AT_CAMERA = 150;
const FALLING = -40;
/** The cards the whole weather is drawn as at most, over all its patches: snow's two thousand flakes
 * a patch nine hundred times over were millions, and the window crawled. */
const BUDGET = 400_000;
/** How far round the point looked at the weather is laid: this many times the camera's distance, and at least this many game units. */
const AROUND = 3;
const AROUND_MIN = 3000;

export interface GameWeather {
  /** a frame: the patches laid over the ground in view, the weather simulated and drawn */
  tick(dt: number, camera: THREE.PerspectiveCamera, target: THREE.Vector3): void;
  /** whether it drew anything in its first seconds; a weather that drew nothing is put back by the cloud */
  readonly alive: boolean;
  readonly warnings: string[];
  dispose(): void;
}

/** The models some weathers draw (bats, butterflies, roaches), loaded before the simulation asks for them. */
async function particleModels(source: SceneSource, fxModels: Record<string, { file: string }>) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const loaded = new Map<string, Awaited<ReturnType<GLTFLoader['loadAsync']>>>();
  await Promise.all(Object.values(fxModels).map(async ({ file }) => {
    if (loaded.has(file)) return;
    try { loaded.set(file, await loader.loadAsync(source.url(file))); } catch { /* a model that does not load is not drawn */ }
  }));
  return {
    get(path: string) {
      const g = loaded.get(fxModels[path]?.file ?? '');
      if (!g) return null;
      const scene = cloneSkinned(g.scene);
      const materials: THREE.Material[] = [];
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        mesh.material = (mesh.material as THREE.Material).clone();
        materials.push(mesh.material as THREE.Material);
      });
      const clips = g.animations.filter((c) => c.name !== 'bindPose' && !c.name.startsWith('@'));
      return { scene, clip: clips.find((c) => /(^|[_/])(idle|loop|fly|run)([_/]|$)/i.test(c.name)) ?? clips[0] ?? null, materials };
    },
  };
}

/**
 * The game's weather `key` over the map in `scene`, or null where the game has none or it cannot be read.
 * `inches`: the map is in the game's units, not in metres as the hero preview's scene is.
 */
export async function gameWeather(scene: THREE.Scene, key: string, inches: boolean, heights: Heights): Promise<GameWeather | null> {
  const path = WEATHER_SYSTEMS[key];
  if (!path) return null;
  const got = await window.api.preview3d.effect(path).catch(() => null);
  if (!got) { console.warn(`map weather: the game has no ${path}`); return null; }
  const source = new SceneSource();
  const textures = await loadoutTextures(source, got.sprites, got.resources);
  const patch = loadoutEffects(source, [{ part: -1, def: got.def }], textures, got.resources);
  const models = await particleModels(source, (patch.fxModels ?? {}) as Record<string, { file: string }>);
  const lib = new Library({
    systems: patch.systems ?? {}, textures: patch.textures ?? {}, snapshots: patch.snapshots ?? {},
    url: (file: string) => (/^[a-z]+:/.test(file) ? file : source.url(`fx/${file}`)),
    models, options: { refract: true, distanceFade: true },
  });
  (lib as unknown as { materials: unknown }).materials = patch.materials ?? {};
  // the systems go in under the runtime's own names (studio/<namespace>/...): the root is the effect's
  const root = patch.effects?.[0]?.system;
  const def = root ? lib.system(root) : null;
  if (!def) { console.warn(`map weather: ${path} came without its root system`, patch.warnings); source.dispose(); return null; }
  // the game's axes to the map's: the hero preview's turn, without its inches to metres when the map kept inches
  const unit = inches ? 1 : 0.0254;
  const toScene = inches ? SOURCE_TO_GLTF.clone().multiply(new THREE.Matrix4().makeScale(1 / 0.0254, 1 / 0.0254, 1 / 0.0254)) : SOURCE_TO_GLTF.clone();
  const fromScene = toScene.clone().invert();
  lib.group.matrix.copy(toScene);
  lib.group.matrixWorldNeedsUpdate = true;
  scene.add(lib.group);
  let sim: Simulation;
  try { sim = new Simulation(def, lib); } catch (e) { console.warn(`map weather: ${path} did not start`, e); scene.remove(lib.group); lib.dispose(); source.dispose(); return null; }
  // the game's camera over the origin, looking north and down at it: control point 0
  const forward = new THREE.Vector3(0, Math.cos(CAMERA_PITCH), -Math.sin(CAMERA_PITCH));
  const eye = forward.clone().multiplyScalar(-CAMERA_DISTANCE);
  const cp0 = { pos: eye, quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), forward),
    matrix() { return new THREE.Matrix4().compose(this.pos, this.quat, new THREE.Vector3(1, 1, 1)); } };
  sim.cps.set(0, cp0);
  // the weather's strength, which the game hands the moon's and the dust's systems in the x of these
  // points (their rate of fireflies, beams, butterflies is x times their own); a system that sets
  // one of them itself (snow's 3, the drifts' 10) keeps its own
  for (const i of STRENGTH) {
    sim.cps.set(i, { pos: new THREE.Vector3(1, 1, 1), quat: new THREE.Quaternion(),
      matrix() { return new THREE.Matrix4().compose(this.pos, this.quat, new THREE.Vector3(1, 1, 1)); } });
  }
  // run, and measure where each system's particles lie over the last second
  const seen = new Map<Simulation, THREE.Vector3[]>();
  const low = new Map<Simulation, number[]>();
  const fall = new Map<Simulation, number[]>();
  for (let t = 0; t < WARM; t += MAX_DT) {
    sim.update(MAX_DT);
    if (t > WARM - 1) for (const s of sim.all()) for (const p of (s as unknown as { particles: { pos: THREE.Vector3; prev: THREE.Vector3 }[] }).particles) {
      const vz = fall.get(s) ?? [];
      vz.push((p.pos.z - p.prev.z) / MAX_DT);
      fall.set(s, vz);
      const list = seen.get(s) ?? [];
      if (list.length < 4000) list.push(p.pos.clone().applyMatrix4(toScene));
      seen.set(s, list);
      const zs = low.get(s) ?? [];
      if (zs.length < 4000) zs.push(p.pos.z);
      low.set(s, zs);
    }
  }
  const systems: TiledSystem[] = [];
  // each system's models (a bat, a butterfly) and how far they come down, as its cards do
  type Renderer = { batch?: { mesh: THREE.Mesh }; instances?: Map<unknown, { scene: THREE.Object3D }>;
    strength?: (s: unknown) => number; update(ps: unknown[], s: unknown, camera: THREE.Camera, gi: THREE.Matrix4): void };
  type Part = { renderers: Renderer[]; particles: unknown[]; state: unknown };
  const modelled: { renderers: Renderer[]; lift: number }[] = [];
  const drawn: { part: Part; sys: TiledSystem | null }[] = [];
  const parts = [...sim.all()].length;
  for (const s of sim.all()) {
    const part = s as unknown as Part;
    const zs = (low.get(s) ?? []).sort((a, b) => a - b);
    const bottom = zs.length ? zs[Math.floor(zs.length * 0.05)] : 0;
    const vz = fall.get(s) ?? [];
    const falls = vz.length > 0 && vz.reduce((a, b) => a + b, 0) / vz.length < FALLING;
    const kind: WeatherKind = bottom > AT_CAMERA ? (falls ? 'falling' : 'camera') : 'ground';
    const lift = kind === 'falling' ? -bottom * unit : 0;
    // its share of the budget: as many patches as its particles leave room for
    const cap = Math.max(16, Math.floor(BUDGET / parts / Math.max(1, part.particles.length) / Math.max(1, part.renderers.length)));
    if (part.renderers.some((r) => r.instances)) modelled.push({ renderers: part.renderers, lift });
    const meshes = part.renderers.map((r) => r.batch?.mesh).filter((m): m is THREE.Mesh => !!m);
    if (!meshes.length) { drawn.push({ part, sys: null }); continue; }
    const { centre, size } = footprint(seen.get(s) ?? [], PATCH * unit);
    const sys: TiledSystem = { kind, centre, size, meshes, ...tileMeshes(meshes, heights, kind, lift), cap, key: '' };
    systems.push(sys);
    drawn.push({ part, sys });
  }
  // the cards face the camera as seen from where their copy stands: a tiled one from the patch under
  // the point looked at, one round the camera from its copy, turned and grown
  const onGround = { matrixWorld: new THREE.Matrix4() } as THREE.Camera;
  const atCamera = { matrixWorld: new THREE.Matrix4() } as THREE.Camera;
  const north = new THREE.Vector3(0, 1, 0).transformDirection(toScene);
  const place = new THREE.Matrix4();
  let age = 0;
  let drew = false;
  let logged = false;
  return {
    tick(dt, camera, target) {
      const dist = camera.position.distanceTo(target);
      const reach = Math.max(dist * AROUND, AROUND_MIN * unit);
      const view = groundInView(camera, target, reach, heights.box);
      const ground = heights.at(target.x, target.z);
      // the game's camera is this far off; past it the ground's glows fade, the falling less
      const near = Math.min(1, (CAMERA_DISTANCE * 2 * unit) / Math.max(dist, 1e-6));
      // the camera's way over the ground, and the turn from the game's (north) to it
      const look = new THREE.Vector3().subVectors(target, camera.position);
      const yaw = Math.atan2(north.x * look.z - north.z * look.x, north.x * look.x + north.z * look.z);
      const grow = dist / (CAMERA_DISTANCE * unit);
      let patches = 0;
      for (const x of systems) {
        if (x.kind === 'camera') { placeAtCamera(x, target.x, ground, target.z, grow, yaw); patches++; continue; }
        patches += placeTiles(x, view);
        const fade = x.kind === 'ground' ? Math.max(0.15, near) : Math.max(0.5, near);
        for (const u of x.uniforms) u.uFade.value = fade;
      }
      onGround.matrixWorld.makeTranslation(-target.x, -ground, -target.z).multiply(camera.matrixWorld);
      place.makeTranslation(target.x, ground, target.z).multiply(new THREE.Matrix4().makeRotationY(-yaw)).multiply(new THREE.Matrix4().makeScale(grow, grow, grow));
      atCamera.matrixWorld.copy(place).invert().multiply(camera.matrixWorld);
      sim.update(Math.min(dt, MAX_DT));
      // drawn system by system (sim.render draws them all from one camera)
      for (const { part, sys } of drawn) {
        const eye = sys?.kind === 'camera' ? atCamera : onGround;
        for (const r of part.renderers) r.update(r.strength && r.strength(part.state) <= 0 ? [] : part.particles, part.state, eye, fromScene);
      }
      // a model (a bat, a butterfly) stands once, in the patch in view, over the ground under it
      for (const { renderers, lift } of modelled) for (const r of renderers) for (const { scene: o } of r.instances?.values() ?? []) {
        if (!o.visible) continue;
        const at = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(toScene, o.matrix));
        const move = new THREE.Matrix4().makeTranslation(target.x, heights.at(at.x + target.x, at.z + target.z) + lift, target.z);
        o.matrix.premultiply(fromScene.clone().multiply(move).multiply(toScene));
        o.matrixWorldNeedsUpdate = true;
      }
      const was = age;
      age += dt;
      if (sim.count() > 0) drew = true;
      if (!logged && was < 2 && age >= 2) {
        logged = true;
        console.info(`map weather: ${key}: ${sim.count()} particles in ${systems.length} systems, ${patches} patches`);
      }
    },
    get alive() { return drew || age < 2; },
    get warnings() { return [...lib.unsupported]; },
    dispose() {
      sim.dispose();
      scene.remove(lib.group);
      lib.dispose();
      source.dispose();
    },
  };
}
