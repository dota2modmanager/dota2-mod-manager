/* The 3D preview's scene (issue #417): the hero's body playing its idle, and each item on it.
 *
 * The models come from the main process as GLB bytes with their pictures inside (src/hero-preview.ts).
 * In the game a wearable has no animation of its own: it follows the hero's bones by name
 * (bonemerge). The scene does the same each frame: a wearable's bone that the hero has takes the
 * hero bone's place in the world, and one the hero lacks keeps its pose under its own parent, so a
 * cape's extra bones hang where the cape has them.
 *
 * three.js is about 640 KB, so this file is loaded with import() when the preview opens and the
 * window pays nothing for it until then. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** A wearable's bones in the order a parent comes before its children, each with the hero's bone of its name. */
function linkBones(wearable: THREE.Object3D, hero: Map<string, THREE.Bone>): { bone: THREE.Bone; to: THREE.Bone | null }[] {
  const out: { bone: THREE.Bone; to: THREE.Bone | null }[] = [];
  wearable.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    const bone = o as THREE.Bone;
    bone.matrixAutoUpdate = false;
    bone.matrixWorldAutoUpdate = false;
    out.push({ bone, to: hero.get(bone.name) || null });
  });
  return out;
}

/** Put the scene in `host`; the function it gives back takes it down again. */
export async function mountScene(host: HTMLElement, body: Uint8Array, parts: Uint8Array[], { still = false } = {}): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x303040, 0.6));

  const loader = new GLTFLoader();
  const parse = (bytes: Uint8Array): Promise<GLTF> => loader.parseAsync(bytes.slice().buffer, '');
  const hero = await parse(body);
  scene.add(hero.scene);
  const heroBones = new Map<string, THREE.Bone>();
  hero.scene.traverse((o) => { if ((o as THREE.Bone).isBone && !heroBones.has(o.name)) heroBones.set(o.name, o as THREE.Bone); });

  const worn: { root: THREE.Object3D; bones: { bone: THREE.Bone; to: THREE.Bone | null }[] }[] = [];
  for (const bytes of parts) {
    try {
      const g = await parse(bytes);
      scene.add(g.scene);
      worn.push({ root: g.scene, bones: linkBones(g.scene, heroBones) });
    } catch { /* one model the loader cannot read: the rest still show */ }
  }

  const mixer = new THREE.AnimationMixer(hero.scene);
  const idle = hero.animations.find((a) => /idle/i.test(a.name)) || hero.animations[0];
  if (idle) mixer.clipAction(idle).play();

  // framed on the body standing: the camera a little above the waist, the whole hero in view
  hero.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(hero.scene);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const fov = 30;
  const camera = new THREE.PerspectiveCamera(fov, 1, Math.max(size.y / 100, 0.01), size.y * 20);
  // far enough that the whole height fits the view with a margin, whatever the window's width
  const reach = (size.y * 0.68) / Math.tan(THREE.MathUtils.degToRad(fov / 2)) + size.z / 2;
  const from = new THREE.Vector3(0.35, 0.12, 1).normalize().multiplyScalar(reach);
  camera.position.copy(centre).add(from);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(centre);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = reach * 0.3;
  controls.maxDistance = reach * 2.5;
  controls.autoRotate = !still && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.autoRotateSpeed = 1.2;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  const fit = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const resize = new ResizeObserver(fit);
  resize.observe(host);
  fit();

  const timer = new THREE.Timer();
  let frame = 0;
  const tick = (now?: number) => {
    frame = requestAnimationFrame(tick);
    timer.update(now);
    mixer.update(still ? 0 : timer.getDelta());
    hero.scene.updateMatrixWorld(true);
    for (const w of worn) {
      w.root.updateMatrixWorld(true);
      for (const { bone, to } of w.bones) {
        if (to) bone.matrixWorld.copy(to.matrixWorld);
        else if (bone.parent) bone.matrixWorld.multiplyMatrices(bone.parent.matrixWorld, bone.matrix);
      }
    }
    controls.update();
    renderer.render(scene, camera);
  };
  tick();

  return () => {
    cancelAnimationFrame(frame);
    timer.dispose();
    resize.disconnect();
    controls.dispose();
    mixer.stopAllAction();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      for (const m of ([] as THREE.Material[]).concat(mesh.material || [])) {
        for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose();
        m.dispose();
      }
    });
    scene.environment?.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
