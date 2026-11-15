/* WASD over the map of the Optimization window, as a player pans the camera in the game: W and S
 * along where the camera looks, A and D across, Shift faster; the arrow keys do the same. The
 * camera and what it looks at move together, at a speed that grows with how far the camera is,
 * so the whole map is crossed in a few seconds from above and a lane walked close up. Keys go to
 * the map only while no text field has them. */
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

export interface MapKeys {
  /** move by the keys held, `dt` seconds on; whether the camera moved */
  step(dt: number): boolean;
  dispose(): void;
}

export function mapKeys(camera: THREE.PerspectiveCamera, controls: OrbitControls, bounds: () => THREE.Box3 | null): MapKeys {
  const held = new Set<string>();
  let fast = false;
  const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement && e.target.type !== 'range' || e.target instanceof HTMLTextAreaElement;
  const down = (e: KeyboardEvent) => {
    fast = e.shiftKey;
    if (!(e.code in KEYS) || typing(e)) return;
    held.add(e.code);
    e.preventDefault();
  };
  const up = (e: KeyboardEvent) => { fast = e.shiftKey; held.delete(e.code); };
  const blur = () => held.clear();
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();
  return {
    step(dt) {
      if (!held.size) return false;
      let x = 0, y = 0;
      for (const k of held) { x += KEYS[k][0]; y += KEYS[k][1]; }
      if (!x && !y) return false;
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
      right.crossVectors(forward, camera.up).normalize();
      const speed = camera.position.distanceTo(controls.target) * (fast ? 2.4 : 0.9);
      move.copy(forward).multiplyScalar(y).addScaledVector(right, x).normalize().multiplyScalar(speed * Math.min(dt, 0.05));
      // the camera stays over the map
      const box = bounds();
      if (box) {
        const next = controls.target.clone().add(move).clamp(box.min, box.max);
        move.subVectors(next, controls.target);
      }
      camera.position.add(move);
      controls.target.add(move);
      return true;
    },
    dispose() {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    },
  };
}
