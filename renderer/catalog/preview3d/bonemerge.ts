/* How a wearable sits on the hero. In the game it has no animation of its own: each of its bones
 * takes the place of the hero's bone of that name (bonemerge), and a bone the hero lacks hangs off
 * its parent as the wearable has it, so a cape's extra bones stay where the cape keeps them.
 *
 * The names have to match as the game matches them, without case: Valve's artists spelled the same
 * bone both ways, and of the stock wearables in the game 168 of 853 have bones only that finds. Axe's
 * armour says "clavicle_r" where his body says "Clavicle_R"; matched exactly, that shoulder stayed
 * behind while the arm moved. */
import type * as THREE from 'three';

/** The name a bone goes by in these tables. */
export const boneKey = (name: string) => name.toLowerCase();

/** The bones under `root` by that name; the first of a name wins. */
export function bonesByName(root: THREE.Object3D): Map<string, THREE.Bone> {
  const out = new Map<string, THREE.Bone>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone && !out.has(boneKey(o.name))) out.set(boneKey(o.name), o as THREE.Bone); });
  return out;
}

/** A wearable's bones in the order a parent comes before its children, each with the hero's bone of its name. */
export function linkBones(wearable: THREE.Object3D, hero: Map<string, THREE.Bone>): { bone: THREE.Bone; to: THREE.Bone | null }[] {
  const out: { bone: THREE.Bone; to: THREE.Bone | null }[] = [];
  wearable.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    const bone = o as THREE.Bone;
    bone.matrixAutoUpdate = false;
    bone.matrixWorldAutoUpdate = false;
    out.push({ bone, to: hero.get(boneKey(bone.name)) || null });
  });
  return out;
}
