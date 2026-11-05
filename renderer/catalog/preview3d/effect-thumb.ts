/* The pictures of the item builder's effects: each effect's own particle system out of the game
 * (src/hero-preview.ts effect), played by the 3D preview's particles (particles.ts) for a couple
 * of seconds on a point walking a small circle, the way a courier carries them, and taken as one frame. The game has no picture of its unusual
 * effects, only their names; this shows their colour and their shape, the way the preview plays
 * them. One renderer draws them all, one at a time, and each picture is kept for the session. */
import * as THREE from 'three';
import { particleSpec } from './particle-def.ts';
import { playParticles, spriteTextures, type Carrier } from './particles.ts';

const W = 320;
const H = 180;
const FOV = 30;
/** How long an effect runs before its picture is taken: long enough to fill out, short of a burst's end. */
const RUN = 2.5;
/** The circle the effect's point walks while it runs, in metres, and how fast it turns, in radians a second. */
const RING = 0.5;
const WALK = 2.2;

let renderer: THREE.WebGLRenderer | null = null;
const kept = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

/** Source's axes and inches to the scene's: the same turn and scale a hero model's root has. */
const M = 0.0254;
const SOURCE = new THREE.Matrix4().set(0, M, 0, 0, 0, 0, M, 0, M, 0, 0, 0, 0, 0, 0, 1);

/** Nothing to hang on: the effect sits at the point, and what spawns on a model spawns in a ball around it. */
const empty: Carrier = {
  bones: new Map(), attachments: [],
  surface: () => new THREE.Vector3().randomDirection().multiplyScalar(0.35 * Math.cbrt(Math.random())).add(new THREE.Vector3(0, 0.5, 0)),
};

/**
 * Whether a frame shows anything: many unusual effects take their colour from the courier that
 * wears them, which a picture has none of, and come out as a dark frame the glyph says more than.
 */
function lit(canvas: HTMLCanvasElement): boolean {
  const small = document.createElement('canvas');
  small.width = 32;
  small.height = 18;
  const g = small.getContext('2d', { willReadFrequently: true });
  if (!g) return true;
  g.drawImage(canvas, 0, 0, 32, 18);
  const px = g.getImageData(0, 0, 32, 18).data;
  let bright = 0;
  for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) > 50) bright++;
  return bright >= 4;
}

async function draw(id: string): Promise<string | null> {
  const got = await window.api.preview3d.effect(id);
  if (!got) return null;
  const textures = await spriteTextures(got.sprites);
  renderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0d14);
  const src = new THREE.Object3D();
  src.matrixAutoUpdate = false;
  src.matrix.copy(SOURCE);
  scene.add(src);
  src.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.01, 200);
  const viewPx = H / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
  const fx = playParticles(scene, [{ spec: particleSpec(got.def), self: empty }], empty, src, textures);
  try {
    // a courier's trail is drawn as it walks: the point goes round a small circle, as a courier would
    for (let t = 0; t < RUN; t += 1 / 30) {
      const a = t * WALK;
      src.matrix.makeTranslation(Math.sin(a) * RING, 0, Math.cos(a) * RING).multiply(SOURCE);
      src.updateMatrixWorld(true);
      fx.update(1 / 30, viewPx);
    }
    const box = fx.bounds();
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(1, 1, 1));
    const size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.3, 0.3, 0.3));
    const centre = box.getCenter(new THREE.Vector3());
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const d = Math.max(size.y / 2 / tan, size.x / 2 / (tan * (W / H))) * 1.15 + size.z / 2;
    camera.position.set(centre.x, centre.y + d * 0.15, centre.z + d);
    camera.lookAt(centre);
    renderer.render(scene, camera);
    return lit(renderer.domElement) ? renderer.domElement.toDataURL('image/webp', 0.85) : null;
  } finally {
    fx.dispose();
    for (const t of textures.values()) t.dispose();
  }
}

/** An effect's picture as a data URI, or null where the game has no system for it or the window cannot draw. */
export function effectThumb(id: string): Promise<string | null> {
  let p = kept.get(id);
  if (!p) {
    p = queue.then(() => draw(id)).catch(() => null);
    queue = p;
    kept.set(id, p);
  }
  return p;
}
