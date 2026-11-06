/* The 3D preview's scene (issue #417): the hero playing its loadout, each item on it, lit and
 * framed as the game's loadout shows a hero (stage.ts) in the game's own hero shader (hero-material.ts).
 *
 * The models come from the main process as GLB bytes with their pictures inside (src/hero-preview.ts).
 * A wearable follows the hero's bones by name, as in the game (bonemerge.ts); the scene does that
 * each frame.
 *
 * Dragging sideways turns the hero, as in the game, and the lights stay; the camera is free to move
 * around that (camera.ts). The window can play any of the body's other clips: they come apart from
 * the model, once, the first time one is asked for (Preview3d.tsx).
 *
 * three.js is about 640 KB, so this file is loaded with import() when the preview opens and the
 * window pays nothing for it until then. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { boneKey, bonesByName, linkBones } from './bonemerge.ts';
import { cameraAt, clampTilt, keyMove, stepZoom, viewControls } from './camera.ts';
import { useHeroShader } from './hero-material.ts';
import { backdrop, buildStage, heroLights, LOADOUT_FOV, PLAIN_STAGE, widthDistance, worldLights } from './stage.ts';
import type { Attachment, HeroStage, ParticleDef } from '../../api/preview3d.ts';
import { particleSpec } from './particle-def.ts';
import { playParticles, spriteTextures, type Carrier } from './particles.ts';
import { motionPlayer, type PlayMotion } from './motion-player.ts';
import { createBloom } from './bloom.ts';

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
function spread(points: THREE.Vector3[], cut = 0.001): THREE.Box3 {
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

/** The scene once it stands in the window. */
export interface HeroScene {
  /**
   * Play this clip, out of the body's own or out of the file `motions` brings; null for the loadout. False when neither has it.
   * @param onEnd  given, the clip plays once and the hero goes back to the loadout, then this is called
   */
  play: PlayMotion;
  /** The camera and the hero's turn back where they started. */
  resetView: () => void;
  dispose: () => void;
}

/**
 * Put the scene in `host`.
 * @param label  what a screen reader calls the stage
 * @param clip  the body's loadout clip (src/model-loadout.ts); without it, its idle
 * @param stage  how the game stages the hero (src/hero-showcase.ts)
 * @param pedestal  the model it stands on, if its showcase names one
 * @param particles  the systems on the body (part -1) or on a part, by its place in `parts`; not played when `still`
 * @param sprites  their textures, PNG bytes by the path they name
 */
export async function mountScene(host: HTMLElement, body: Uint8Array, parts: Uint8Array[], {
  still = false, label = '', clip = null as string | null, stage = PLAIN_STAGE as HeroStage, pedestal = null as Uint8Array | null,
  attachments = { body: [] as Attachment[], parts: [] as Attachment[][] }, particles = [] as { part: number; def: ParticleDef }[],
  sprites = {} as Record<string, Uint8Array>,
} = {}): Promise<HeroScene> {
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
  const heroBones = bonesByName(hero.scene);

  const worn: { root: THREE.Object3D; bones: { bone: THREE.Bone; to: THREE.Bone | null }[] }[] = [];
  const carriers: (Carrier | null)[] = [];
  for (const [i, bytes] of parts.entries()) {
    try {
      const g = await parse(bytes);
      await useHeroShader(g, lights);
      table.add(g.scene);
      const bones = linkBones(g.scene, heroBones);
      worn.push({ root: g.scene, bones });
      carriers[i] = { bones: new Map(bones.map((b) => [boneKey(b.bone.name), b.bone])), attachments: attachments.parts[i] || [], surface: surfaceOf(g.scene) };
    } catch { carriers[i] = null; /* one model the loader cannot read: the rest still show */ }
  }
  table.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });

  const mixer = new THREE.AnimationMixer(hero.scene);
  const clips = motionPlayer(mixer, hero.animations, clip, async (bytes) => (await parse(bytes)).animations);

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
  const samples = clips.home ? 5 : 1;
  for (let i = 0; i < samples; i++) {
    mixer.setTime(clips.home ? (clips.home.duration * i) / samples : 0);
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
  const home = new THREE.Vector3(0, spot.y, 0);
  const target = home.clone();
  const view = new THREE.Vector3(spot.x, 0, spot.z).normalize();
  const side = new THREE.Vector3().crossVectors(view, new THREE.Vector3(0, 1, 0)).normalize();
  const base = Math.hypot(spot.x, spot.z);
  let zoom = 1;
  let tilt = 0;
  const distance = () => Math.max(base, centre.dot(view) + widthDistance(size, camera.aspect, fov, side, centre.dot(side))) * zoom;
  const place = () => {
    const at = cameraAt(target, view, tilt, distance());
    camera.position.set(at.x, at.y, at.z);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  };
  /** The camera's point moved, along the camera's right, its flat forward and up; it stays near the hero. */
  const move = (right: number, forward: number, up: number) => {
    target.addScaledVector(side, -right).addScaledVector(view, -forward);
    target.y += up;
    target.sub(home).clampLength(0, base).add(home);
    place();
  };
  // the hero model's root node: its matrix takes Source's axes and inches to the scene's
  const src = hero.scene.children.find((o) => !(o as THREE.Mesh).isMesh && o.matrix.getMaxScaleOnAxis() < 0.5) || hero.scene;
  const heroCarrier: Carrier = { bones: heroBones, attachments: attachments.body, surface: surfaceOf(hero.scene) };
  const textures = still ? new Map<string, THREE.Texture>() : await spriteTextures(sprites);
  const fx = still ? null : playParticles(scene, particles.flatMap(({ part, def }) => {
    const self = part < 0 ? heroCarrier : carriers[part];
    return self ? [{ spec: particleSpec(def), self }] : [];
  }), heroCarrier, src, textures);
  // a hero's loadout effect plays once, as the game plays it when he comes out, however long his
  // animation goes round: started over it reads as a bug, a burst or a snowfall with no end

  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', label);
  const controls = viewControls(renderer.domElement, {
    onTilt: (d) => { tilt = clampTilt(tilt + d); place(); },
    onPan: (dx, dy) => {
      const perPixel = (2 * distance() * Math.tan(THREE.MathUtils.degToRad(fov / 2))) / (host.clientHeight || 1);
      move(-dx * perPixel, 0, dy * perPixel);
    },
    onZoom: (dy) => { zoom = stepZoom(zoom, dy); place(); },
    onReset: () => { zoom = 1; tilt = 0; target.copy(home); place(); },
  });

  const glow = createBloom(renderer);
  const fit = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    glow.resize();
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
    table.rotation.y = controls.step();
    const go = keyMove(controls.keys, timer.getDelta(), distance());
    if (go.right || go.forward || go.up) move(go.right, go.forward, go.up);
    syncWorn();
    fx?.update(dt, renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))));
    // the hero shader reads its lights in view space; the camera is still, but its matrix is cheap
    lights.key.copy(world.key).transformDirection(camera.matrixWorldInverse);
    lights.fill.copy(world.fill).transformDirection(camera.matrixWorldInverse);
    lights.up.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    glow.render(scene, camera);
  };
  tick();

  const dispose = () => {
    cancelAnimationFrame(frame);
    timer.dispose();
    resize.disconnect();
    controls.dispose();
    clips.dispose();
    glow.dispose();
    mixer.stopAllAction();
    fx?.dispose();
    for (const t of textures.values()) t.dispose();
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
  return { play: clips.play, resetView: controls.reset, dispose };
}
