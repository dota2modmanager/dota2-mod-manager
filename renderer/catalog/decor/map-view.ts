/* The game's whole map in the map windows: Rust's light copy of its world (map_scene.rs, decor:map),
 * lit as the game lights it (map-light.ts), drawn with three.js. Each material carries its path
 * (userData.vmat.Name), which is how a group's parts are found and hidden; the trees switch between
 * their own and the lightest of their kind or of the map (map-trees.ts); the weather is the game's. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { DecorGroup, DecorSample, GroundLayer } from '../../api/content.ts';
import { lightMap } from './map-light.ts';
import type { ZoneLight } from '../../api/decor.ts';
import { hiddenPart, mapTrees, stemOf, treeModelOf, type SideModels, type Trees } from './map-trees.ts';
import { mergeMeshesAsync } from './map-merge.ts';
import { compileInSteps } from './map-compile.ts';
import { mapWeather, type MapWeather } from './map-weather.ts';
import { keepOnGround, mapHeights, type Heights } from './map-heights.ts';
import { forgetGrounds, groundLight, isGround, paintGround, setGround } from './map-ground.ts';
import { mapKeys } from './map-keys.ts';
import { painter } from './map-paint.ts';
import type { TerrainPaint } from '../../api/decor.ts';
import { isWater, waterOf, waterTime } from './map-water.ts';

/** The game's own tree sets picked per side, and a catalog Trees mod. */
/** `mod`: a catalog Trees mod's models by the game tree each stands in for (map-trees.ts) */
export interface MapLooks { trees: SideModels; mod?: Record<string, string> }

/** The ground's look: another map's ground (its word) or null, and its polygons. */
export interface GroundLook { map: string | null; facets: 'small' | 'large' | null }

export interface MapView {
  /** the groups taken out (their parts hidden, the trees swapped) and the sets picked */
  show(removed: ReadonlySet<DecorGroup>, looks: MapLooks, ground: GroundLook): void;
  /** a catalog terrain that is a pak, on this map in place (map-paint.ts), or null for the map as it is */
  paint(p: TerrainPaint | null): void;
  /** the weather picked over the map (map-weather.ts), by its key, or none; the game's light for each (map-light.ts) */
  weather(key: string | null, lights?: Record<string, ZoneLight> | null): void;
  dispose(): void;
}

const TREE = /^materials\/models\/props_tree\//;

/** A material the game draws as nothing: the fog of war's shader. */
const isHidden = (m: THREE.Material): boolean => /dota_fow\.vfx/i.test(String((m.userData as { vmat?: { ShaderName?: string } }).vmat?.ShaderName ?? ''));

const vmatOf = (m: THREE.Material): string => String((m.userData as { vmat?: { Name?: string } }).vmat?.Name || '').toLowerCase();

async function loadGlb(map: string | null): Promise<GLTF> {
  const bytes = await window.api.decor.map(map ?? undefined);
  if (!bytes) throw new Error('no map');
  // the map's geometry comes in meshoptimizer's codecs (EXT_meshopt_compression, map_scene.rs)
  // the bytes as they came when they are a buffer of their own: a copy of seventy megabytes otherwise
  const own = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(own as ArrayBuffer, '');
}

function prepare(mat: THREE.Material): void {
  mat.side = THREE.DoubleSide;
  const m = mat as THREE.MeshStandardMaterial;
  // leaves and grass are cards with holes: cut where the picture is clear, so they sort right
  if (m.map && m.transparent) { m.transparent = false; m.alphaTest = 0.4; }
  // a card seen from its back faces away from the light and draws black: some of its own colour
  // as glow keeps a leaf a leaf from either side, as the game's foliage shader does
  if (m.map && m.alphaTest > 0 && 'emissive' in m) {
    m.emissiveMap = m.map;
    // in the leaf's own colour: a white picture tinted green (the low-poly terrains' foliage) glowed white
    m.emissive = m.color.clone().multiplyScalar(0.3);
  }
}

/** `map`: another of the game's maps to draw (a terrain's: "winter"), or null for the default one. */
export async function mountMapView(host: HTMLElement, samples: Partial<Record<DecorGroup, DecorSample>>, map: string | null,
  onProgress: (text: string | null, failed?: boolean) => void): Promise<MapView> {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // a map of five million triangles at twice the pixels is a slideshow: one and a half is enough
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x1b222b);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const light = lightMap(renderer, scene);
  const paints = painter(isGround);
  // the pak picked, put on once the map has loaded; the ground's layers it brought
  let paintWanted: TerrainPaint | null = null;
  let paintGrounds: Record<string, GroundLayer[]> | null = null;
  let loaded = false;
  const repaint = () => {
    if (!loaded) return;
    const want = paintWanted;
    void paints.paint(want).then((g) => {
      if (paintWanted !== want) return;
      paintGrounds = g;
      groundShown = null;
      apply();
    });
  };
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.screenSpacePanning = false;
  // the wheel goes to what is under the mouse: down onto a tavern's stair, not the air over the middle
  controls.zoomToCursor = true;

  // The map stands still: a frame is drawn only when the camera moved or something switched, and
  // the shadows (a second pass over the whole map) are drawn again only when something switched.
  renderer.shadowMap.autoUpdate = false;
  let dirty = true;
  const changed = () => { dirty = true; renderer.shadowMap.needsUpdate = true; };
  controls.addEventListener('change', () => { dirty = true; });
  const size = () => {
    const w = host.clientWidth || 800, h = host.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  size();
  const resize = new ResizeObserver(size);
  resize.observe(host);
  let box: THREE.Box3 | null = null;
  const keys = mapKeys(camera, controls, () => box);
  const clock = new THREE.Clock();
  // the water's waves run while there is water to see: then every frame is drawn (the shadows stay as they are)
  let water = false;
  // the weather, made once the map's size is known; the ground's heights, the map's width
  let weather: MapWeather | null = null, weatherWanted: string | null = null, heights: Heights | null = null, mapReach = 1;
  renderer.setAnimationLoop(() => {
    if (keys.step(clock.getDelta())) dirty = true;
    controls.update();
    if (water) { waterTime.value = clock.elapsedTime; dirty = true; }
    if (weather?.tick(clock.elapsedTime, controls.target, renderer.domElement.height, camera)) dirty = true;
    if (light.tick(clock.elapsedTime) || keepOnGround(heights, camera, controls.target, mapReach)) dirty = true;
    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
  });

  let disposed = false;
  let byGroup = new Map<string, THREE.Mesh[]>();
  let trees: Trees | null = null;
  let removed: ReadonlySet<DecorGroup> = new Set();
  let looks: MapLooks = { trees: {} };
  // another map's ground, asked for once per map and kept for the window
  let ground: GroundLook = { map: null, facets: null };
  let groundShown: string | null = null;
  const groundsAsked = new Map<string, Promise<Record<string, GroundLayer[]> | null>>();
  // the pictures: another map's, this map's in polygons, or both
  const showGround = () => {
    // a terrain's own ground comes before polygons of the map's
    if (paintGrounds) {
      if (groundShown !== 'paint') { groundShown = 'paint'; void setGround(paintGrounds, changed); }
      return;
    }
    const key = `${ground.map ?? ''}|${ground.facets ?? ''}`;
    if (key === groundShown) return;
    groundShown = key;
    if (key === '|') { void setGround(null, changed); return; }
    let asked = groundsAsked.get(key);
    if (!asked) {
      onProgress(ground.facets ? L`Режу землю на полигоны` : L`Достаю землю с другой карты`);
      asked = window.api.decor.ground(ground.map ?? '', ground.facets ?? undefined).then((r) => r?.materials ?? null, () => null);
      groundsAsked.set(key, asked);
    }
    void asked.then((m) => { onProgress(null); if (groundShown === key) void setGround(m, changed); });
  };

  const apply = () => {
    for (const [g, list] of byGroup) for (const m of list) m.visible = !removed.has(g as DecorGroup);
    trees?.show('own', looks.trees, looks.mod);
    if (trees) showGround();
    // the ground in the dusk or the dark, by the factor the build writes into the game (map_optimize.rs)
    groundLight.value = removed.has('dark') ? 0.4 : removed.has('dusk') ? 0.65 : 1;
    // and Dota's own light lower with it: the sun and the sky (map_optimize.rs LIGHT_DUSK, LIGHT_DARK)
    light.dim(removed.has('dark') ? 0.5 : removed.has('dusk') ? 0.75 : 1);
    changed();
  };

  onProgress(L`Готовлю карту. В первый раз это до минуты`);
  void (async () => {
    const ready = await window.api.decor.scene(map ?? undefined).catch(() => null);
    if (disposed) return;
    if (!ready?.ready) { onProgress(ready && !ready.tool ? L`Для 3D-карты нужны инструменты Source 2: их можно скачать в настройках` : L`Не удалось выгрузить карту`, true); return; }
    onProgress(L`Загружаю карту`);
    const gltf = await loadGlb(map).catch(() => null);
    const world = gltf?.scene ?? null;
    if (disposed) return;
    if (!world) { onProgress(L`Не удалось загрузить карту`, true); return; }
    const owner = new Map<string, DecorGroup>();
    for (const [g, s] of Object.entries(samples) as [DecorGroup, DecorSample][]) for (const m of s.materials ?? []) owner.set(m.toLowerCase(), g);
    const treeMeshes: THREE.Mesh[] = [];
    const rest: THREE.Mesh[] = [];
    const gone: THREE.Mesh[] = [];
    scene.add(world);
    world.updateMatrixWorld(true);
    // one each, so what takes them still merges into a few draws
    const plain = {
      tree: new THREE.MeshStandardMaterial({ color: 0x2c4a1e, roughness: 1, metalness: 0 }),
      rest: new THREE.MeshStandardMaterial({ color: 0x5a554c, roughness: 1, metalness: 0 }),
    };
    world.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // a tree's stump and close-up copy come along with it, and the game shows neither standing
      if (hiddenPart(mesh.name) || hiddenPart(mesh.parent?.name ?? '')) { gone.push(mesh); return; }
      // what wears the fog of war's shader draws nothing in the game: it is how a terrain of the
      // catalog takes rocks, flowers and leaves away (Mossy Cobblestone, Bedrock, Dark Terrain)
      if ([mesh.material].flat().every(isHidden)) { gone.push(mesh); return; }
      // the game's water flows and shines: a material of its own instead of the export's flat one
      if (!Array.isArray(mesh.material) && isWater(mesh.material)) {
        mesh.material = waterOf(mesh.material);
        mesh.castShadow = false;
        water = true;
      }
      // a part whose material the toolchain could not read comes with none, and three draws it white
      // (a low-poly terrain's trees): a tree's green or a neutral grey in its place
      const isTree = !!(treeModelOf(mesh.name) ?? treeModelOf(mesh.parent?.name ?? ''));
      if (!Array.isArray(mesh.material) && !vmatOf(mesh.material)) {
        mesh.material = isTree ? plain.tree : plain.rest;
      }
      const mats = [mesh.material].flat();
      mats.forEach(prepare);
      // the water keeps the window's own (map-water.ts): a pak's flat picture of it would be a grey sheet
      mats.filter((x) => !isWater(x)).forEach((x) => paints.add(x));
      if (isTree || mats.map(vmatOf).some((n) => TREE.test(n))) treeMeshes.push(mesh);
      else rest.push(mesh);
    });
    for (const m of gone) { m.geometry.dispose(); m.removeFromParent(); }
    // the ground's layers blended as the game paints them: the paths are a layer of their own
    const grounds = new Set<THREE.MeshStandardMaterial>();
    for (const m of rest) for (const x of [m.material].flat()) if (isGround(x)) grounds.add(x as THREE.MeshStandardMaterial);
    // once every ground is painted, another map's ground (if one is picked) goes over them all
    void Promise.all([...grounds].map((g) => paintGround(g, gltf!.parser, changed))).then(() => { groundShown = null; apply(); });
    // the map's box before its meshes leave the tree the toolchain gave them
    box = new THREE.Box3().setFromObject(world);
    // everything else as one mesh per material and per group a slider takes away
    const groupOf = (m: THREE.Mesh) => [m.material].flat().map((x) => owner.get(vmatOf(x))).find(Boolean) ?? '';
    light.fit(box);
    // the camera over the map, from the south and above, as a player sees it
    const centre = box.getCenter(new THREE.Vector3());
    const span = box.getSize(new THREE.Vector3());
    const reach = (mapReach = Math.max(span.x, span.z));
    weather = mapWeather(scene, reach);
    weather.set(weatherWanted);
    controls.target.copy(centre);
    camera.position.set(centre.x, centre.y + reach * 0.75, centre.z + reach * 0.55);
    camera.near = reach / 40000; // close enough to read a tavern's steps
    camera.far = reach * 6;
    camera.updateProjectionMatrix();
    controls.maxDistance = reach * 2;
    controls.minDistance = reach / 20000;
    const kind = new Map((samples.treesSimple?.swaps ?? []).map(([from, to]) => [stemOf(from), to]));
    // the rest and the trees merged side by side, in workers, the window free meanwhile
    onProgress(L`Собираю карту`);
    const [merged, t] = await Promise.all([
      mergeMeshesAsync(rest, groupOf, scene),
      mapTrees(scene, treeMeshes, kind, samples.trees?.after, centre, prepare, changed),
    ]);
    if (disposed) return;
    // the ground's heights for the weather (no trees: the rain falls through them)
    weather?.ground((heights = mapHeights(renderer, scene, [...merged.values()].flat(), box)));
    byGroup = merged;
    byGroup.delete('');
    trees = t;
    // what is left of the toolchain's node tree holds no mesh now
    world.removeFromParent();
    // the shaders compiled a few at a time before the first frame, which held the window a second
    await compileInSteps(renderer, scene, camera).catch(() => undefined);
    if (disposed) return;
    onProgress(null);
    loaded = true;
    if (paintWanted) repaint();
    else apply();
  })();

  return {
    show(next, nextLooks, nextGround) { removed = next; looks = nextLooks; ground = nextGround; apply(); },
    paint(p) { if (p === paintWanted) return; paintWanted = p; repaint(); },
    weather(key, lights) {
      light.weather(key ? lights?.[key] ?? null : null, lights?.plain ?? null);
      if (key !== weatherWanted) { weatherWanted = key; weather?.set(key); } changed(); },
    dispose() {
      disposed = true;
      weather?.dispose();
      keys.dispose();
      forgetGrounds();
      renderer.setAnimationLoop(null);
      resize.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const mat of [mesh.material].flat()) { (mat as THREE.MeshStandardMaterial).map?.dispose(); mat.dispose(); }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
