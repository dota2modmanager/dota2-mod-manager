/* The game's camera over the 3D map, as client.dll's CDOTA_Camera runs it (code map, 2026-11-28):
 * it looks north at a point on the ground, tilted 60° down (dota_camera_pitch_max), and the wheel
 * moves one number, the zoom, between 0 and 1, which the camera follows at 1.5 × the frame's time a
 * frame (dota_camera_mousewheel_frametime_multiplier). A player's zoom runs 0 to 0.5 and starts at
 * 0.5; a spectator's goes on to 1. By the zoom:
 *   distance  lerp(1134, 1200, 2z) for a player, lerp(1200, 2600, 2z - 1) beyond
 *             (dota_camera_distance_min, dota_camera_distance, dota_camera_distance_teamspec)
 *   fov       remap(smoothstep(z), 0, 0.5, 45, 70), remap(smoothstep(z), 0.5, 1, 70, 55) beyond
 *             (dota_camera_fov_min, _max, _min_teamspec); 70 draws 66° high (a RenderDoc frame)
 *   fog       start remap(smoothstep(z), 0, 0.5, 2000, the zone's), on to 4500; end 2500, the
 *             zone's, 6000 (dota_camera_fog_*_zoomed_in / _out, CDOTA_Camera::v20/v21)
 *   far       3300 zoomed in, 4800 out (dota_camera_zfar_zoomed_in / _out)
 * The view does not turn: dota_camera_disable_yaw holds the game's at 90°. Dragging moves it over
 * the ground, and the keys pan it at dota_camera_speed, 3000 a second. */
import * as THREE from 'three';

/** One of the game's units (an inch) in the scene's metres. */
export const INCH = 0.0254;
const PITCH = THREE.MathUtils.degToRad(60);
/** The game's vertical view at its widest player zoom (fov 70), from a RenderDoc frame. */
const VFOV_AT_70 = 66;
/** How far the wheel moves the zoom a notch. */
const NOTCH = 0.05;
/** The zoom the view starts at: a player's, as the game opens. */
export const START_ZOOM = 0.5;

const lerp = THREE.MathUtils.lerp;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => (3 - 2 * x) * x * x;
/** RemapValClamped: x from [a, b] onto [c, d]. */
const remap = (x: number, a: number, b: number, c: number, d: number) => c + (d - c) * clamp01((x - a) / (b - a));

/** The camera's distance to what it looks at, in inches. */
export const distanceAt = (z: number): number => (z <= 0.5 ? lerp(1134, 1200, clamp01(2 * z)) : lerp(1200, 2600, clamp01(2 * z - 1)));

/** The game's fov setting at a zoom. */
export const fovAt = (z: number): number => {
  const s = smooth(clamp01(z));
  return z <= 0.5 ? remap(s, 0, 0.5, 45, 70) : remap(s, 0.5, 1, 70, 55);
};

/** How high the view is, in degrees, for the game's fov setting: the same width in tangent as 70 to 66°. */
export const verticalFov = (fov: number): number =>
  THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(VFOV_AT_70 / 2)) * Math.tan(THREE.MathUtils.degToRad(fov / 2)) / Math.tan(THREE.MathUtils.degToRad(35))));

/** The camera's fog, start and end in inches, at a zoom over a zone whose own fog is `start`, `end`. */
export const fogAt = (z: number, start: number, end: number): [number, number] => {
  const s = smooth(clamp01(z));
  return z <= 0.5
    ? [remap(s, 0, 0.5, 2000, start), remap(s, 0, 0.5, 2500, end)]
    : [remap(s, 0.5, 1, start, 4500), remap(s, 0.5, 1, end, 6000)];
};

/** The far plane, in inches. */
export const farAt = (z: number): number => remap(z, 0, 0.5, 3300, 4800);

export interface DotaCamera {
  /** the zoom now, 0 to 1 */
  readonly zoom: number;
  /** a turn of the wheel: positive out, negative in, in notches */
  wheel(notches: number): void;
  /** the zoom a step on, the camera stood where the game's stands over `target`; whether it moved */
  step(dt: number): boolean;
}

export function dotaCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3, onZoom: (z: number) => void): DotaCamera {
  let zoom = START_ZOOM, goal = START_ZOOM, placed = new THREE.Vector3(NaN, 0, 0), placedZoom = NaN;
  const stand = () => {
    const d = distanceAt(zoom) * INCH;
    // north is the scene's +x (the game's y), up its +y
    camera.position.set(target.x - d * Math.cos(PITCH), target.y + d * Math.sin(PITCH), target.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    const fov = verticalFov(fovAt(zoom)), far = farAt(zoom) * INCH;
    if (Math.abs(camera.fov - fov) > 1e-4 || Math.abs(camera.far - far) > 1e-4) {
      camera.fov = fov;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    placed.copy(target);
    placedZoom = zoom;
    onZoom(zoom);
  };
  return {
    get zoom() { return zoom; },
    wheel(notches) { goal = clamp01(goal + notches * NOTCH); },
    step(dt) {
      if (zoom !== goal) {
        const k = Math.min(1, 1.5 * Math.min(dt, 0.1));
        zoom = Math.abs(goal - zoom) < 1e-4 ? goal : zoom + (goal - zoom) * k;
      }
      if (zoom === placedZoom && placed.equals(target)) return false;
      stand();
      return true;
    },
  };
}
