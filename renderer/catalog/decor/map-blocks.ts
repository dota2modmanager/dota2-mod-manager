/* The blocks a tree side can turn into (crates/mm-core/src/looks/tree_blocks.rs), drawn by the
 * window itself: the game has no such model to export. A block is the square a tree blocks, 128
 * units each way and 96 tall, a cropped hedge; it stands straight at each tree's place, as the map
 * built with it stands those trees (map_build.rs one_size_trees), so the forest reads as the cells
 * a hero cannot walk on. */
import * as THREE from 'three';
import { INCH } from './map-light.ts';

/** A side's blocks, as the tree options name their models ("blocks:radiant"). */
export const isBlockModel = (path: string): boolean => path.startsWith('blocks:');

/** The trees the build turns into blocks (tree_sets.rs DEFAULT_RADIANT, DEFAULT_DIRE): the game's
 * other plants stay as they are. */
export const BLOCK_TREES: ReadonlySet<string> = new Set([
  'tree_pine_01', 'tree_oak_01b', 'tree_oak_01', 'tree_oak_02', 'tree_pine_02', 'tree_bamboo_02', 'tree_pine_03b', 'tree_bamboo_01',
  'dire_tree004', 'dire_tree004b', 'dire_tree008', 'dire_tree007',
]);

/** A block's side and height, in game units. */
const SIDE = 128;
const HEIGHT = 96;

/** The hedge: leaves in a few greens, as the game's cropped hedge reads from above. */
function hedge(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#3f6a2c';
    g.fillRect(0, 0, 128, 128);
    const greens = ['#2f5622', '#4f7d36', '#36602a', '#5a8a3e'];
    for (let i = 0; i < 700; i++) {
      g.fillStyle = greens[i % greens.length];
      const x = (i * 37) % 128, y = (i * 53 + (i >> 3) * 11) % 128;
      g.beginPath(); g.ellipse(x, y, 4, 2.5, (i % 7) * 0.45, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One block, its foot at its origin, in game units. */
export function blockParts(prepare: (m: THREE.Material) => void): THREE.Mesh[] {
  const geometry = new THREE.BoxGeometry(SIDE, HEIGHT, SIDE);
  geometry.translate(0, HEIGHT / 2, 0);
  const material = new THREE.MeshStandardMaterial({ map: hedge(), roughness: 1, metalness: 0 });
  prepare(material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  return [mesh];
}

/** A tree's place for a block: where the tree is, straight, in game units (the map keeps metres or
 * inches: a tree's model comes in metres, which its place turns into the map's units). */
export function blockPlace(at: THREE.Matrix4): THREE.Matrix4 {
  const e = at.elements;
  const unit = new THREE.Vector3(e[0], e[1], e[2]).length() > 5 ? 1 : INCH;
  return new THREE.Matrix4().makeTranslation(e[12], e[13], e[14]).multiply(new THREE.Matrix4().makeScale(unit, unit, unit));
}

/** One block a tree: a tree's parts come as meshes of their own, each with its place; places
 * closer than a quarter of a tree's width are one tree. */
export function onePerTree(places: THREE.Matrix4[]): THREE.Matrix4[] {
  const seen = new Set<string>();
  return places.filter((m) => {
    const e = m.elements;
    const step = 32 * (new THREE.Vector3(e[0], e[1], e[2]).length() > 0.3 ? 1 : INCH);
    const key = `${Math.round(e[12] / step)}|${Math.round(e[14] / step)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
