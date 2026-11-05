/* The 3D preview's scene (issue #417): the hero playing its loadout, each item on it, lit and
 * framed as the game's loadout shows a hero (stage.ts) in the game's own hero shader (hero-material.ts).
 *
 * The models come from the main process as GLB bytes with their pictures inside (src/hero-preview.ts).
 * In the game a wearable has no animation of its own: it follows the hero's bones by name
 * (bonemerge). The scene does the same each frame: a wearable's bone that the hero has takes the
 * hero bone's place in the world, and one the hero lacks keeps its pose under its own parent, so a
 * cape's extra bones hang where the cape has them.
 *
 * Dragging turns the hero, as in the game; the camera and the lights stay. The wheel comes closer.
 *
 * three.js is about 640 KB, so this file is loaded with import() when the preview opens and the
 * window pays nothing for it until then. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useHeroShader } from './hero-material.ts';
import { backdrop, buildStage, heroLights, LOADOUT_FOV, PLAIN_STAGE, widthDistance, worldLights } from './stage.ts';
import type { Attachment, HeroStage, ParticleDef } from '../../api/preview3d.ts';
import { particleSpec } from './particle-def.ts';
import { playParticles, type Carrier } from './particles.ts';

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

/** Up to about 1500 vertices of every mesh under `root`, where the pose puts them in the world. */
function posedPoints(root: THREE.Object3D): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : null;
    if (!pos || !mesh.visible) return;
    const step = Math.max(1, Math.floor(pos.count / 1500));
    for (let i = 0; i < pos.count; i += step) out.push(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  });
  return out;
}

/**
 * The box most of the points are in: a few stray vertices (a bone the hero lacks, a part hidden far
 * off) put the hero in a corner of a frame sized for them.
 */
function spread(points: THREE.Vector3[], cut = 0.004): THREE.Box3 {
  const box = new THREE.Box3();
  if (!points.length) return box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  const at = (axis: 'x' | 'y' | 'z') => {
    const v = points.map((p) => p[axis]).sort((a, b) => a - b);
    const lo = Math.floor(v.length * cut);
    return [v[lo], v[Math.min(v.length - 1, v.length - 1 - lo)]];
  };
  const [x, y, z] = [at('x'), at('y'), at('z')];
  return box.set(new THREE.Vector3(x[0], y[0], z[0]), new THREE.Vector3(x[1], y[1], z[1]));
}

/** A random point on the surface of the meshes under `root`, where the pose puts it now. */
function surfaceOf(root: THREE.Object3D): () => THREE.Vector3 | null {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.getAttribute('position')) meshes.push(o as THREE.Mesh); });
  return () => {
    const m = meshes[Math.floor(Math.random() * meshes.length)];
    if (!m) return null;
    const i = Math.floor(Math.random() * m.geometry.getAttribute('position').count);
    return m.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m.matrixWorld);
  };
}

/** The hero's turn: dragged by hand, coasting a little after the hand lets go, as the game's does. */
function turntable(el: HTMLElement, onZoom: (dy: number) => void) {
  let yaw = 0;
  let speed = 0;
  let from: number | null = null;
  const down = (e: PointerEvent) => { from = e.clientX; speed = 0; el.setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => {
    if (from === null) return;
    speed = (e.clientX - from) * 0.012;
    yaw += speed;
    from = e.clientX;
  };
  const up = () => { from = null; };
  const wheel = (e: WheelEvent) => { e.preventDefault(); onZoom(e.deltaY); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  return {
    step(): number {
      if (from === null && Math.abs(speed) > 1e-4) { yaw += speed; speed *= 0.9; }
      return yaw;
    },
    dispose() {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    },
  };
}

/**
 * Put the scene in `host`; the function it gives back takes it down again.
 * @param clip  the body's loadout clip (src/model-loadout.ts); without it, its idle
 * @param stage  how the game stages the hero (src/hero-showcase.ts)
 * @param pedestal  the model it stands on, if its showcase names one
 * @param particles  the systems on the body (part -1) or on a part, by its place in `parts`; not played when `still`
 */
export async function mountScene(host: HTMLElement, body: Uint8Array, parts: Uint8Array[], {
  still = false, clip = null as string | null, stage = PLAIN_STAGE as HeroStage, pedestal = null as Uint8Array | null,
  attachments = { body: [] as Attachment[], parts: [] as Attachment[][] }, particles = [] as { part: number; def: ParticleDef }[],
} = {}): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const lights = heroLights(stage);
  const world = worldLights(stage);
  const behind = backdrop(stage);
  if (behind) host.style.setProperty('--stage-tint', behind);
  const loader = new GLTFLoader();
  const parse = (bytes: Uint8Array): Promise<GLTF> => loader.parseAsync(bytes.slice().buffer, '');
  const hero = await parse(body);
  await useHeroShader(hero, lights);
  const table = new THREE.Group();
  table.add(hero.scene);
  table.scale.setScalar(stage.scale);
  scene.add(table);
  if (pedestal) {
    try {
      const stand = await parse(pedestal);
      await useHeroShader(stand, lights);
      stand.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
      scene.add(stand.scene);
    } catch { /* no pedestal: the floor alone */ }
  }
  const heroBones = new Map<string, THREE.Bone>();
  hero.scene.traverse((o) => { if ((o as THREE.Bone).isBone && !heroBones.has(o.name)) heroBones.set(o.name, o as THREE.Bone); });

  const worn: { root: THREE.Object3D; bones: { bone: THREE.Bone; to: THREE.Bone | null }[] }[] = [];
  const carriers: (Carrier | null)[] = [];
  for (const [i, bytes] of parts.entries()) {
    try {
      const g = await parse(bytes);
      await useHeroShader(g, lights);
      table.add(g.scene);
      const bones = linkBones(g.scene, heroBones);
      worn.push({ root: g.scene, bones });
      carriers[i] = { bones: new Map(bones.map((b) => [b.bone.name, b.bone])), attachments: attachments.parts[i] || [], surface: surfaceOf(g.scene) };
    } catch { carriers[i] = null; /* one model the loader cannot read: the rest still show */ }
  }
  table.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });

  const mixer = new THREE.AnimationMixer(hero.scene);
  const playing = hero.animations.find((a) => a.name === clip) || hero.animations.find((a) => /idle/i.test(a.name)) || hero.animations[0];
  if (playing) mixer.clipAction(playing).play();

  const syncWorn = () => {
    table.updateMatrixWorld(true);
    for (const w of worn) {
      for (const { bone, to } of w.bones) {
        if (to) bone.matrixWorld.copy(to.matrixWorld);
        else if (bone.parent) bone.matrixWorld.multiplyMatrices(bone.parent.matrixWorld, bone.matrix);
      }
    }
  };
  // framed on everything worn through the whole loadout, as the game's camera never moves: the
  // skinned vertices as each pose has them, a mount and a raised sword included
  const points: THREE.Vector3[] = [];
  const samples = playing ? 5 : 1;
  for (let i = 0; i < samples; i++) {
    mixer.setTime(playing ? (playing.duration * i) / samples : 0);
    syncWorn();
    points.push(...posedPoints(table));
  }
  mixer.setTime(0);
  const box = spread(points);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  buildStage(scene, box, stage);

  // the game's loadout camera, level and straight at the hero; stepped back only for a hero wider
  // than the stage, and toward the hero by the wheel
  const fov = LOADOUT_FOV;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 400);
  const spot = new THREE.Vector3(...stage.camera);
  const view = new THREE.Vector3(spot.x, 0, spot.z).normalize();
  const side = new THREE.Vector3().crossVectors(view, new THREE.Vector3(0, 1, 0)).normalize();
  const base = Math.hypot(spot.x, spot.z);
  let zoom = 1;
  const place = () => {
    const d = Math.max(base, centre.dot(view) + widthDistance(size, camera.aspect, fov, side)) * zoom;
    camera.position.set(view.x * d, spot.y, view.z * d);
    camera.lookAt(0, spot.y, 0);
    camera.updateProjectionMatrix();
  };
  // the hero model's root node: its matrix takes Source's axes and inches to the scene's
  const src = hero.scene.children.find((o) => !(o as THREE.Mesh).isMesh && o.matrix.getMaxScaleOnAxis() < 0.5) || hero.scene;
  const heroCarrier: Carrier = { bones: heroBones, attachments: attachments.body, surface: surfaceOf(hero.scene) };
  const fx = still ? null : playParticles(scene, particles.flatMap(({ part, def }) => {
    const self = part < 0 ? heroCarrier : carriers[part];
    return self ? [{ spec: particleSpec(def), self }] : [];
  }), heroCarrier, src);
  // the loadout's effects come with its animation: each time it starts over, so do they
  if (fx && playing?.name === clip) mixer.addEventListener('loop', () => fx.restart());

  const spin = turntable(renderer.domElement, (dy) => { zoom = Math.min(1.15, Math.max(0.45, zoom * (1 + Math.sign(dy) * 0.08))); place(); });

  const fit = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    place();
  };
  const resize = new ResizeObserver(fit);
  resize.observe(host);
  fit();

  const timer = new THREE.Timer();
  let frame = 0;
  const tick = (now?: number) => {
    frame = requestAnimationFrame(tick);
    timer.update(now);
    const dt = still ? 0 : timer.getDelta();
    mixer.update(dt);
    table.rotation.y = spin.step();
    syncWorn();
    fx?.update(dt, renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))));
    // the hero shader reads its lights in view space; the camera is still, but its matrix is cheap
    lights.key.copy(world.key).transformDirection(camera.matrixWorldInverse);
    lights.fill.copy(world.fill).transformDirection(camera.matrixWorldInverse);
    lights.up.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    renderer.render(scene, camera);
  };
  tick();

  return () => {
    cancelAnimationFrame(frame);
    timer.dispose();
    resize.disconnect();
    spin.dispose();
    mixer.stopAllAction();
    fx?.dispose();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      for (const m of ([] as THREE.Material[]).concat(mesh.material || [])) {
        const uniforms = (m as THREE.ShaderMaterial).uniforms || {};
        for (const v of [...Object.values(m), ...Object.values(uniforms).map((u) => u?.value)]) {
          if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose();
        }
        m.dispose();
      }
    });
    renderer.dispose();
    renderer.domElement.remove();
    host.style.removeProperty('--stage-tint');
  };
}
