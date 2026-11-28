/* The map's standing effects over the 3D map, as the game plays them where the map puts them
 * (dota_world_particle_system and info_particle_system in default_ents: the river's flow and foam
 * along its banks, fireflies and butterflies, the lamps' and candles' flames, the Dire's lava). Each
 * system is prepared by Rust as for an effect's picture (preview3d:effect) and played by the hero
 * preview's runtime (vendor/dota-loadout), one copy per place, control point 0 where the entity
 * stands and turned as it is. Only the copies near the middle of the view run: the map has nine
 * hundred of them in thirty systems, and a system is loaded the first time one of its copies is near. */
import * as THREE from 'three';
import { Library, Simulation, SOURCE_TO_GLTF } from 'dota-loadout';
import { SceneSource } from 'dota-loadout/studio';
import type { DecorGroup } from '../../api/decor.ts';
import { loadoutTextures } from '../preview3d/loadout-textures.ts';
import { loadoutEffects } from '../preview3d/loadout-source.ts';
import { particleLight } from './map-light.ts';

/** One of the map's effects as the core lists it (map_build.rs world_effects): inches and degrees. */
export interface WorldEffect { fx: string; at: number[]; turn: number[]; group?: string }

export interface MapEffects {
  /** a frame: the copies near `target` started or stopped, each run and drawn; whether any runs */
  tick(dt: number, camera: THREE.Camera, target: THREE.Vector3): boolean;
  /** the Optimization groups taken away: their effects stop */
  hide(groups: ReadonlySet<DecorGroup>): void;
  dispose(): void;
}

/** How many copies run at once, and how far from the middle of the view they may stand (game units). */
const MOST = 64;
const NEAR = 2600;
/** Longest step the simulation takes at once, and how long a copy runs before it is first shown. */
const MAX_DT = 1 / 20;
const WARM = 2;

/** A system loaded once for all its copies: its runtime library and its root definition. */
interface Loaded { lib: Library; def: Record<string, unknown>; source: SceneSource }

/** Source's pitch, yaw, roll (degrees) as a turn: yaw about up, then pitch, then roll. */
function turnOf(t: number[]): THREE.Quaternion {
  const [p, y, r] = t.map(THREE.MathUtils.degToRad);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(r ?? 0, p ?? 0, y ?? 0, 'ZYX'));
}

export function mapEffects(scene: THREE.Scene, list: WorldEffect[]): MapEffects {
  // the game's axes to the window's (metres), as the weather's
  const toScene = SOURCE_TO_GLTF.clone();
  const fromScene = toScene.clone().invert();
  const loaded = new Map<string, Promise<Loaded | null>>();
  const ready = new Map<string, Loaded>();
  const running = new Map<WorldEffect, Simulation>();
  let hidden: ReadonlySet<string> = new Set();
  let disposed = false;
  const centre = new THREE.Vector3(Infinity, 0, 0);
  // the copies chosen last, which a system still loading starts when it is ready
  let wanted = new Set<WorldEffect>();

  const load = (fx: string): Promise<Loaded | null> => {
    const had = loaded.get(fx);
    if (had) return had;
    const p = (async () => {
      const got = await window.api.preview3d.effect(fx).catch(() => null);
      if (!got || disposed) return null;
      const source = new SceneSource();
      const textures = await loadoutTextures(source, got.sprites, got.resources);
      const patch = loadoutEffects(source, [{ part: -1, def: got.def }], textures, got.resources);
      const lib = new Library({
        systems: patch.systems ?? {}, textures: patch.textures ?? {}, snapshots: patch.snapshots ?? {},
        url: (file: string) => (/^[a-z]+:/.test(file) ? file : source.url(`fx/${file}`)),
        options: { refract: true, distanceFade: true, globalLight: particleLight },
      });
      (lib as unknown as { materials: unknown }).materials = patch.materials ?? {};
      const root = patch.effects?.[0]?.system;
      const def = root ? lib.system(root) : null;
      if (!def || disposed) { lib.dispose(); source.dispose(); return null; }
      lib.group.matrix.copy(toScene);
      lib.group.matrixAutoUpdate = false;
      lib.group.matrixWorldNeedsUpdate = true;
      scene.add(lib.group);
      const l = { lib, def, source };
      ready.set(fx, l);
      return l;
    })().catch((e) => { console.warn(`map effects: ${fx} did not load`, e); return null; });
    loaded.set(fx, p);
    return p;
  };

  const start = (e: WorldEffect, l: Loaded) => {
    let sim: Simulation;
    try { sim = new Simulation(l.def, l.lib); } catch (err) { console.warn(`map effects: ${e.fx} did not start`, err); return; }
    const pos = new THREE.Vector3(e.at[0], e.at[1], e.at[2]);
    const quat = turnOf(e.turn);
    sim.cps.set(0, { pos, quat, matrix() { return new THREE.Matrix4().compose(this.pos, this.quat, new THREE.Vector3(1, 1, 1)); } });
    // run a while first, so a flame is lit and the fireflies are out when it shows
    for (let t = 0; t < WARM; t += MAX_DT) sim.update(MAX_DT);
    running.set(e, sim);
  };
  const stop = (e: WorldEffect) => {
    const sim = running.get(e);
    if (!sim) return;
    sim.dispose();
    running.delete(e);
  };

  // the copies nearest the middle of the view, chosen again once it moved
  const choose = (target: THREE.Vector3) => {
    centre.copy(target);
    const at = target.clone().applyMatrix4(fromScene);
    const near = list
      .filter((e) => !hidden.has(e.group ?? 'mapFx'))
      .map((e) => ({ e, d: Math.hypot(e.at[0] - at.x, e.at[1] - at.y) }))
      .filter((x) => x.d < NEAR)
      .sort((a, b) => a.d - b.d).slice(0, MOST).map((x) => x.e);
    wanted = new Set(near);
    for (const e of [...running.keys()]) if (!wanted.has(e)) stop(e);
    for (const e of near) {
      if (running.has(e)) continue;
      const l = ready.get(e.fx);
      if (l) start(e, l);
      else void load(e.fx).then((x) => { if (x && !disposed && wanted.has(e) && !running.has(e)) start(e, x); });
    }
  };

  return {
    tick(dt, camera, target) {
      if (centre.distanceTo(target) > 4) choose(target);
      const step = Math.min(dt, MAX_DT);
      for (const sim of running.values()) {
        sim.update(step);
        sim.render(camera, fromScene);
      }
      return running.size > 0;
    },
    hide(groups) {
      hidden = new Set(groups);
      centre.set(Infinity, 0, 0);
    },
    dispose() {
      disposed = true;
      for (const e of [...running.keys()]) stop(e);
      for (const l of ready.values()) { scene.remove(l.lib.group); l.lib.dispose(); l.source.dispose(); }
      ready.clear();
    },
  };
}
