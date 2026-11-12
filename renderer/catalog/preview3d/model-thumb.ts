/* Pictures of the game's own map props, out of their models: a tree set has no item and no picture
 * of its own, only its models, so the window draws the set's main model (src/hero-preview.ts model)
 * standing in a soft light, three quarters on, and keeps the frame. One renderer draws them all,
 * one at a time, and each picture is kept for the session, as effect-thumb.ts does for effects. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const W = 320;
const H = 240;
const FOV = 30;

let renderer: THREE.WebGLRenderer | null = null;
const kept = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

async function draw(file: string): Promise<string | null> {
  const bytes = await window.api.preview3d.model(file);
  if (!bytes) return null;
  const gltf = await new GLTFLoader().parseAsync(bytes.slice().buffer, '');
  renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 2.2));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  scene.add(gltf.scene);
  // leaves are cards with holes in them: both faces, cut where the picture is clear
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
      m.side = THREE.DoubleSide;
      if (m.map && m.transparent) { m.transparent = false; m.alphaTest = 0.4; }
    }
  });
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 0.01, 1e6);
  const d = Math.max(size.y / 2 / tan, Math.max(size.x, size.z) / 2 / (tan * (W / H))) * 1.1 + Math.max(size.x, size.z) / 2;
  camera.position.set(centre.x + d * 0.5, centre.y + d * 0.2, centre.z + d * 0.85);
  camera.lookAt(centre);
  try {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/webp', 0.85);
  } finally {
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of [mesh.material].flat() as THREE.MeshStandardMaterial[]) { m.map?.dispose(); m.dispose(); }
    });
  }
}

/** A map prop's picture as a data URI, or null where the game or the toolchain is not there. */
export function modelThumb(file: string): Promise<string | null> {
  let p = kept.get(file);
  if (!p) {
    p = queue.then(() => draw(file)).catch(() => null);
    queue = p;
    kept.set(file, p);
  }
  return p;
}
