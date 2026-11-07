import {mergeWearableClips} from './wearable-clips.js';
import {activeSkinJoints,attachmentSkinBones,resolveModelAttachment} from './skin-joints.js';
import {particleSurfaceMeshes} from './surface-meshes.js';
import {snapshotBinding} from '../studio/snapshot-bindings.mjs';
import {wearableBoneOwners} from './wearable-bones.js';
// A Dota 2 hero in the browser: the hero, his items and pedestal from the files built by
// tools/build-heroes.mjs, lit like the game's loadout page, animated, with his particle effects,
// turned by dragging. One viewer keeps its WebGL context and swaps heroes with load().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Library, Simulation, SOFT, SOURCE_TO_GLTF } from './fx.js';
import { Bloom } from './bloom.js';
import { heroMaterial } from './material.js';

// Tone mapping: each channel stays as it is up to the knee and rolls off softly toward 1 above it,
// so bright fire goes yellow and white like in the game, without the hard edge of clipping.
const KNEE = 0.75;
// The heroes and items of loadout.nyan.cafe, for ids without a folder of one's own (options.assets).
export const DEFAULT_ASSETS = 'https://loadout.nyan.cafe/';
// Bloom: how much of the halo of what is brighter than white is added (options.bloom; false for none).
const BLOOM = 0.35;
// Light of the loadout page when a hero has no portrait of his own.
const DEFAULT_LIGHTING = {
  light: { angles: [50, 145, 0], color: [234, 243, 254], scale: 1.45 }, ambient: { angles: [-27, -114, 24], color: [79, 93, 93], scale: 5 },
  shadow: { color: [56, 56, 56], scale: 5 }, camera: { position: [800, -370, 112] },
};
const DRAG = 0.008, WHEEL_TURN = 0.006, EASE = 10, GLIDE = 3.5;

const groupInverse = SOURCE_TO_GLTF.clone().invert();
const toSource = (m) => groupInverse.clone().multiply(m);
const sourceRotation = new THREE.Matrix4().extractRotation(SOURCE_TO_GLTF);
// A direction from the game's (pitch, yaw) in its space (x forward from the hero, z up).
const forward = ([pitch, yaw]) => { const p = THREE.MathUtils.degToRad(pitch), y = THREE.MathUtils.degToRad(yaw); return new THREE.Vector3(Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)).applyMatrix4(sourceRotation); };
const tint = (c, scale) => new THREE.Color().setRGB(...c.map((v) => v / 255), THREE.SRGBColorSpace).multiplyScalar(scale);

export class HeroViewer {
  // options: controls — true (drag anywhere), 'hero' (only a drag that starts on the hero; the rest
  // goes on to the page) or false; wheel — 'zoom', 'turn' or false; framing — 'hero' (the hero,
  // with what fits of the pedestal) or 'full' (hero and pedestal whole); pixelRatio; textureScale (1, or
  // 0.5 by default on phones and machines of 4 GB or less); bloom (its strength, 0.35, or false);
  // assets (where load('pudge') and wear('weapon', 6058) find them: loadout.nyan.cafe by default);
  // onProgress(loaded, total); onAnimation(name). Set paused to stand the hero and his effects still.
  constructor(canvas, options = {}) {
    this.canvas = canvas; this.options = { controls: true, wheel: 'zoom', framing: 'hero', ...options };
    // Where heroes and items are found by id (load('pudge'), wear('weapon', 6058)): the site's own.
    this.assets = this.options.assets ?? DEFAULT_ASSETS;
    // Phones and small machines get textures at half size: a quarter of the memory, unseen on their screens.
    const small = globalThis.matchMedia?.('(pointer: coarse)').matches || (globalThis.navigator?.deviceMemory && navigator.deviceMemory <= 4);
    this.textureScale = this.options.textureScale ?? (small ? 0.5 : 1);
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(this.options.pixelRatio ?? globalThis.devicePixelRatio ?? 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    // The scene is drawn in linear light without a ceiling (the game's HDR), then tone mapped onto
    // the canvas: piled-up glows keep their hue instead of clipping to yellow and white.
    this.hdr = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    // Soft particles (options.softParticles, on by default): the scene's depth without the effects,
    // at half size, for the effects to fade against.
    this.soft = this.options.softParticles !== false ? { target: new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) }), material: new THREE.MeshBasicMaterial({ colorWrite: false }) } : null;
    this.bloom = this.options.bloom !== false ? new Bloom() : null;
    // The halo goes where the scene is see-through too (its alpha with it): a glow over the page.
    this.output = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.hdr.texture }, uKnee: { value: KNEE }, tBloom: { value: this.bloom?.texture ?? null }, uBloom: { value: this.bloom ? this.options.bloom ?? BLOOM : 0 } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tScene, tBloom; uniform float uKnee, uBloom; varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tScene, vUv);
  if (uBloom > 0.0) { vec3 b = texture2D(tBloom, vUv).rgb * uBloom; gl_FragColor.rgb += b; gl_FragColor.a = max(gl_FragColor.a, clamp(max(b.r, max(b.g, b.b)), 0.0, 1.0)); }
  vec3 over = max(gl_FragColor.rgb - uKnee, 0.0), room = vec3(1.0 - uKnee);
  gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(uKnee)) + room * (1.0 - exp(-over / room));
  #include <colorspace_fragment>
}`,
    }));
    this.output.frustumCulled = false; this.outputCamera = new THREE.OrthographicCamera();
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 500);
    this.light = {
      uLightDir: { value: new THREE.Vector3() }, uLightColor: { value: new THREE.Color() }, uAmbientDir: { value: new THREE.Vector3() }, uAmbientColor: { value: new THREE.Color() },
      uAmbientTint: { value: new THREE.Color() }, uShadowColor: { value: new THREE.Color() }, uUp: { value: new THREE.Vector3() },
    };
    this.toLight = new THREE.Vector3(0, 1, 1).normalize(); this.ambientDir = new THREE.Vector3(0, 1, 0);
    this.sun = new THREE.DirectionalLight(0xffffff, 0); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.time = { value: 0 }; this.clock = 0; this.paused = false; this.hero = null; this.loading = 0;
    this.view = { center: new THREE.Vector3(0, 2, 0), distance: 10, zoom: 1, zoomTarget: 1, pitch: 0 };
    this.turn = { angle: 0, target: 0, velocity: 0, dragging: null };
    this.listen();
    this.resize = new ResizeObserver(() => this.fit()); this.resize.observe(canvas);
    this.visible = true;
    this.intersection = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }); this.intersection.observe(canvas);
    this.timer = new THREE.Timer(); this.timer.connect?.(document);
    renderer.setAnimationLoop(() => this.frame());
  }

  // A hero: his id (from options.assets), a hero folder's address (with hero.json inside), or
  // { manifest, url(path) } for bundlers.
  async load(source) {
    const ticket = ++this.loading;
    if (typeof source === 'string' && /^[a-z_0-9]+$/.test(source)) source = new URL(`heroes/${source}/`, this.assets).href;
    const { manifest, url } = typeof source === 'string' ? await fetchHero(source) : source;
    if (ticket !== this.loading) return null;
    const manager = new THREE.LoadingManager(); manager.onProgress = (_, loaded, total) => this.options.onProgress?.(loaded, total);
    const hero = await buildHero(manifest, url, manager, this.time, this.light, this.textureScale);
    // Textures load in the background; the hero shows once they are all in.
    await new Promise((done) => { if (!manager.itemsTotal || manager.itemsLoaded >= manager.itemsTotal) done(); else { manager.onLoad = done; manager.onError = () => {}; } });
    if (ticket !== this.loading) { hero.dispose(); return null; }
    this.unload(); this.hero = hero; this.scene.add(hero.lib.group, hero.turntable);
    this.applyLighting(manifest.lighting || DEFAULT_LIGHTING, hero);
    this.turn.angle = this.turn.target = this.turn.velocity = 0; this.view.zoom = this.view.zoomTarget = 1; this.view.pitch = 0;
    this.fit();
    // Each kinetic gem with the activities it changes (those of the variants with its modifiers).
    const variants = manifest.animations?.variants || [];
    const kinetic = (manifest.kinetic || []).map((k) => ({ ...k, changes: [...new Set(variants.filter((v) => v.modifiers.some((m) => k.activities.some(([, km]) => km === m))).map((v) => v.activity))] }));
    return { name: manifest.name, animations: hero.animations, kinetic };
  }
  // Dresses the hero: an item folder's address (with item.json inside), or { manifest, url } for
  // bundlers, on one of his slots in one of its styles; null puts the slot's default back.
  async wear(slot, source, style = 0) {
    const hero = this.hero; if (!hero) return;
    if (typeof source === 'number' || (typeof source === 'string' && /^\d+$/.test(source))) source = new URL(`items/${source}/`, this.assets).href;
    const tickets = (this.wearing ||= {}), ticket = (tickets[slot] = (tickets[slot] || 0) + 1);
    const current = () => hero === this.hero && ticket === tickets[slot];
    const item = typeof source === 'string' ? await fetchJson(source, 'item.json') : source;
    if (current()) await hero.wear(slot, item, style, current);
  }
  get worn() { return this.hero?.worn || {}; }
  // A prismatic gem in what a slot wears: '#rrggbb', or null.
  gem(slot, hex) { this.hero?.gem(slot, hex); }
  // An unusual effect on what a slot wears: its id (the item's unusual list), or null.
  unusual(slot, id) { this.hero?.unusual(slot, id); }
  // A kinetic gem in what a slot wears: its activities ([[activity, modifier]], from the manifest's
  // kinetic list), or null; the hero's animations take its modifiers.
  kinetic(slot, activities) { this.hero?.kinetic(slot, activities); }
  unload() { if (!this.hero) return; this.scene.remove(this.hero.lib.group, this.hero.turntable); this.hero.dispose(); this.hero = null; }

  get animations() { return this.hero?.animations || []; }
  // Plays an animation by name: a looping one stays, the others play once and return to the idle.
  play(name) { const d = this.hero?.play(name) ?? 0; this.options.onAnimation?.(name); return d; }

  // The loadout page's light: a key light casting shadows, a directional ambient and a colour for
  // what lies in shadow. The page turns the hero to face its camera, which stands off to his
  // right-front: the light is turned by the same angle about the hero, the camera stays in front.
  applyLighting(l, hero) {
    const [cx, cy] = l.camera?.position || DEFAULT_LIGHTING.camera.position, facing = -THREE.MathUtils.radToDeg(Math.atan2(cy, cx));
    this.toLight.copy(forward([l.light.angles[0], l.light.angles[1] + facing])).negate(); this.ambientDir.copy(forward([l.ambient.angles[0], l.ambient.angles[1] + facing]));
    this.light.uLightColor.value.copy(tint(l.light.color, l.light.scale)); this.light.uAmbientColor.value.copy(tint(l.ambient.color, l.ambient.scale));
    this.light.uAmbientTint.value.copy(tint(l.ambient.color, 1)); this.light.uShadowColor.value.copy(tint(l.shadow.color, l.shadow.scale));
    const { box } = hero, size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3()), r = Math.max(size.x, size.y, size.z) * 0.75 + 0.5;
    this.sun.position.copy(this.toLight).multiplyScalar(r * 3).add(center); this.sun.target.position.copy(center);
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: r * 0.5, far: r * 6 }); this.sun.shadow.camera.updateProjectionMatrix();
    // Framing: the camera looks level at the hero from far enough to fit him whole; with 'hero' the
    // pedestal shows only as far as it fits under him, the view a little lower to leave it room.
    const frame = this.options.framing === 'hero' ? hero.heroBox : box, fsize = frame.getSize(new THREE.Vector3());
    this.view.center.copy(frame.getCenter(new THREE.Vector3())); this.view.size = fsize;
    if (this.options.framing === 'hero' && hero.heroBox !== box) { this.view.center.y -= fsize.y * 0.1; this.view.size = fsize.clone().setY(fsize.y * 1.2); }
  }

  // ---- camera: the framing at any shape of the canvas.
  fit() {
    const { clientWidth: w, clientHeight: h } = this.canvas; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; const size = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.hdr.setSize(size.x, size.y); this.bloom?.setSize(size.x, size.y);
    if (this.soft) { this.soft.target.setSize(Math.ceil(size.x / 2), Math.ceil(size.y / 2)); SOFT.uSceneSize.value.copy(size); }
    this.camera.fov = 30; this.camera.updateProjectionMatrix(); this.place();
  }
  place() {
    const { center, size, zoom } = this.view; if (!size) return;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), tanH = tanV * this.camera.aspect;
    const depth = Math.max(size.x, size.z) / 2, distance = Math.max((size.y * 0.62) / tanV, (Math.max(size.x, size.z) * 0.68) / tanH) + depth;
    const pitch = this.view.pitch || 0; this.camera.position.set(center.x, center.y + Math.sin(pitch) * distance / zoom, center.z + Math.cos(pitch) * distance / zoom); this.camera.lookAt(center.x, center.y, center.z);
    this.camera.near = Math.max(0.05, distance / zoom / 50); this.camera.far = distance * 10; this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
    const view = this.camera.matrixWorldInverse;
    this.light.uLightDir.value.copy(this.toLight).transformDirection(view); this.light.uAmbientDir.value.copy(this.ambientDir).transformDirection(view); this.light.uUp.value.set(0, 1, 0).transformDirection(view);
  }

  // ---- turning: dragging turns the hero, eased toward the wanted angle; let go while moving and
  // he keeps turning, slowing down. The wheel zooms (or turns).
  listen() {
    const c = this.canvas, t = this.turn;
    const onHero = (e) => {
      if (this.options.controls !== 'hero') return true; if (!this.hero) return false;
      const r = c.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -((e.clientY - r.top) / r.height) * 2 + 1;
      const s = this.hero.screenBox(this.camera); return x >= s.min.x && x <= s.max.x && y >= s.min.y && y <= s.max.y;
    };
    this.onDown = (e) => { if (!this.options.controls || e.button !== 0 || !onHero(e)) return; e.stopPropagation(); t.dragging = { x: e.clientX, y: e.clientY, t: performance.now() }; t.velocity = 0; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; };
    this.onMove = (e) => {
      if (!t.dragging) { if (this.options.controls) c.style.cursor = onHero(e) ? 'grab' : ''; return; }
      const now = performance.now(), turn = (e.clientX - t.dragging.x) * DRAG; t.target += turn;
      this.view.pitch = THREE.MathUtils.clamp((this.view.pitch || 0) + (e.clientY - t.dragging.y) * DRAG, -1.45, 1.45); this.place();
      t.velocity = t.velocity * 0.5 + (turn / Math.max(8, now - t.dragging.t)) * 1000 * 0.5; t.dragging = { x: e.clientX, y: e.clientY, t: now };
    };
    this.onUp = (e) => { if (!t.dragging) return; if (performance.now() - t.dragging.t > 80) t.velocity = 0; t.dragging = null; c.style.cursor = this.options.controls ? 'grab' : ''; };
    this.onWheel = (e) => {
      if (!this.options.wheel || !onHero(e)) return; e.preventDefault();
      const d = (e.deltaMode === 1 ? 16 : 1) * (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? -e.deltaX : e.deltaY);
      if (this.options.wheel === 'turn') t.target -= d * WHEEL_TURN; else this.view.zoomTarget = THREE.MathUtils.clamp(this.view.zoomTarget * Math.exp(-d * 0.0015), 0.6, 3);
    };
    c.addEventListener('pointerdown', this.onDown); c.addEventListener('pointermove', this.onMove); c.addEventListener('pointerup', this.onUp); c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });
  }
  // Turns the hero to an angle (radians) or by a step, eased.
  rotate(angle, { relative = false } = {}) { this.turn.target = relative ? this.turn.target + angle : angle; this.turn.velocity = 0; }
  zoom(value) { this.view.zoomTarget = THREE.MathUtils.clamp(value, 0.6, 3); }

  frame() {
    // Paused, the hero, his effects and his materials' clock stand still (the effects take a step too
    // small to see, so that they still face the camera); the turntable and zoom go on.
    this.timer.update(); const real = Math.min(this.timer.getDelta(), 0.1), dt = this.paused ? 1e-6 : real; this.clock += dt; this.time.value = this.clock;
    if (!this.visible || document.hidden || !this.hero) { if (!this.hero) { this.renderer.setRenderTarget(null); this.renderer.clear(); } return; }
    const t = this.turn;
    if (!t.dragging) { t.target += t.velocity * real; t.velocity *= Math.exp(-GLIDE * real); }
    t.angle += (t.target - t.angle) * (1 - Math.exp(-EASE * real)); this.hero.turntable.rotation.y = t.angle;
    if (Math.abs(this.view.zoomTarget - this.view.zoom) > 1e-4) { this.view.zoom += (this.view.zoomTarget - this.view.zoom) * (1 - Math.exp(-EASE * real)); this.place(); }
    this.options.onFrame?.(real, this);
    this.hero.update(dt, this.camera);
    this.options.onAfterUpdate?.(this);
    const r = this.renderer;
    const fxGroup = this.hero.lib.group;
    const effectsVisible = this.studioEffectsEnabled !== false;
    SOFT.uSoft.value = false;
    if (this.soft && effectsVisible && fxGroup.children.some(mesh =>
      mesh.visible && mesh.geometry?.drawRange.count > 0 && mesh.material?.uniforms?.uFeather?.value > 0
    )) {
      const fx = fxGroup, shadows = r.shadowMap.autoUpdate; fx.visible = false; r.shadowMap.autoUpdate = false; this.scene.overrideMaterial = this.soft.material;
      r.setRenderTarget(this.soft.target); r.clear(); r.render(this.scene, this.camera);
      this.scene.overrideMaterial = null; r.shadowMap.autoUpdate = shadows; fx.visible = this.studioEffectsEnabled !== false;
      SOFT.tSceneDepth.value = this.soft.target.depthTexture; SOFT.uNear.value = this.camera.near; SOFT.uFar.value = this.camera.far; SOFT.uSoft.value = true;
    }
    this.hero.lib.group.visible = this.studioEffectsEnabled !== false;
    r.setRenderTarget(this.hdr); r.clear(); r.render(this.scene, this.camera);
    if (this.bloom) this.bloom.render(r, this.hdr);
    r.setRenderTarget(null); r.render(this.output, this.outputCamera);
  }

  dispose() {
    this.loading++; this.renderer.setAnimationLoop(null); this.resize.disconnect(); this.intersection.disconnect(); this.unload();
    const c = this.canvas; c.removeEventListener('pointerdown', this.onDown); c.removeEventListener('pointermove', this.onMove); c.removeEventListener('pointerup', this.onUp); c.removeEventListener('pointercancel', this.onUp); c.removeEventListener('wheel', this.onWheel);
    this.hdr.dispose(); this.bloom?.dispose(); if (this.soft) { this.soft.target.dispose(); this.soft.material.dispose(); SOFT.uSoft.value = false; } this.output.geometry.dispose(); this.output.material.dispose(); this.renderer.dispose();
  }
}

async function fetchJson(base, file) {
  const root = base.endsWith('/') ? base : `${base}/`, href = new URL(root, globalThis.location?.href).href;
  const response = await fetch(`${href}${file}`); if (!response.ok) throw new Error(`${href}${file}: ${response.status}`);
  return { manifest: await response.json(), url: (path) => href + path };
}
const fetchHero = (base) => fetchJson(base, 'hero.json');

// ---------------------------------------------------------------- one hero
// Textures at a scale below 1 are shrunk once loaded, before they reach the GPU (a phone's memory).
const shrink = (scale) => (scale >= 1 ? undefined : (t) => {
  const img = t.image; if (!img?.width || Math.max(img.width, img.height) <= 64) return;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); t.image = c; t.needsUpdate = true;
});
export async function buildHero(manifest, url, manager, time, light, textureScale = 1) {
  // Each texture once (particle models make materials of their own, many a second).
  const made = [], textureCache = new Map(), textureOf = (loader, address) => (file, srgb = false) => {
    const href = address(`textures/${file}`), key = `${href}#${srgb}`; if (textureCache.has(key)) return textureCache.get(key);
    const t = loader.load(href, shrink(textureScale)); t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; made.push(t); textureCache.set(key, t); return t;
  };
  const texture = textureOf(new THREE.TextureLoader(manager), url);
  // Cube maps from their strip of faces (+X −X +Y −Y +Z −Z in the game's axes), one of each.
  const cubes = new Map();
  const cubeOf = (address, loading) => (file) => {
    const href = address(`textures/${file}`); if (cubes.has(href)) return cubes.get(href);
    const t = new THREE.CubeTexture(); t.colorSpace = THREE.SRGBColorSpace; cubes.set(href, t); made.push(t);
    new THREE.ImageLoader(loading).load(href, (img) => {
      const s = img.height; t.images = [0, 1, 2, 3, 4, 5].map((i) => { const c = document.createElement('canvas'); c.width = c.height = s; c.getContext('2d').drawImage(img, i * s, 0, s, s, 0, 0, s, s); return c; });
      t.needsUpdate = true;
    });
    return t;
  };
  const cube = cubeOf(url, manager);
  // The models are packed with EXT_meshopt_compression (tools/compress.mjs).
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const names = Object.keys(manifest.models), loaded = Object.fromEntries(await Promise.all(names.map(async (k) => [k, await loader.loadAsync(url(manifest.models[k]))])));
  const propFiles = [...new Set([...(manifest.props || []).map((p) => p.file), ...Object.values(manifest.fxModels || {}).map((m) => m.file)])];
  const propModels = Object.fromEntries(await Promise.all(propFiles.map(async (f) => [f, await loader.loadAsync(url(f))])));
  const heroModel = loaded.hero, root = heroModel.scene, bones = {}, inverses = {};

  // Our VRF GLBs retain native names for attachment/snapshot lookup even when
  // GLTFLoader sanitizes a dot or colon out of the display bone name.
  const boneKey = b => String(b.userData.studioSourceName || b.name).toLowerCase();
  const registerBone = (bone, mapped, inverse) => { for(const key of new Set([boneKey(bone),bone.name.toLowerCase()])) { bones[key] ||= mapped; if(inverse) inverses[key] ||= inverse; } };
  // Items follow the hero's skeleton by bone name, as the game bone-merges them; an item's own
  // extra bones hang under the hero bone that is their parent. What a slot wears is a set of meshes
  // and such bones, put on and taken off whole (the defaults are kept for when they come back).
  root.traverse((o) => { if (o.isBone) registerBone(o,o); if (o.isSkinnedMesh) o.skeleton.bones.forEach((b,i)=>registerBone(b,b,o.skeleton.boneInverses[i])); });
  const heroBoneNames = new Set(Object.keys(bones));
  // Never fit a new wearable against stale bones belonging to a previous
  // wearable. The hero's skeleton is the stable reference for every item.
  // In particular Tinker's two cannons and Timbersaw's articulated claw must
  // not bind to a detached item's animation rig after changing loadout.
  const originalHeroBones = { ...bones };

  const fit = (scene,attachmentRows,privateAnchor) => {
    let invokerKnot = false;
    scene.traverse(node => { if (node.isMesh && /crimson_taoist_head/i.test(node.userData.studioSourceName || node.name)) invokerKnot = true; });
    const skinned = [], rigid = [], extra = [], localBones = [];
    const seenBones = new Set();
    scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); else if (o.isMesh) rigid.push(o); });
    for (const mesh of skinned) {
      const active=activeSkinJoints(mesh,attachmentSkinBones(attachmentRows));
      const mapped = mesh.skeleton.bones.map((b, i) => { if(!active.has(i))return b; const own = originalHeroBones[boneKey(b)] || originalHeroBones[b.name.toLowerCase()]; const knot = invokerKnot && boneKey(b) === 'topknot_0'; const privateBone = boneKey(b) === privateAnchor; if (own && !knot && !privateBone) return own; if (b.parent && boneKey(b.parent) === privateAnchor) return b; if (invokerKnot && b.parent && boneKey(b.parent) === 'topknot_0') return b; const parent = (knot && originalHeroBones.head_1) || (b.parent && (originalHeroBones[boneKey(b.parent)] || originalHeroBones[b.parent.name.toLowerCase()])) || (manifest.id==='morphling'&&/^shark_(?:r|l)(?:_back)?_01_jnt$/.test(boneKey(b))?bones.root:null);
        if (parent && !extra.some((x) => x.bone === b)) {
          // Where it hangs under the hero's bone, from the bind poses of the two: the item's own of
          // that bone (its weapon's bone, Pugna's sceptre, bound otherwise than his default one's),
          // unless the item has only a stand-in of it at the origin (Tinker's Arcanic Resonance Beam:
          // its cannon's bones 4 m off, under the floor), then the hero's.
          const key = boneKey(parent), j = mesh.skeleton.bones.findIndex((x) => boneKey(x) === key);
          const at = (m) => new THREE.Vector3().setFromMatrixPosition(m.clone().invert());
          const own = j >= 0 ? mesh.skeleton.boneInverses[j] : null, hero = inverses[key];
          const parentInverse = own && (knot || !hero || at(own).distanceTo(at(hero)) < 0.5) ? own : hero;
          const local = parentInverse ? parentInverse.clone().multiply(mesh.skeleton.boneInverses[i].clone().invert()) : null;
          extra.push({ bone: b, parent, key: boneKey(b), inverse: mesh.skeleton.boneInverses[i], local: privateBone ? null : local, privateBone });
        }
        return b; });
      // Extra bones are available to effects *only while their item is worn*.
      // Keeping them in the global index after removal breaks later Tinker/Timbersaw weapons.
      mesh.skeleton.bones.forEach((b, i) => {
        if (!active.has(i) || mapped[i] !== b || seenBones.has(b)) return;
        const keys = [...new Set([boneKey(b), b.name.toLowerCase()])].filter(k => k && !heroBoneNames.has(k));
        if (keys.length) { seenBones.add(b); localBones.push({ bone: b, inverse: mesh.skeleton.boneInverses[i], keys }); }
      });
      mesh.bind(new THREE.Skeleton(mapped, mesh.skeleton.boneInverses), mesh.bindMatrix);
    }
    // Unskinned items stay as they are, beside the hero.
    return { meshes: [...skinned, ...rigid], extra, localBones };
  };
  // Register only joints belonging to equipment that is actually worn. This
  // restores another active joint after removing a same-named sword or cannon.
  const { attach: attachBoneOwners, detach: detachBoneOwners } = wearableBoneOwners(bones, inverses, heroBoneNames);
  // A companion stands beside the hero on the turntable; no extra skin joints from
  // its previous equipment survive a change of wearable.
  const putOn = w => {
    for (const x of w.extra || []) { x.parent.add(x.bone); if (x.local) x.local.decompose(x.bone.position, x.bone.quaternion, x.bone.scale); }
    attachBoneOwners(w);
    for (const m of w.meshes) root.add(m);
    if (w.companion) turntable.add(w.companion.group);
  };
  const takeOff = w => {
    if (w.companion) w.companion.group.removeFromParent();
    for (const m of w.meshes) root.remove(m);
    detachBoneOwners(w);
    for (const x of w.extra || []) x.bone.parent?.remove(x.bone);
  };
  const refitted = [];
  const refit = () => {
    const now = new Set(worn.values());
    for (const { w, r } of refitted.splice(0)) {
      if (now.has(w)) for (const m of w.meshes) root.add(m);
      if (r.fitted) takeOff(r.fitted);
    }
    for (const [, a] of worn) for (const r of a.refits || []) for (const [, w] of worn) {
      if (w === a || w.item !== r.item || (r.style != null && w.styleIndex !== r.style)) continue;
      for (const m of w.meshes) root.remove(m);
      if (r.scene) { r.fitted ||= fit(r.scene, r.attachments); putOn(r.fitted); }
      refitted.push({ w, r });
    }
  };
  const items = names.filter((k) => k !== 'hero' && k !== 'pedestal' && k !== 'animation-source'), defaults = new Map(), worn = new Map(), wearing = new Map();
  const heroMeshes = []; root.traverse((o) => { if (o.isMesh) heroMeshes.push(o); });
  for (const name of items) {
    const asset = loaded[name];
    // fit() reparents extra bones out of the source scene before clips are merged.
    asset.studioTrackNodes = new Map();
    asset.scene.traverse(node => {
      asset.studioTrackNodes.set(node.uuid, node);
      if (node.name && !asset.studioTrackNodes.has(node.name)) asset.studioTrackNodes.set(node.name, node);
    });
    const privateAnchor = name.startsWith('part-') && asset.animations.length === 1
      ? { loadout_ti7: 'weapon_root', timb_ti9_loadout: 'ripsawbase9_0' }[asset.animations[0].name]
      : undefined;
    const w = fit(asset.scene, manifest.attachments?.[name], privateAnchor);
    defaults.set(name, w);
    const current = { ...w, item: null };
    worn.set(name, current);
    putOn(current);
  }
  const turntable = new THREE.Group(); turntable.add(root); if (loaded.pedestal) turntable.add(loaded.pedestal.scene);
  const materials = new Map();
  // An item's materials come with it, their textures from its folder: keyed by both.
  // skin: the materials a skin (material group) puts in place of the default ones, by name.
  const dressMesh = (o, mats = manifest.materials, tex = texture, base = '', cubeMap = cube, skin = null) => {
    o.frustumCulled = false; o.castShadow = o.receiveShadow = true;
    // A mesh whose material did not come with the hero (an additive glow, a motion smear) is hidden
    // rather than drawn plain white. Its own material's name is kept for changing skins later.
    if (!Object.hasOwn(mats, o.userData.material)) o.userData.material = o.material.name;
    const key = skin?.[o.userData.material] ?? o.userData.material, m = mats[key]; o.visible = !!m; if (!m) return;
    if (!materials.has(base + key)) materials.set(base + key, heroMaterial(m, tex, time, light, cubeMap));
    if (!o.material.userData.hero) o.material.dispose(); // the loader's; ours are shared
    o.material = materials.get(base + key);if(o.geometry.attributes.color)o.material.vertexColors=true;
  };
  const dress = (group, ...rest) => group.traverse((o) => { if (o.isMesh) dressMesh(o, ...rest); });
  dress(turntable);
  // The hero's own skin: what an item that is only his form (an arcana's style) asks for.
  const reskin = () => {
    const k = Math.max(0, ...[...worn.values()].filter((w) => w.item && w.style.form && !w.style.models?.length).map((w) => w.style.skin || 0));
    for (const o of heroMeshes) dressMesh(o, manifest.materials, texture, '', cube, manifest.skins?.hero?.[k - 1]);
  };

  // Animations: the entry once, then the idle loop; the others on request.
  const mixer = new THREE.AnimationMixer(root), clips = new Map(heroModel.animations.map((a) => [a.name, a]));
  for (const [owner, model] of Object.entries(loaded)) {
    if (owner === 'hero' || owner === 'pedestal') continue;
    const privateBones = new Map((worn.get(owner)?.extra ?? []).filter(x => x.privateBone).map(x => [x.key, x.bone]));
    const shared = privateBones.size ? new Set([...heroBoneNames].filter(key => !privateBones.has(key))) : heroBoneNames;
    mergeWearableClips(clips, model, manifest.wearableSequences?.[owner] ?? [], manifest.animations?.list ?? [], shared, boneKey,
      node => privateBones.get(boneKey(node)) || bones[boneKey(node)] || root.getObjectByName(node.name),
      owner.startsWith('part-') ? manifest.animations?.idle : undefined);
  }
  const a = manifest.animations || {}, list = (a.list?.length ? [...a.list, ...[...clips.keys()].filter(name=>!a.list.some(x=>x.name===name)).map(name=>({name,loop:/(?:idle|run|walk|loadout)/i.test(name)}))] : [...clips.keys()].map((name) => ({ name,loop:/(?:idle|run|walk|loadout)/i.test(name) }))).filter((x) => clips.has(x.name));
  for (const item of list) if (item.additive) clips.get(item.name).blendMode = THREE.AdditiveAnimationBlendMode;
  const action = (name) => { const c = clips.get(name); return c ? mixer.clipAction(c) : null; };
  const idleName = clips.has(a.idle) ? a.idle : list[0]?.name;
  const idle = idleName ? action(idleName) : null; let current = idle, currentName = idleName;
  const loops = new Set(list.filter((x) => x.loop).map((x) => x.name)); if (idleName) loops.add(idleName);
  // What is worn picks among an animation's variants by their activity modifiers (Huskar's spear
  // grip, Juggernaut's Faces set): the one matching the most, fewest others on a tie, as the game
  // does; none matching, the plain one. modifiers: [activity or ALL, tag] of all that is worn.
  const variants = (a.variants || []).filter((x) => clips.has(x.name)), activityOf = new Map([...list, ...variants].map((x) => [x.name, x.activity]));
  let modifiers = [];
  const kinetics = new Map();
  const pick = (name) => {
    const act = activityOf.get(name); if (!act) return name;
    const tags = new Set(modifiers.filter(([at]) => at === 'ALL' || at === act).map(([, tag]) => tag));
    let best = name, score = 0, extra = Infinity;
    for (const v of variants) {
      if (v.activity !== act) continue; const m = v.modifiers.filter((tag) => tags.has(tag)).length, x = v.modifiers.length - m;
      if (m > score || (m && m === score && x < extra)) { best = v.name; score = m; extra = x; }
    }
    return best;
  };
  let currentBase = idleName;
  // name: an animation of the list (or the entry); what plays is its variant.
  const start = (name, fade = 0.25) => {
    const clip = pick(name), next = action(clip); if (!next) return 0;
    const loop = loops.has(name); next.reset(); next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); next.clampWhenFinished = !loop; next.play();
    if (current && current !== next) current.crossFadeTo(next, fade, false); current = next; currentName = clip; currentBase = name; return next.getClip().duration;
  };
  mixer.addEventListener('finished', (e) => { if (e.action === current && idle && currentBase !== idleName) start(idleName, 0.3); });
  // The modifiers of what each slot wears now; the animation playing changes to its variant.
  const remodify = () => {
    modifiers = [...(a.defaults?.hero || []), ...[...worn].flatMap(([slot, w]) => (w.item ? w.style.activities || [] : a.defaults?.[slot] || [])), ...[...kinetics.values()].flat()];
    if (current?.isRunning() && pick(currentBase) !== currentName) start(currentBase, 0.2);
  };
  remodify();
  // Bounds in the idle pose (for framing, shadows and the drag area); then the entry, if any.
  if (idle) start(idleName, 0);
  mixer.update(0); turntable.updateMatrixWorld(true);
  const samples = [], point = new THREE.Vector3(), heroBox = new THREE.Box3(), box = new THREE.Box3();
  turntable.traverse((o) => { if (!o.isMesh) return; const count = o.geometry.attributes.position.count, step = Math.max(1, Math.ceil(count / 600)); for (let i = 0; i < count; i += step) samples.push([o, i]); });
  const isPedestal = (o) => { for (let p = o; p; p = p.parent) if (p === loaded.pedestal?.scene) return true; return false; };
  for (const [mesh, i] of samples) { mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld); box.expandByPoint(point); if (!isPedestal(mesh)) heroBox.expandByPoint(point); }
  if (heroBox.isEmpty()) heroBox.copy(box);
  if (loaded.pedestal && manifest.studioPedestal) {
    // The asset's top is y=0, matching the hero's native ground plane. Floating
    // idle animations retain their authored height above it.
    const pedestal=loaded.pedestal.scene,radius=THREE.MathUtils.clamp(heroBox.getSize(new THREE.Vector3()).y*.48,.65,3);
    pedestal.scale.set(radius,radius,radius);turntable.updateMatrixWorld(true);
    box.copy(heroBox).union(new THREE.Box3().setFromObject(pedestal));
  }
  // Props (Pudge's clown car, Largo's frogs): one copy per event, at the hero, shown while their
  // animation plays from the event's frame on, their own clip kept in step with the hero's time.
  // Added after the bounds, which are the hero's alone. (No prop of the game uses an attachment.)
  const props = (manifest.props || []).map((p) => {
    const source = propModels[p.file]; if (!source) return null;
    const scene = cloneSkinned(source.scene), clip = source.animations.find((c) => c.name === p.clip), mixer = new THREE.AnimationMixer(scene);
    if (clip) { const act = mixer.clipAction(clip); act.setLoop(p.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); act.clampWhenFinished = true; act.play(); }
    scene.visible = false; dress(scene); turntable.add(scene);
    return { ...p, scene, mixer };
  }).filter(Boolean);
  if (a.entry && clips.has(a.entry)) { start(a.entry, 0); mixer.update(0); }

  // ---- effects: the hero's particles with their own control point drivers, in the game's space.
  // Models drawn by particles (C_OP_RenderModels) are copies of the hero's fx models, dressed alike.
  const fxModels = {
    // The clip: the one named most like the effect (Arc Warden's …_hat_start effect plays the hat's
    // …_hat_start, its …_hat_start_loadout the …_loadout one, whatever activities they name), else
    // the one of the renderer's activity.
    get(path, activity, system, override = null) {
      const info = manifest.fxModels?.[path], source = info && propModels[info.file]; if (!source) return null;
      // Materials of its own (an item's model has its item's): the particle tints them, each its own.
      const scene = cloneSkinned(source.scene), mats = info.materials || manifest.materials, own = [];
      scene.traverse((o) => { if (!o.isMesh) return; o.frustumCulled = false; o.castShadow = false; o.userData.material ??= o.material.name;
        // The renderer's material in place of the model's own; without it, the model is not drawn (a
        // stand-in card, Ravencloak's main-menu sky, must not show as itself).
        const m = override ? mats[override] || manifest.materials?.[override] : mats[o.userData.material]; o.visible = !!m; if (!m) return; o.material = heroMaterial(m, info.texture || texture, time, light, info.cube || cube); own.push(o.material); });
      const words = (system || '').split('/').pop().split('_'), tail = (name) => { const w = name.split('_'); let k = 0; while (k < w.length && k < words.length && w[w.length - 1 - k] === words[words.length - 1 - k]) k++; return k; };
      const usable=source.animations.filter(c=>c.name!=='bindPose'&&!c.name.startsWith('@'));
      const named = usable.map((c) => [c, tail(c.name)]).sort((a, b) => b[1] - a[1])[0];
      const clip = named && named[1] >= 2 ? named[0] : usable.find((c) => c.name === info.clips?.[activity||'ACT_DOTA_IDLE']) || usable.find(c=>/(^|[_/])(idle|loop)([_/]|$)/i.test(c.name)) || usable[0] || null;
      return { scene, clip, materials: own };
    },
  };
  // Items' particle textures come with full addresses.
  const lib = new Library({ systems: manifest.systems || {}, textures: manifest.textures || {}, snapshots: manifest.snapshots || {}, url: (file) => (/^[a-z]+:/.test(file) ? file : url(`fx/${file}`)), models: fxModels, options: { onTexture: shrink(textureScale) } });
  lib.loader.manager = manager;
  // Attachments by model: the hero's, and those of what each slot wears.
  const attachments = { ...manifest.attachments };
  const attachment = (name, owner, entity = 'self') => resolveModelAttachment(attachments,name,owner,entity);
  const attachmentMatrix = (at) => {
    const influence = i => { const bone = bones[at.bones[i].toLowerCase()]; if(!bone) return null;
      return toSource(bone.matrixWorld.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...at.offsets[i]).multiplyScalar(0.0254), new THREE.Quaternion(...at.rotations[i]), new THREE.Vector3(1,1,1)))); };
    if(at.bones.length===1&&!at.ignoreRotation)return influence(0);
    const position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion(0,0,0,0);let total=0,reference;
    for(let i=0;i<at.bones.length;i++){const weight=at.weights?.[i]??(i===0?1:0),matrix=weight>0&&influence(i);if(!matrix)continue;const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();matrix.decompose(p,q,s);reference??=q.clone();if(reference.dot(q)<0)q.set(-q.x,-q.y,-q.z,-q.w);position.addScaledVector(p,weight);scale.addScaledVector(s,weight);rotation.set(rotation.x+q.x*weight,rotation.y+q.y*weight,rotation.z+q.z*weight,rotation.w+q.w*weight);total+=weight;}
    if(!total)return influence(0);position.divideScalar(total);scale.divideScalar(total);if(at.ignoreRotation)rotation.identity();else rotation.normalize();return new THREE.Matrix4().compose(position,rotation,scale);
  };

  const model = {
    bones: ((list) => (list.length ? list : [...new Set(Object.values(bones))].filter((b) => b.isBone)))(Object.values(bones).filter((b) => b.name.endsWith('_JNT'))),
    bone: (name) => bones[name.toLowerCase()] || null,
    // A point in a bone's own space (inches), in the effects' space.
    boneLocal(name, pos) { const b = bones[name.toLowerCase()]; return b ? pos.clone().multiplyScalar(0.0254).applyMatrix4(b.matrixWorld).applyMatrix4(groupInverse) : pos.clone(); },
    boneMatrix: (b) => toSource(b.matrixWorld.clone()),
    bonePosition: (b) => new THREE.Vector3().setFromMatrixPosition(toSource(b.matrixWorld.clone())),
    skin(pos, skin) {
      const p = pos.clone().applyMatrix4(SOURCE_TO_GLTF), out = new THREE.Vector3(), t = new THREE.Vector3(); let total = 0;
      for (const [name, w] of skin) { const b = bones[name.toLowerCase()], inv = inverses[name.toLowerCase()]; if (!b || !inv || !w) continue; t.copy(p).applyMatrix4(inv).applyMatrix4(b.matrixWorld); out.addScaledVector(t, w); total += w; }
      return total ? out.divideScalar(total).applyMatrix4(groupInverse) : pos.clone();
    },
  };

  // Control points from a system's drivers: at the hero's origin or an attachment, following it or
  // fixed where it was when the effect started, plus the driver's offset. The world origin is the
  // hero's (he stands at it on the loadout page): it turns with him, and its offset — often a value,
  // not a place (Arc Warden's CP 7 = 1, 1, 1 scales his taunt props) — is added unturned.
  // The hero's origin as a control point: his turn on the turntable, in the game's axes (facing +x,
  // z up) — the conversion to glTF taken out on both sides, not only before.
  const heroOrigin = () => toSource(root.matrixWorld.clone()).multiply(SOURCE_TO_GLTF);
  const driverOf = (d) => ({ cp: d.m_iControlPoint ?? 0, type: d.m_iAttachType || 'PATTACH_ABSORIGIN_FOLLOW', attachment: d.m_attachmentName || null, entity: d.m_entityName || 'self', offset: d.m_vecOffset ? new THREE.Vector3(...d.m_vecOffset) : null });
  const configs = (def) => def.m_controlPointConfigurations || [];
  const driversFor = (def, config) => {
    const named = config != null && configs(def).find((c) => c.m_name === config);
    if (named) return (named.m_drivers || []).map(driverOf);
    // An event's config that the system lacks names an attach type (absorigin, point_follow…).
    if (config && /^(absorigin|point|world)/.test(config)) return [{ cp: 0, type: `PATTACH_${config.replace(/^point/, 'point').toUpperCase()}`, attachment: null, offset: null }];
    return ((configs(def).find(c=>c.m_name==='preview') || configs(def)[0])?.m_drivers || []).map(driverOf);
  };
  const cpOf = (m) => { const c = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), matrix() { return new THREE.Matrix4().compose(this.pos, this.quat, new THREE.Vector3(1, 1, 1)); } }; m.decompose(c.pos, c.quat, new THREE.Vector3()); return c; };
  const placeCP = (d, owner, origin) => {
    if (d.type === 'PATTACH_WORLDORIGIN') { const c = cpOf(origin); if (d.offset) c.pos.add(d.offset); return c; }
    const at = /POINT|CENTER/.test(d.type) && d.attachment ? attachment(d.attachment, owner, d.entity) : null;
    const matrix = at && attachmentMatrix(at);
    if (d.attachment && /POINT|CENTER/.test(d.type) && !matrix) return null;
    const c = cpOf(matrix || origin);
    if (d.offset) c.pos.add(d.offset.clone().applyQuaternion(c.quat));
    return c;
  };
  const follows = (d) => /FOLLOW|WORLDORIGIN/.test(d.type);
  // Points on what a slot wears, for effects born on their model (C_INIT_CreateOnModel: an item's
  // effects are on the item, unusual ones all over it): a triangle by its area, a point in it, and
  // where that point is as the item moves (skinned); null when the slot shows nothing of its own.
  const surfaces = new Map();
  const surfaceOf = (owner) => {
    const meshes = particleSurfaceMeshes(heroMeshes, worn, owner); if (!meshes?.length) return null;
    let s = surfaces.get(owner || 'hero');
    if (!s || s.meshes.length !== meshes.length || s.meshes.some((m, i) => m !== meshes[i])) {
      const tris = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let total = 0;
      for (const m of meshes) { const g = m.geometry, idx = g.index, n = idx ? idx.count : g.attributes.position.count, pos = g.attributes.position;
        for (let i = 0; i + 2 < n; i += 3) { const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
          a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2); total += b.sub(a).cross(c.sub(a)).length(); tris.push({ m, i: [i0, i1, i2], at: total }); } }
      s = { tris, total, meshes: [...meshes] }; surfaces.set(owner || 'hero', s);
    }
    return s.total ? s : null;
  };
  const surfacePoint = (owner) => {
    const s = surfaceOf(owner); if (!s) return null;
    const r = Math.random() * s.total; let lo = 0, hi = s.tris.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (s.tris[mid].at < r) lo = mid + 1; else hi = mid; }
    const { m, i } = s.tris[lo]; let u = Math.random(), v = Math.random(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = [1 - u - v, u, v], p = new THREE.Vector3(), out = new THREE.Vector3();
    return () => { out.set(0, 0, 0); for (let k = 0; k < 3; k++) out.addScaledVector(m.getVertexPosition(i[k], p), w[k]); return out.applyMatrix4(m.matrixWorld).applyMatrix4(groupInverse); };
  };
  const instance = (def, owner, drivers) => {
    const sim = new Simulation(def, lib);
    // Refitted meshes replace their ordinary counterparts in the live scene.
    let meshes=particleSurfaceMeshes(heroMeshes,worn,owner);
    for(const{w,r}of refitted)if(r.fitted&&w.meshes.some(m=>meshes.includes(m)))meshes=[...meshes.filter(m=>!w.meshes.includes(m)),...r.fitted.meshes];
    meshes=meshes.filter(m=>m.parent&&m.visible);
    sim.model = { ...model,...snapshotBinding(meshes,SOURCE_TO_GLTF,model), surface: () => surfacePoint(owner || 'hero') };
    const e = { sim, owner, drivers, fixed: new Map() }, origin = heroOrigin();
    for (const d of drivers) if (!follows(d)) e.fixed.set(d.cp, placeCP(d, owner, origin));
    return e;
  };
  // Prismatic gems by slot: the game gives an item's effects the gem's colour (0–255) in control
  // point 15 and turns it on with CP 16 = (1, 1, 0); without a gem both are 0 (not CP 0 standing in).
  const gems = new Map(), GEMLESS = cpOf(new THREE.Matrix4());
  // An arcana's gem (an item that is the hero's form: Terrorblade's) is the hero's: it colours all his
  // effects and the materials that read $GemColor, whatever item they are on.
  const heroGem = () => { for (const [slot, w] of worn) if (w.item && w.style?.form && gems.has(slot)) return gems.get(slot); return null; };
  const gemTint = () => { const g = heroGem(), hex = g ? `#${((g.r << 16) | (g.g << 8) | g.b).toString(16).padStart(6, '0')}` : null; for (const m of materials.values()) m.userData.gem?.(hex); };
  const gemPoints = (owner) => { const g = gems.get(owner) || heroGem(); if (!g) return null;
    const color = cpOf(new THREE.Matrix4().makeTranslation(g.r, g.g, g.b)), on = cpOf(new THREE.Matrix4().makeTranslation(1, 1, 0)); return [color, on]; };
  // A gem's points over the effect's own: its drivers may set CPs 15 and 16 as it looks without one
  // (Scythes of Sorrow's white, off), which the game's gem then overrides.
  const drive = (e, origin) => {
    const cps = e.sim.cps; cps.clear(); cps.set(0, cpOf(origin)); cps.set(15, GEMLESS); cps.set(16, GEMLESS);
    const unresolved = [];
    let itemAnchor = null;
    for (const d of e.drivers) {
      const point = e.fixed.get(d.cp) || placeCP(d, e.owner, origin);
      if (!point) { unresolved.push(d.cp); continue; }
      cps.set(d.cp, point);
      if (d.attachment && /POINT|CENTER/.test(d.type) && (d.cp === 0 || !itemAnchor)) itemAnchor = point;
    }
    // A missing auxiliary point belongs near the effect's working attachment.
    // Leaving it at the hero origin stretches ropes across the scene.
    if (itemAnchor) for (const cp of unresolved) cps.set(cp, itemAnchor);
    const gem = e.color ? [cpOf(new THREE.Matrix4().makeTranslation(...e.color.map(n=>Math.round(n*255)))),cpOf(new THREE.Matrix4().makeTranslation(1,1,0))] : gemPoints(e.owner); if (gem) { cps.set(15, gem[0]); cps.set(16, gem[1]); }
  };
  // The ambient effects: the hero's own and his items' — a slot's default ones only while it wears
  // its default. Worn items may put their own effects and snapshots in place of the hero's.
  let effects = [], studioIsolated=false;
  const replaced = new Map(), replacedBy = new Map(), unusuals = new Map();
  const ambient = () => {
    for (const e of effects) e.sim.dispose();
    replaced.clear(); replacedBy.clear(); lib.aliases.clear();
    const list = (manifest.effects || []).filter((e) => !worn.get(e.owner)?.item);
    // A slot's default replaces effects while it is worn (the hero's own default, always).
    for (const [slot, r] of Object.entries(manifest.replace || {})) if (!worn.get(slot)?.item) for (const [from, to] of Object.entries(r)) replaced.set(from, to);
    for (const [slot, w] of worn) if (w.item&&!studioIsolated) {
      for (const system of w.style.effects) list.push({ system, owner: slot });
      const u = unusuals.has(slot) && w.unusual?.find((x) => x.id === unusuals.get(slot)); if (u) list.push({ system: u.system, owner: slot });
      // An effect an item puts in place of the hero's is the item's (its gem colours it).
      for (const [from, to] of Object.entries(w.style.particles)) { replaced.set(from, to); replacedBy.set(from, slot); }
      for (const [from, to] of Object.entries(w.style.snapshots)) lib.aliases.set(from, to);
    }
    effects = list.map((e) => { const def = lib.system(replaced.get(e.system) ?? e.system); return def ? Object.assign(instance(def, replacedBy.get(e.system) || e.owner, driversFor(def, null)),{color:e.color??null}) : null; }).filter(Boolean);
  };
  ambient();

  // Effects the animations start and stop by their events, at their moments in the animation.
  const events = manifest.events || [], live = [];
  const fire = (ev) => {
    if (ev.stop) { for (const e of live) if (e.system === ev.system) { e.sim.stopEmission(); if (ev.instantly) e.kill = true; } return; }
    const def = lib.system(replaced.get(ev.system) ?? ev.system); if (!def) return;
    // Events give attach types in short (point_follow) or as the game's names (PATTACH_POINT_FOLLOW).
    const attachType = (type, att) => (type ? (/^PATTACH_/.test(type) ? type : `PATTACH_${type.toUpperCase()}`) : att ? 'PATTACH_POINT_FOLLOW' : 'PATTACH_ABSORIGIN_FOLLOW');
    const drivers = ev.points ? ev.points.map(([att, type], cp) => att || cp === 0 ? { cp, type: attachType(type, att), attachment: att, offset: null } : null).filter(Boolean) : driversFor(def, ev.config);
    live.push(Object.assign(instance(def, replacedBy.get(ev.system) || 'hero', drivers), { system: ev.system, sequence: ev.sequence, stopOnSeqChange: ev.stopOnSeqChange, born: 0 }));
  };
  let lastName = null, lastTime = 0;
  const schedule = () => {
    if (studioIsolated||!current) return;
    const duration = current.getClip().duration || 1, now = current.time;
    if (currentName !== lastName) {
      // A new animation: those of the last one that end with it stop making particles.
      for (const e of live) if (e.sequence === lastName && e.stopOnSeqChange !== false) e.sim.stopEmission();
      lastName = currentName; lastTime = -1e-6;
    }
    // Events between the last frame and this one; a loop that wrapped around fires the rest of the
    // previous pass and the start of this one.
    const from = lastTime, wrapped = now < from;
    for (const ev of events) {
      if (ev.sequence !== currentName) continue; const at = ev.cycle * duration;
      if (wrapped ? at > from || at <= now : at > from && at <= now) fire(ev);
    }
    lastTime = now;
  };
  let studioDisposed = false; const studioPropFiles = new Set();
  const disposeProp = gltf => gltf?.scene.traverse(o => { o.geometry?.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose(); });
  return {
    turntable, lib, box, heroBox, live, get effects() { return effects; },
    // Host extension: data-only scene updates for the host application.
    // The public page does not expose an editor or file-write operations.
    studioIsolation(value){studioIsolated=!!value;},
    studioReplayEffects(){for(const e of live)e.sim.dispose();live.length=0;ambient();},
    studioSeekEffects(seconds){ambient();const duration=Math.max(0,Math.min(5,seconds));for(const e of effects){drive(e,heroOrigin());for(let t=0;t<duration;t+=1/120){drive(e,heroOrigin());e.sim.update(Math.min(1/120,duration-t));}}},
    async studioEffects(patch) {
      if (studioDisposed) throw Object.assign(Error('Scene disposed'), {name:'AbortError'});
      const nextFiles = new Set(Object.values(patch.fxModels || {}).map(info => info.file));
      for (const file of studioPropFiles) if (!nextFiles.has(file)) { disposeProp(propModels[file]); delete propModels[file]; studioPropFiles.delete(file); }
      for (const e of effects) e.sim.dispose(); effects = [];
      for (const e of live) e.sim.dispose(); live.length = 0;
      for (const { texture } of lib.cache.values()) texture?.dispose(); lib.cache.clear();
      lib.materials = patch.materials || {};lib.systems = patch.systems || {}; lib.textures = patch.textures || {}; lib.snapshots = patch.snapshots || {};
      for (const [path, def] of Object.entries(lib.systems)) if (def && !def._path) Object.defineProperty(def, '_path', { value: path });
      for (const [path, info] of Object.entries(patch.fxModels || {})) {
        if (propModels[info.file]) continue;
        let gltf;
        try {
          gltf = await loader.loadAsync(url(info.file));
        } catch (error) {
          if (studioDisposed) throw Object.assign(Error('Scene disposed'), { name: 'AbortError' });
          lib.unsupported.add(`Particle model failed to load: ${path} (${error?.message || error})`);
          continue;
        }
        if (studioDisposed) {
          disposeProp(gltf);
          throw Object.assign(Error('Scene disposed'), { name: 'AbortError' });
        }
        propModels[info.file] = gltf;
        studioPropFiles.add(info.file);
      }
      manifest.fxModels = patch.fxModels || {}; manifest.effects = patch.effects || [];
      ambient();
      return { systems: effects.length, warnings: [...lib.unsupported] };
    },
    studioMaterial(name, patch) {
      if (!Object.hasOwn(manifest.materials, name)) throw Error('Unknown scene material');
      Object.assign(manifest.materials[name], patch);
      for (const [key, material] of materials) if (key === name) { material.dispose(); materials.delete(key); }
      turntable.traverse((o) => { if (o.isMesh && o.userData.material === name) dressMesh(o); });
      lib.group.traverse(o=>{if(!o.isMesh||o.userData.material!==name)return;const fresh=heroMaterial(manifest.materials[name],texture,time,light,cube);for(const material of Array.isArray(o.material)?o.material:[o.material]){material.copy(fresh);material.userData=fresh.userData;material.userData.studioParticleBaseColor=material.color.clone();material.userData.studioParticleBaseOpacity=material.opacity;material.onBeforeCompile=fresh.onBeforeCompile;material.needsUpdate=true;}fresh.dispose();});
    },
    studioEffectsVisible(visible) { lib.group.visible = !!visible; },
 animations: list.map((x) => ({ ...x, loop: loops.has(x.name), duration: clips.get(x.name).duration })),
    play: (name) => start(name),
    // The clip playing: the animation's variant for what is worn.
    get playing() { return currentName; },
    update(dt, camera) {
      mixer.update(dt); for (const w of worn.values()) w.companion?.mixer.update(dt);
      // A later event with the same model in the same animation takes over (Ringmaster's box: built, then broken).
      for (const p of props) p.at = currentName === p.sequence && current ? current.time - p.frame / 30 : -1;
      for (const p of props) { const later = props.some((q) => q !== p && q.file === p.file && q.sequence === p.sequence && q.frame > p.frame && q.at >= 0); p.scene.visible = p.at >= 0 && !later; if (p.scene.visible) p.mixer.setTime(p.at); }
      turntable.updateMatrixWorld(true); schedule();
      const origin = heroOrigin();
      for (const e of effects) drive(e, origin);
      for (const e of live) drive(e, origin);
      for (const e of [...effects, ...live]) e.sim.update(dt);
      // Spent effects go: stopped and empty, killed, or long past (a stray endless one). One that
      // outlives its animation by a second is stopped (Marci's taunt basket, which no event stops).
      for (let i = live.length - 1; i >= 0; i--) { const e = live[i]; e.born += dt;
        e.over = e.sequence === currentName ? 0 : (e.over || 0) + dt; if (e.over > 1) e.sim.stopEmission();
        if (e.kill || e.sim.finished || e.born > 20 || (e.born > 0.5 && e.sim.count() === 0 && e.sequence !== currentName)) { e.sim.dispose(); live.splice(i, 1); } }
      for (const e of [...effects, ...live]) e.sim.render(camera, groupInverse);
    },
    // The rectangle the hero covers on screen (normalized device coordinates), with a small margin.
    screenBox(camera) {
      const s = new THREE.Box2();
      for (const [mesh, i] of samples) { mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).project(camera); s.expandByPoint(new THREE.Vector2(point.x, point.y)); }
      return s.expandByVector(s.getSize(new THREE.Vector2()).multiplyScalar(0.03));
    },
    // Puts a prismatic gem in a slot's item (a colour '#rrggbb', or null to take it out); its effects
    // start again in the gem's colour.
    gem(slot, hex) {
      if (hex) { const c = parseInt(hex.replace('#', ''), 16); gems.set(slot, { r: (c >> 16) & 255, g: (c >> 8) & 255, b: c & 255 }); } else gems.delete(slot);
      ambient(); gemTint();
    },
    get gems() { return Object.fromEntries([...gems].map(([slot, g]) => [slot, `#${((g.r << 16) | (g.g << 8) | g.b).toString(16).padStart(6, '0')}`])); },
    // An unusual effect on a slot's item (an id of its manifest's unusual list, or null to take it off).
    unusual(slot, id) { if (id == null) unusuals.delete(slot); else unusuals.set(slot, +id); ambient(); },
    kinetic(slot, activities) { if (activities?.length) kinetics.set(slot, activities); else kinetics.delete(slot); remodify(); },
    // The sequence playing now (an animation's, or the variant the worn items and gems pick).
    get sequence() { return currentName; },
    get unusuals() { return Object.fromEntries(unusuals); },
    // The meshes a slot wears now (for checks and tools).
    slotMeshes: (slot) => worn.get(slot)?.meshes || [],
    // What each slot wears: its item's id and style, or null for its default.
    get worn() { return Object.fromEntries([...worn].map(([slot, w]) => [slot, w.item ? { id: w.item, style: w.styleIndex } : null])); },
    // Puts an item on a slot — source: { manifest, url(path) } of an item folder, with the style's
    // index — or the slot's default back (source null). Resolves once it is on, textures loaded.
    async wear(slot, source, style = 0, current = () => true) {
      let record = defaults.get(slot) || { meshes: [], extra: [], localBones: [] }, m = null, s = null, key = null;
      if (source) {
        m = source.manifest; s = m.styles[style] || m.styles[0]; key = `${source.url('')}#${m.styles.indexOf(s)}`;
        record = wearing.get(key);
        if (!record) {
          const itemManager = new THREE.LoadingManager(), tex = textureOf(new THREE.TextureLoader(itemManager), source.url);
          const scenes = await Promise.all(s.models.map((n) => loader.loadAsync(source.url(m.models[n]))));
          const itemCube = cubeOf(source.url, itemManager);
          for (const [path, info] of Object.entries(m.fxModels || {})) { const file = source.url(info.file); propModels[file] ||= await loader.loadAsync(file); (manifest.fxModels ||= {})[path] ||= { file, clips: info.clips, materials: m.materials, texture: tex, cube: itemCube }; }
          lib.add({ systems: m.systems, snapshots: m.snapshots, textures: Object.fromEntries(Object.entries(m.textures || {}).map(([k, v]) => [k, { ...v, file: source.url(`fx/${v.file}`) }])) });
          scenes.forEach((sc, i) => dress(sc.scene, m.materials, tex, source.url(''), itemCube, m.skins?.[s.models[i]]?.[(s.skin || 0) - 1]));
          await new Promise((done) => { if (!itemManager.itemsTotal || itemManager.itemsLoaded >= itemManager.itemsTotal) done(); else { itemManager.onLoad = done; itemManager.onError = () => {}; } });
          let companion = null;
          if (s.companion) {
            const c = s.companion, gltf = await loader.loadAsync(source.url(m.models[c.model])), group = new THREE.Group(), mixer = new THREE.AnimationMixer(gltf.scene);
            dress(gltf.scene, m.materials, tex, source.url(''), itemCube); group.add(gltf.scene);
            group.position.set(...c.offset).applyMatrix4(SOURCE_TO_GLTF); group.scale.setScalar(c.scale || 1);
            const clip = gltf.animations.find((x) => x.name === c.clip) || gltf.animations[0]; if (clip) mixer.clipAction(clip).play();
            companion = { group, mixer };
          }
          // The models it refits other items into, ready for when one of them is worn too.
          const refits = await Promise.all((s.refits || []).map(async (r) => {
            if (!r.model) return { ...r, scene: null };
            const sc = (await loader.loadAsync(source.url(m.models[r.model]))).scene; dress(sc, m.materials, tex, source.url(''), itemCube); return { ...r, scene: sc,attachments:m.attachments?.[r.model] };
          }));
          record = { scenes, companion, refits, attachments: Object.assign({}, ...s.models.map((n) => m.attachments?.[n] || {})) };
          wearing.set(key, record);
        }
      }
      if (!current()) return;
      // Off with the old first: the new one's extra bones must not find the old one's by name.
      const old = worn.get(slot); if (old) takeOff(old);
      if (record.scenes && !record.meshes) { record.meshes = []; record.extra = []; record.localBones = []; for (const sc of record.scenes) { const w = fit(sc.scene,record.attachments); record.meshes.push(...w.meshes); record.extra.push(...w.extra); record.localBones.push(...w.localBones); } }
      const currentWear = { meshes: record.meshes, extra: record.extra, localBones: record.localBones, companion: record.companion, refits: record.refits || [], item: m ? m.id : null, style: s, styleIndex: m ? m.styles.indexOf(s) : 0, unusual: m?.unusual || null };
      putOn(currentWear);
      worn.set(slot, currentWear);
      attachments[slot] = m ? record.attachments : manifest.attachments?.[slot];
      refit(); ambient(); remodify(); reskin(); gemTint();
    },
    dispose() {
      studioDisposed = true; loaded['animation-source']?.scene.traverse(o=>{o.geometry?.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material])material?.dispose();}); for (const file of studioPropFiles) disposeProp(propModels[file]); studioPropFiles.clear();
      mixer.stopAllAction(); for (const p of props) p.mixer.stopAllAction(); turntable.traverse((o) => { o.geometry?.dispose(); });
      for (const r of wearing.values()) for (const mesh of r.meshes || []) mesh.geometry?.dispose();
      for (const w of defaults.values()) for (const mesh of w.meshes) mesh.geometry?.dispose();
      for (const m of materials.values()) m.dispose(); for (const t of made) t.dispose(); lib.dispose();
    },
  };
}
