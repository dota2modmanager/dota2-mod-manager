/* The Optimization window's map lit as Dota lights its own: a warm sun high from the north-west
 * (the top left of the player's screen) casting shadows, a cool sky and a dark earth for the
 * light around, the colours through a neutral tonemap that keeps them, and a haze far off. Without the
 * shadows the trees float and the river has no banks: they are what makes the map read.
 *
 * A weather changes the light as the game's own zone for it does (map_build.rs weather_lights, the
 * same zone the build writes into the map): the sun's colour and strength, the light around, the
 * fog's colour and how near it comes, and lightning where the zone has it, each as the weather's
 * zone stands to the everyday one, over the window's own light. */
import * as THREE from 'three';
import type { ZoneLight } from '../../api/decor.ts';

export interface MapLight {
  /** sun and shadows set over the map's box */
  fit(box: THREE.Box3): void;
  /** the sun and the sky's light at this share of the game's, a little bluer as it falls (the dark map) */
  dim(k: number): void;
  /** a weather's zone over the everyday one, or none */
  weather(look: ZoneLight | null, plain: ZoneLight | null): void;
  /** a frame: whether the light changed (lightning) */
  tick(time: number): boolean;
}

/** A zone's colour (0-255, sRGB) over the everyday one's, channel by channel, kept within reason. */
function ratio(a: number[] | undefined, b: number[] | undefined): THREE.Color {
  if (!a || !b) return new THREE.Color(1, 1, 1);
  const c = (i: number) => Math.min(1.8, Math.max(0.35, (a[i] + 8) / (b[i] + 8)));
  return new THREE.Color(c(0), c(1), c(2));
}
const share = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined || b <= 0 ? 1 : a / b);

interface Shares { sun: THREE.Color; sunK: number; sky: THREE.Color; skyK: number; fog: THREE.Color; fogK: number; lightning: number; period: [number, number] }
const NONE = (): Shares => ({ sun: new THREE.Color(1, 1, 1), sunK: 1, sky: new THREE.Color(1, 1, 1), skyK: 1, fog: new THREE.Color(1, 1, 1), fogK: 1, lightning: 0, period: [0, 0] });

/** What a weather's zone does to the light, as shares of the everyday zone's. */
function shares(look: ZoneLight, plain: ZoneLight): Shares {
  // no light around in the zone (the rain's) is the sky's light at a little under half, not none:
  // the window has no other light to fill the shadows
  const around = share(look.ambient_scale_day, plain.ambient_scale_day);
  return {
    sun: ratio(look.color_day, plain.color_day),
    sunK: Math.min(1.6, Math.max(0.4, share(look.light_scale_day, plain.light_scale_day))),
    sky: ratio(look.ambient_color_day, plain.ambient_color_day),
    skyK: 0.45 + 0.55 * Math.min(1.5, around),
    fog: ratio(look.fog_color_day, plain.fog_color_day),
    fogK: Math.min(1.5, Math.max(0.35, share(look.fog_end_day, plain.fog_end_day))),
    lightning: look.lightning_intensity_max ?? 0,
    period: [look.lightning_period_min ?? 0, look.lightning_period_max ?? 0],
  };
}

export function lightMap(renderer: THREE.WebGLRenderer, scene: THREE.Scene): MapLight {
  // a tonemap that keeps colours and bends the bright ones down rather than to white: the game's
  // own maps are dark-pictured, a low-poly terrain is light grey and burned out under ACES
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const skyColor = new THREE.Color(0xa9c1e0);
  const sky = new THREE.HemisphereLight(skyColor, 0x3a3128, 1.25);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const warm = new THREE.Color(0xfff0d2);
  const cool = new THREE.Color(0xb8c8ff);
  const fogColor = new THREE.Color(0x1b222b);
  let k = 1;
  let reach = 1;
  let w = NONE();
  let flash = 0;
  let nextFlash = 0;
  const apply = () => {
    sun.intensity = 3.4 * k * w.sunK * (1 + flash);
    sky.intensity = 1.25 * (0.4 + 0.6 * k) * w.skyK * (1 + flash * 0.5);
    sun.color.copy(warm).lerp(cool, 1 - k).multiply(w.sun);
    sky.color.copy(skyColor).multiply(w.sky);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(fogColor).multiply(w.fog);
      scene.fog.near = reach * 1.1 * w.fogK;
      scene.fog.far = reach * 3 * w.fogK;
    }
  };
  const later = (time: number) => time + w.period[0] + Math.random() * Math.max(0, w.period[1] - w.period[0]);
  return {
    dim(next) { k = next; apply(); },
    weather(look, plain) {
      w = look && plain ? shares(look, plain) : NONE();
      flash = 0;
      nextFlash = 0;
      apply();
    },
    tick(time) {
      if (w.lightning <= 0 || w.period[1] <= 0) return false;
      if (!nextFlash) nextFlash = later(time);
      const was = flash;
      // a flash: up at once, down over a few frames
      if (time >= nextFlash) { flash = Math.min(2, w.lightning); nextFlash = later(time); }
      else flash = Math.max(0, flash - 0.05);
      if (flash !== was) apply();
      return flash !== was;
    },
    fit(box) {
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      reach = Math.max(size.x, size.z);
      // from the north-west and high: the game's own sun lays shadows down and to the right
      sun.position.copy(centre).add(new THREE.Vector3(-0.45, 1, -0.35).normalize().multiplyScalar(reach));
      sun.target.position.copy(centre);
      const cam = sun.shadow.camera;
      cam.left = -reach * 0.62; cam.right = reach * 0.62; cam.top = reach * 0.62; cam.bottom = -reach * 0.62;
      cam.near = reach * 0.05; cam.far = reach * 2.5;
      cam.updateProjectionMatrix();
      scene.fog = new THREE.Fog(fogColor, reach * 1.1, reach * 3);
      apply();
    },
  };
}
