/* The map's trees in the Optimization window, as the builds leave them: each tree as it is, the
 * lightest of its kind (treesSimple), the lightest tree of the map (trees), or a tree set of the
 * game for Radiant or Dire (Trees from the game, map_looks_service.rs), which wins on its side.
 * The toolchain's world names each tree's node after its model (dire_tree004.dire_tree004_model);
 * the trees the map merged into one draw (agg_prop_...) have no model to go by, so they become a
 * lighter tree only when every tree does. Each tree node also brings its stump and its close-up
 * copy for the inspector, which the game shows only when they are called for: those never draw. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeMeshesAsync } from './map-merge.ts';

export type TreeMode = 'own' | 'kind' | 'map';
export type Side = 'radiant' | 'dire';
/** A set's model per side, as source paths; a side left out keeps its own. */
export type SideModels = Partial<Record<Side, string>>;

/** A tree node's own model, by the node's name: "dire_tree004" of "dire_tree004.dire_tree004_model". */
export function treeModelOf(name: string): string | null {
  if (!name || /agg_prop/.test(name)) return null;
  const n = name.toLowerCase();
  if (n.includes('.')) return n.slice(0, n.indexOf('.'));
  // three takes the dot out of a node's name as it loads the map ("dire_tree004dire_tree004_model"),
  // and numbers a name it has seen; the tree's own part is its model's name twice
  return /^(.+?)\1_model(?:_\d+)?$/.exec(n)?.[1] ?? null;
}

/** A stump or the inspector's close-up copy: parts of a tree node the map does not show. */
export const hiddenPart = (name: string): boolean => /_stump|_inspector/i.test(name);

/** "models/props_tree/dire_tree004.vmdl" as "dire_tree004". */
export const stemOf = (path: string): string => (path.split('/').pop() || '').replace(/\.vmdl(_c)?$/, '').toLowerCase();

/** Radiant is the map's south-west half, Dire its north-east, split along the river's diagonal. */
export function sideAt(x: number, z: number, centre: THREE.Vector3): Side {
  return (x - centre.x) - (z - centre.z) > 0 ? 'dire' : 'radiant';
}

/** What a tree without a material of its own wears, one for all. */
const leaf = new THREE.MeshStandardMaterial({ color: 0x2c4a1e, roughness: 1, metalness: 0 });

/** A model of the game, or of a catalog mod ("mod:<file>|<model>"), as meshes ready to instance,
 * its stump and close-up copy left out. */
export async function modelParts(path: string, prepare: (m: THREE.Material) => void): Promise<THREE.Mesh[]> {
  const mod = /^mod:([^|]+)\|(.+)$/.exec(path);
  const bytes = await (mod ? window.api.decor.modModel(mod[1], mod[2]) : window.api.preview3d.model(path)).catch(() => null);
  if (!bytes) return [];
  const gltf = await new GLTFLoader().parseAsync(bytes.slice().buffer, '').catch(() => null);
  if (!gltf) return [];
  gltf.scene.updateMatrixWorld(true);
  const out: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !hiddenPart(o.name)) out.push(o as THREE.Mesh); });
  // a part whose material the toolchain could not find has none, and three draws it white: a leaf's green
  for (const p of out) if (!Array.isArray(p.material) && !(p.material.userData as { vmat?: unknown }).vmat) p.material = leaf;
  for (const p of out) [p.material].flat().forEach(prepare);
  return out;
}

/** `parts` once at each of `places`; `lifted`: stood on the ground when its middle is at its origin. */
export function instanced(parts: THREE.Mesh[], places: THREE.Matrix4[], lifted: boolean): THREE.Group {
  const group = new THREE.Group();
  const low = parts.reduce((y, x) => Math.min(y, new THREE.Box3().setFromObject(x).min.y), Infinity);
  const lift = new THREE.Matrix4().makeTranslation(0, lifted && Number.isFinite(low) ? -low : 0, 0);
  const m4 = new THREE.Matrix4();
  for (const part of parts) {
    const inst = new THREE.InstancedMesh(part.geometry, part.material, places.length);
    places.forEach((a, i) => inst.setMatrixAt(i, m4.copy(a).multiply(lift).multiply(part.matrixWorld)));
    inst.instanceMatrix.needsUpdate = true;
    inst.matrixAutoUpdate = false;
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
  return group;
}

export interface Trees {
  /** `mod`: a catalog mod's trees by the name of the game's tree each stands in for, which win */
  show(mode: TreeMode, set: SideModels, mod?: Record<string, string>): void;
}

interface Place { at: THREE.Matrix4; model: string | null; side: Side }

/**
 * The trees of the map set up for switching: `kind` maps each tree model to the lightest of its
 * kind, `everyTo` is the tree every tree becomes. What replaces them is instanced, one instance at
 * each tree's place, loaded the first time it is asked for.
 */
export async function mapTrees(scene: THREE.Scene, trees: THREE.Mesh[], kind: Map<string, string>, everyTo: string | undefined,
  centre: THREE.Vector3, prepare: (m: THREE.Material) => void, changed: () => void): Promise<Trees> {
  const AGG = ' merged';
  const modelOf = (t: THREE.Mesh) => treeModelOf(t.name) ?? treeModelOf(t.parent?.name ?? '');
  const sideOf = (t: THREE.Mesh) => sideAt(t.matrixWorld.elements[12], t.matrixWorld.elements[14], centre);
  const places = new Map<string, Place>();
  for (const t of trees) {
    const e = t.matrixWorld.elements;
    const key = [12, 13, 14].map((k) => Math.round(e[k] * 4)).join('|');
    // an instance cannot turn its faces round as a mirrored object does: a mirrored tree is
    // mirrored back on one axis, which a tree does not show
    const at = t.matrixWorld.clone();
    if (at.determinant() < 0) at.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    if (!places.has(key)) places.set(key, { at, model: modelOf(t), side: sideOf(t) });
  }
  // the trees drawn as one mesh per model, side and material: they swap together anyway
  const own = await mergeMeshesAsync(trees, (t) => `${modelOf(t) ?? AGG}|${sideOf(t)}`, scene);
  // what replaces trees, by the model and the places it was built for
  const built = new Map<string, THREE.Group | null>();
  let mode: TreeMode = 'own';
  let set: SideModels = {};
  let mod: Record<string, string> = {};

  /** what the tree at a place becomes now, or null for itself */
  const targetOf = (p: { model: string | null; side: Side }): string | null =>
    (p.model ? mod[p.model] : undefined) ?? set[p.side] ?? (mode === 'map' ? everyTo ?? null : mode === 'kind' && p.model ? kind.get(p.model) ?? null : null);

  const apply = () => {
    // each model asked for now, with the places it stands at
    const by = new Map<string, THREE.Matrix4[]>();
    for (const p of places.values()) {
      const to = targetOf(p);
      if (to) by.set(to, [...(by.get(to) ?? []), p.at]);
    }
    const keyOf = (to: string) => `${to}#${by.get(to)?.length ?? 0}`;
    const wanted = new Map([...by.keys()].map((to) => [keyOf(to), to]));
    for (const [key, g] of built) if (g) g.visible = wanted.has(key);
    for (const [key, to] of wanted) {
      if (built.has(key)) continue;
      built.set(key, null);
      const at = by.get(to) ?? [];
      void modelParts(to, prepare).then((parts) => {
        if (!parts.length) return;
        const g = instanced(parts, at, true);
        built.set(key, g);
        scene.add(g);
        apply();
      });
    }
    for (const [key, meshes] of own) {
      const [model, side] = key.split('|') as [string, Side];
      const to = targetOf({ model: model === AGG ? null : model, side });
      const ready = !!to && !!built.get(keyOf(to));
      for (const t of meshes) t.visible = !ready;
    }
    changed();
  };

  return {
    show(nextMode, nextSet, nextMod) { mode = nextMode; set = nextSet; mod = nextMod ?? {}; apply(); },
  };
}
