/* The weather picked, shown over the map: the game's own system, played by the hero preview's
 * runtime (map-game-weather.ts), and while it loads or where it draws nothing a stand-in, a cloud
 * of points that follows the camera (snow drifting, rain, a sandstorm, ash with embers, spores,
 * leaves, petals, motes of light), every point's place worked out on the graphics card from its
 * seed and the time. The haze and the light are the game's zone's (map-light.ts). */
import * as THREE from 'three';
import { gameWeather, type GameWeather } from './map-game-weather.ts';
import type { Heights } from './map-heights.ts';
interface Look {
  color: number;
  /** a second colour some of the points take (embers in the ash, the aurora's violet) */
  other?: number;
  /** points in the cloud */
  count: number;
  /** size, in thousandths of the map's width */
  px: number;
  /** how solid a point is */
  alpha: number;
  /** drift per second, as a share of the cloud's size (y up) */
  vel: [number, number, number];
  /** how far a point sways from its line, as a share of the cloud */
  sway: number;
  /** drawn adding light (motes, embers) rather than over */
  glow?: boolean;
}

/** The game's weathers by the key the record keeps (map_decor.rs WEATHER_KEYS). */
const LOOKS: Record<string, Look> = {
  snow: { color: 0xffffff, count: 7000, px: 0.9, alpha: 0.85, vel: [0.01, -0.06, 0.004], sway: 0.012 },
  rain: { color: 0xb8d4ff, count: 9000, px: 0.5, alpha: 0.5, vel: [0.02, -0.55, 0.01], sway: 0 },
  moonbeam: { color: 0xbfd8ff, count: 2500, px: 0.8, alpha: 0.7, vel: [0, 0.015, 0], sway: 0.02, glow: true },
  pestilence: { color: 0x9be36a, count: 3500, px: 0.8, alpha: 0.6, vel: [0.004, 0.01, 0.003], sway: 0.02, glow: true },
  harvest: { color: 0xe08a2a, other: 0xc0461f, count: 2500, px: 1.2, alpha: 0.9, vel: [0.03, -0.05, 0.015], sway: 0.03 },
  sirocco: { color: 0xd8b072, count: 12000, px: 0.9, alpha: 0.3, vel: [0.35, -0.02, 0.1], sway: 0.01 },
  spring: { color: 0xffb6d5, other: 0xffffff, count: 2500, px: 1.1, alpha: 0.9, vel: [0.02, -0.04, 0.01], sway: 0.03 },
  ash: { color: 0x8a8a8a, other: 0xff7a2a, count: 6000, px: 0.8, alpha: 0.7, vel: [0.01, -0.03, 0.005], sway: 0.015 },
  aurora: { color: 0x7dffc0, other: 0xb47dff, count: 2000, px: 1, alpha: 0.6, vel: [0, 0.01, 0], sway: 0.02, glow: true },
};

const VERT = `
attribute vec4 seed;
uniform float uTime;
uniform vec3 uCentre;
uniform vec3 uSize;
uniform vec3 uVel;
uniform float uSway;
uniform float uPx;
uniform float uProj;
varying float vOther;
varying float vFade;
void main() {
  // the point's place in the cloud: its seed moved by the time, wrapped round the cloud
  vec3 p = seed.xyz + uVel * uTime * (0.7 + 0.6 * seed.w);
  p += vec3(sin(uTime * 0.9 + seed.w * 40.0), 0.0, cos(uTime * 0.7 + seed.w * 30.0)) * uSway;
  p = fract(p) - 0.5;
  vec3 world = uCentre + p * uSize;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  // a size in the world, through the camera's projection, kept to a few pixels up close
  gl_PointSize = clamp(uPx * uProj / max(-mv.z, 0.001), 1.0, 14.0);
  vOther = step(0.75, fract(seed.w * 7.31));
  // thinning out at the cloud's edges, so its box does not show
  vec3 e = abs(p) * 2.0;
  vFade = 1.0 - smoothstep(0.7, 1.0, max(e.x, max(e.y, e.z)));
}`;

const FRAG = `
uniform vec3 uColor;
uniform vec3 uOther;
uniform float uAlpha;
varying float vOther;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = (1.0 - d * 4.0) * vFade * uAlpha;
  gl_FragColor = vec4(mix(uColor, uOther, vOther), a);
}`;

export interface MapWeather {
  /** the weather by its key, or none */
  set(key: string | null): void;
  /** a frame: the weather over the camera's target; whether a weather is on (frames keep coming) */
  tick(time: number, target: THREE.Vector3, viewHeight: number, camera: THREE.PerspectiveCamera): boolean;
  /** the ground's heights, once the map is put together: the game's weather waits for them */
  ground(heights: Heights): void;
  dispose(): void;
}

export function mapWeather(scene: THREE.Scene, reach: number): MapWeather {
  let points: THREE.Points | null = null;
  let uniforms: Record<string, THREE.IUniform> | null = null;
  // the game's system for the weather on, and which pick it was made for (a later pick drops it)
  let game: GameWeather | null = null;
  let asked = 0;
  let last = -1;
  // the map exported in the game's inches, or in metres as the hero preview's scene is
  const inches = reach > 3000;
  let lookOn: Look | null = null;
  const dropGame = () => { game?.dispose(); game = null; };
  let heights: Heights | null = null;
  let gotHeights: (h: Heights) => void = () => {};
  const heightsReady = new Promise<Heights>((resolve) => { gotHeights = resolve; });
  const drop = () => {
    if (!points) return;
    scene.remove(points);
    points.geometry.dispose();
    (points.material as THREE.Material).dispose();
    points = null;
    uniforms = null;
  };
  /** the stand-in cloud of points, for a weather whose system did not come */
  const cloud = (look: Look) => {
    const seeds = new Float32Array(look.count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    // a position for three's bounds; the shader places the points itself
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(look.count * 3), 3));
    uniforms = {
      uTime: { value: 0 },
      uCentre: { value: new THREE.Vector3() },
      uSize: { value: new THREE.Vector3(reach * 0.32, reach * 0.12, reach * 0.32) },
      uVel: { value: new THREE.Vector3(...look.vel) },
      uSway: { value: look.sway },
      uPx: { value: look.px * reach * 0.001 },
      uProj: { value: 600 },
      uAlpha: { value: look.alpha },
      uColor: { value: new THREE.Color(look.color) },
      uOther: { value: new THREE.Color(look.other ?? look.color) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false,
      blending: look.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 10;
    scene.add(points);
  };
  return {
    set(key) {
      drop();
      dropGame();
      const ask = ++asked;
      const look = key ? LOOKS[key] : undefined;
      lookOn = look ?? null;
      if (look) cloud(look);
      if (!key) return;
      void heightsReady.then((h) => (ask === asked ? gameWeather(scene, key, inches, h) : null)).then((g) => {
        if (ask !== asked) { g?.dispose(); return; }
        if (!g) return;
        game = g;
        // the game's own in place of the stand-in
        drop();
        if (g.warnings.length) console.warn(`map weather: resource diagnostics: ${g.warnings.join('; ')}`);
      }, (e: unknown) => console.warn("map weather: the game's system did not load", e));
    },
    tick(time, target, viewHeight, camera) {
      const dt = last < 0 ? 0 : Math.max(0, time - last);
      last = time;
      if (game) {
        game.tick(dt, camera, target);
        // a system that drew nothing in its first seconds: the stand-in comes back
        if (!game.alive) {
          const was = asked;
          dropGame();
          console.warn("map weather: the game's system drew nothing; the stand-in is shown");
          if (was === asked && lookOn) cloud(lookOn);
        }
        return true;
      }
      const proj = viewHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
      if (!uniforms) return false;
      uniforms.uTime.value = time;
      uniforms.uProj.value = proj;
      (uniforms.uCentre.value as THREE.Vector3).set(target.x, target.y + reach * 0.04, target.z);
      return true;
    },
    ground(h) { heights?.dispose(); heights = h; gotHeights(h); },
    dispose() { asked++; drop(); dropGame(); heights?.dispose(); heights = null; },
  };
}
