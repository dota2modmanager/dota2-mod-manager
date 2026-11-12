// A clip's travel taken out, for a preview that stands on one spot.
//
// The game moves a hero's root bone inside some clips: Marci's debut stance carries her ten body
// lengths across the floor, where the game's own camera goes with her. The preview's camera stays,
// so she left the frame. The slow part of the bone's way across the floor goes, and the quick part
// (a step, a lunge, the sway of the hips) stays. Height stays too: a jump is still a jump.
import * as THREE from 'three';

// glTF metres. A hero's hips sway a quarter of this in an idle.
const TRAVEL = 1;
const WINDOW = 0.5;

/**
 * Keep a bone near its place on the floor through a clip, where the clip takes it far from there.
 * @param clip  an AnimationClip, changed in place
 * @param rest  the bones to hold, by uuid and name: { x, z } of each where it stands
 * @returns whether anything changed
 */
export function holdRootMotion(clip, rest) {
  let changed = false;
  for (const track of clip.tracks) {
    if (!(track instanceof THREE.VectorKeyframeTrack)) continue;
    const parsed = THREE.PropertyBinding.parseTrackName(track.name);
    const place = parsed.propertyName === 'position' ? rest.get(parsed.nodeName) : null;
    if (!place) continue;
    const { times, values } = track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < values.length; i += 3) {
      minX = Math.min(minX, values[i]); maxX = Math.max(maxX, values[i]);
      minZ = Math.min(minZ, values[i + 2]); maxZ = Math.max(maxZ, values[i + 2]);
    }
    const count = times.length, out = new Float32Array(values);
    if (Math.hypot(maxX - minX, maxZ - minZ) < TRAVEL) {
      // No travel, but maybe all of it somewhere else: her debut's loop stands seven body lengths off.
      const offX = (minX + maxX) / 2 - place.x, offZ = (minZ + maxZ) / 2 - place.z;
      if (Math.hypot(offX, offZ) < TRAVEL) continue;
      for (let i = 0; i < count; i++) { out[i * 3] -= offX; out[i * 3 + 2] -= offZ; }
      track.values = out;
      changed = true;
      continue;
    }
    for (let first = 0, last = 0, sumX = 0, sumZ = 0, i = 0; i < count; i++) {
      while (last < count && times[last] <= times[i] + WINDOW) { sumX += values[last * 3]; sumZ += values[last * 3 + 2]; last++; }
      while (times[first] < times[i] - WINDOW) { sumX -= values[first * 3]; sumZ -= values[first * 3 + 2]; first++; }
      const n = last - first;
      out[i * 3] = values[i * 3] - sumX / n + place.x;
      out[i * 3 + 2] = values[i * 3 + 2] - sumZ / n + place.z;
    }
    track.values = out;
    changed = true;
  }
  return changed;
}

/** Where a rig's top bones stand before any clip plays, by uuid and by name: what a clip's tracks call them. */
export function rootBones(root) {
  const rest = new Map();
  root.traverse((node) => {
    if (!node.isBone) return;
    let depth = 0;
    for (let up = node.parent; up?.isBone; up = up.parent) depth++;
    if (depth > 1) return;
    const place = { x: node.position.x, z: node.position.z };
    rest.set(node.uuid, place);
    rest.set(node.name, place);
  });
  return rest;
}
