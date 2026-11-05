/* Where the hero stands in the 3D preview (issue #417), as the game's loadout stages it
 * (src/hero-showcase.ts): the loadout camera straight in front of the hero at the height of its
 * waist, looking level; the hero at its LoadoutScale on the pedestal its showcase names; its key
 * light and ambient from its showcase entry, the background its colour. The hero turns, not the
 * camera, so the light stays where the game keeps it.
 *
 * The game's panel is wide and the window's stage is narrow: where a hero (a mount, a long spear)
 * would not fit the stage's width from the game's spot, the camera steps back along its own line
 * until it does. */
import * as THREE from 'three';
import type { HeroLights } from './hero-material.ts';
import type { HeroStage } from '../../api/preview3d.ts';

/** The loadout camera's vertical angle. The game sets it in code; this frames a hero as its loadout does. */
export const LOADOUT_FOV = 20;

/** A stage for a hero whose game files say nothing: the camera and a light from the front. */
export const PLAIN_STAGE: HeroStage = {
  scale: 1, camera: [0, 2.03, 16.97], key: null, ambient: null, background: null, pedestal: null,
};

/**
 * How far from the hero's middle the camera must stand for the hero's width, as the camera sees
 * it, to fit a view of this shape with a margin; the depth is added because the near side is closer.
 * @param side  the camera's right in the world, flat
 */
export function widthDistance(size: { x: number; z: number }, aspect: number, fovDeg: number,
  side: { x: number; z: number } = { x: 1, z: 0 }, margin = 1.08): number {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const seen = Math.abs(size.x * side.x) + Math.abs(size.z * side.z);
  const deep = Math.abs(size.x * side.z) + Math.abs(size.z * side.x);
  return (seen / 2) * margin / (t * Math.max(aspect, 0.05)) + deep / 2;
}

const v3 = (a: [number, number, number] | null | undefined, d: [number, number, number]) => new THREE.Vector3(...(a || d)).normalize();
const rgb = (a: [number, number, number] | null | undefined, d: [number, number, number], k = 1) => new THREE.Color(...(a || d)).multiplyScalar(k);

/** The light directions in the world, toward each light; the hero faces +Z. */
export function worldLights(stage: HeroStage) {
  return { key: v3(stage.key?.from, [-0.38, 0.76, 0.52]), fill: v3(stage.ambient?.from, [0.8, 0.3, 0.5]) };
}

/** The rig the hero shader reads, coloured as the hero's showcase entry colours it. */
export function heroLights(stage: HeroStage): HeroLights {
  const ambient = rgb(stage.ambient?.color, [0.9, 1, 1]);
  const w = worldLights(stage);
  return {
    key: w.key.clone(), keyColor: rgb(stage.key?.color, [1.33, 1.38, 1.44], 1.25),
    fill: w.fill.clone(), fillColor: ambient.clone().multiplyScalar(0.35),
    up: new THREE.Vector3(0, 1, 0), sky: ambient.clone().multiplyScalar(0.22), ground: ambient.clone().multiplyScalar(0.06),
    rim: new THREE.Color(0.9, 0.95, 1.0),
  };
}

/** A soft round light pool on the floor, drawn once on a canvas. */
function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.12)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The lights three.js draws the other materials and the shadow with, and the floor that takes it.
 * @param box  the hero through its loadout, in the world
 */
export function buildStage(scene: THREE.Scene, box: THREE.Box3, stage: HeroStage, floorY = 0): void {
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const reach = Math.max(size.x, size.y, size.z);
  const w = worldLights(stage);
  const lights = heroLights(stage);

  const key = new THREE.DirectionalLight(lights.keyColor, 1.6);
  key.position.copy(centre).addScaledVector(w.key, reach * 2);
  key.target.position.copy(centre);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = reach * 0.002;
  key.shadow.radius = 4;
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -reach;
  cam.right = cam.top = reach;
  cam.near = reach * 0.1;
  cam.far = reach * 4;
  const fill = new THREE.DirectionalLight(lights.fillColor, 1);
  fill.position.copy(w.fill).multiplyScalar(reach);
  scene.add(key, key.target, fill, new THREE.HemisphereLight(lights.sky, lights.ground, 2));

  const radius = Math.max(size.x, size.z) * 0.9 + size.y * 0.25;
  const pool = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.15, 64),
    new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false }));
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.ShadowMaterial({ opacity: 0.55, depthWrite: false }));
  for (const m of [pool, shadow]) {
    m.rotation.x = -Math.PI / 2;
    m.position.set(centre.x, floorY + reach * 0.001, centre.z);
    m.receiveShadow = m === shadow;
    m.renderOrder = -1;
    scene.add(m);
  }
}

/** The background behind the hero as a CSS colour, its showcase's, or none for the stage's own. */
export function backdrop(stage: HeroStage): string | null {
  const c = stage.background;
  return c ? `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ')})` : null;
}
