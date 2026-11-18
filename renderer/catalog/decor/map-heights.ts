/* The height of the map's ground under every point, for the weather (map-game-weather.ts): the game
 * traces a raindrop's splash, a puddle, a snow drift down onto the world (C_INIT_PositionPlaceOnGround),
 * and the particle runtime has no world to trace against. The ground is drawn once from straight
 * above into a float picture whose every pixel is the height of the highest surface there (the
 * trees left out: the rain falls through them), read by the weather's shader and here on the CPU. */
import * as THREE from 'three';

/** Pixels along the map's longer side: a 16 000-unit map in steps of about 16 units. */
const SIZE = 1024;
/** A layer of its own, so only the ground is drawn into the picture. */
const LAYER = 7;

export interface Heights {
  texture: THREE.Texture;
  /** the picture's place on the map, in the scene: min x, min z, size x, size z */
  box: THREE.Vector4;
  /** the height where the picture has nothing (alpha 0 there): the map's floor */
  floor: number;
  /** the ground's height at a point of the scene */
  at(x: number, z: number): number;
  dispose(): void;
}

const VERT = `varying float vY; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = `varying float vY; void main() { gl_FragColor = vec4(vY, 0.0, 0.0, 1.0); }`;

export function mapHeights(renderer: THREE.WebGLRenderer, scene: THREE.Scene, ground: THREE.Object3D[], bounds: THREE.Box3): Heights {
  const size = bounds.getSize(new THREE.Vector3());
  const w = size.x >= size.z ? SIZE : Math.max(1, Math.round(SIZE * size.x / size.z));
  const h = size.z >= size.x ? SIZE : Math.max(1, Math.round(SIZE * size.z / size.x));
  const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  // looking straight down, the picture's top row at the map's least z
  const cam = new THREE.OrthographicCamera(bounds.min.x, bounds.max.x, -bounds.min.z, -bounds.max.z, 0, size.y * 2 + 10);
  cam.position.set(0, bounds.max.y + 5, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, bounds.min.y, 0);
  cam.layers.set(LAYER);
  cam.updateMatrixWorld(true);
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide });
  const marked: THREE.Object3D[] = [];
  for (const o of ground) o.traverse((x) => { if (!x.layers.isEnabled(LAYER)) { x.layers.enable(LAYER); marked.push(x); } });
  const was = { target: renderer.getRenderTarget(), override: scene.overrideMaterial, background: scene.background, fog: scene.fog, clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
  scene.overrideMaterial = mat;
  scene.background = null;
  scene.fog = null;
  // nothing drawn is alpha 0, read as the map's floor (a colour to clear with goes through colour management)
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Float32Array(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, px);
  renderer.setRenderTarget(was.target);
  renderer.setClearColor(was.clear, was.alpha);
  scene.overrideMaterial = was.override;
  scene.background = was.background;
  scene.fog = was.fog;
  for (const x of marked) x.layers.disable(LAYER);
  mat.dispose();
  const box = new THREE.Vector4(bounds.min.x, bounds.min.z, size.x, size.z);
  return {
    texture: target.texture,
    box,
    floor: bounds.min.y,
    at(x, z) {
      const u = Math.min(w - 1, Math.max(0, Math.floor(((x - box.x) / box.z) * w)));
      // the picture's rows run from its bottom, which is the map's greatest z
      const v = Math.min(h - 1, Math.max(0, Math.floor((1 - (z - box.y) / box.w) * h)));
      const i = (v * w + u) * 4;
      return px[i + 3] > 0.5 ? px[i] : bounds.min.y;
    },
    dispose() { target.dispose(); },
  };
}

/**
 * The orbit's point kept on the ground under it, the camera moved by as much (it eases there, so a
 * cliff is climbed, not jumped), and the near plane brought in as the camera comes down: with the
 * point in the air over the map's middle the camera stopped short of the ground, and a near plane
 * set for the whole map cut a tavern's stair in two up close. Whether anything moved.
 */
export function keepOnGround(heights: Heights | null, camera: THREE.PerspectiveCamera, target: THREE.Vector3, reach: number): boolean {
  let moved = false;
  if (heights) {
    const d = (heights.at(target.x, target.z) - target.y) * 0.25;
    if (Math.abs(d) > reach * 1e-6) { target.y += d; camera.position.y += d; moved = true; }
  }
  const near = Math.min(reach / 2000, Math.max(reach / 400000, camera.position.distanceTo(target) / 200));
  if (Math.abs(near - camera.near) > camera.near * 0.25) { camera.near = near; camera.updateProjectionMatrix(); moved = true; }
  return moved;
}
