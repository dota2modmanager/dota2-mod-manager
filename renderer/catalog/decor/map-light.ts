/* The Optimization window's map lit as Dota lights its own, by the game's world shader
 * (global_lit_simple.vfx, read from shaders_pc_dir.vpk) and the light of the map's zone
 * (ent_dota_lightinfo in default_ents, map_build.rs weather_lights):
 *
 *   sun   = saturate(N · -lightDir) × shadow
 *   light = sun × colour × light_scale
 *         + saturate(N · ambientDir) × ambient_colour × ambient_scale
 *         + (1 - sun) × mix(shadow_secondary_colour, shadow_colour, N.up × 0.5 + 0.5) × shadow_scale
 *   pixel = albedo × light
 *
 * Colours are the zone's sRGB numbers in linear light, directions its pitch and yaw. A weather is
 * its own zone's numbers, the dark and the dusk the same light turned down. Without the shadows
 * the trees float and the river has no banks: they are what makes the map read. */
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

/** The Radiant forest's everyday zone, for a game whose map could not be read. */
const RADIANT: ZoneLight = {
  color_day: [216, 208, 207], light_scale_day: 5, light_direction_day: [66, 0, 0],
  ambient_color_day: [63, 144, 169], ambient_scale_day: 5, ambient_direction_day: [0, 23, 0],
  shadow_color_day: [230, 175, 177], shadow_secondary_color_day: [230, 175, 177], shadow_scale_day: 1, shadow_ground_scale_day: 1,
  fog_color_day: [149, 239, 255], fog_start_day: 1250, fog_end_day: 4500,
};

/** A zone's colour (0-255, sRGB) in linear light, times its scale. */
const linear = (c: number[] | undefined, scale = 1): THREE.Color =>
  new THREE.Color().setRGB(...((c ?? [0, 0, 0]).slice(0, 3).map((v) => v / 255) as [number, number, number]), THREE.SRGBColorSpace).multiplyScalar(scale);

/** A Source angle (pitch, yaw) as the way it points, in the window's axes: the map's export turns
 * Source's x, y, z (east, north, up) into three's z, x, y. */
function pointing(a: number[] | undefined): THREE.Vector3 {
  const [p, y] = (a ?? [90, 0]).map(THREE.MathUtils.degToRad);
  const x = Math.cos(p) * Math.cos(y), n = Math.cos(p) * Math.sin(y), up = -Math.sin(p);
  return new THREE.Vector3(n, up, x).normalize();
}

/** The game's light for every material of the map, shared: one change reaches them all. */
const lit = {
  uSunDir: { value: pointing(RADIANT.light_direction_day) },
  uSun: { value: new THREE.Color() },
  uAmbientDir: { value: pointing(RADIANT.ambient_direction_day) },
  uAmbient: { value: new THREE.Color() },
  uShadeUp: { value: new THREE.Color() },
  uShadeDown: { value: new THREE.Color() },
};

/** The game's world light in a standard material's shader, in place of three's: its shadows kept. */
export function litShader(sh: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(sh.uniforms, lit);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir, uSun, uAmbientDir, uAmbient, uShadeUp, uShadeDown;')
    .replace('#include <opaque_fragment>', `{
      float shade = 1.0;
      #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      shade = receiveShadow ? getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity,
        directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
      #endif
      vec3 n = inverseTransformDirection( normal, viewMatrix );
      float sun = saturate( dot( n, -uSunDir ) ) * shade;
      vec3 light = sun * uSun + saturate( dot( n, uAmbientDir ) ) * uAmbient + ( 1.0 - sun ) * mix( uShadeDown, uShadeUp, n.y * 0.5 + 0.5 );
      outgoingLight = diffuseColor.rgb * light + totalEmissiveRadiance;
    }
    #include <opaque_fragment>`);
}

/** A zone's colour over the everyday one's, channel by channel, kept within reason: for the fog. */
function ratio(a: number[] | undefined, b: number[] | undefined): THREE.Color {
  if (!a || !b) return new THREE.Color(1, 1, 1);
  const c = (i: number) => Math.min(1.8, Math.max(0.35, (a[i] + 8) / (b[i] + 8)));
  return new THREE.Color(c(0), c(1), c(2));
}
const share = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined || b <= 0 ? 1 : a / b);

export function lightMap(renderer: THREE.WebGLRenderer, scene: THREE.Scene): MapLight {
  // the game's light runs well over one: a tonemap that keeps colours and bends the bright ones
  // down rather than to white
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // three's own lights stay for the shadows and for the water, which keeps its own look (map-water.ts)
  const skyColor = new THREE.Color(0xa9c1e0);
  const sky = new THREE.HemisphereLight(skyColor, 0x3a3128, 1.25);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const cool = new THREE.Color(0xb8c8ff);
  const fogColor = new THREE.Color(0x1b222b);
  const centre = new THREE.Vector3();
  let k = 1;
  let reach = 1;
  let zone: ZoneLight = RADIANT;
  let fog = { color: new THREE.Color(1, 1, 1), k: 1 };
  let flash = 0;
  let nextFlash = 0;
  const apply = () => {
    const z = zone;
    const bright = k * (1 + flash);
    // the dark map: the sun falls and the light left turns bluer, as the game's night
    lit.uSun.value.copy(linear(z.color_day, z.light_scale_day ?? 5)).lerp(cool, (1 - k) * 0.5).multiplyScalar(bright);
    lit.uAmbient.value.copy(linear(z.ambient_color_day, z.ambient_scale_day ?? 5)).multiplyScalar(0.4 + 0.6 * k);
    lit.uShadeUp.value.copy(linear(z.shadow_color_day, z.shadow_scale_day ?? 1)).multiplyScalar(0.4 + 0.6 * k);
    lit.uShadeDown.value.copy(linear(z.shadow_secondary_color_day ?? z.shadow_color_day, z.shadow_ground_scale_day ?? z.shadow_scale_day ?? 1)).multiplyScalar(0.4 + 0.6 * k);
    lit.uSunDir.value.copy(pointing(z.light_direction_day));
    lit.uAmbientDir.value.copy(pointing(z.ambient_direction_day));
    sun.intensity = 3.4 * bright;
    sky.intensity = 1.25 * (0.4 + 0.6 * k);
    // the shadows fall the way the zone's sun shines
    sun.position.copy(centre).addScaledVector(lit.uSunDir.value, -reach);
    sun.target.position.copy(centre);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(fogColor).multiply(fog.color);
      scene.fog.near = reach * 1.1 * fog.k;
      scene.fog.far = reach * 3 * fog.k;
    }
  };
  const later = (time: number) => {
    const [lo, hi] = [zone.lightning_period_min ?? 0, zone.lightning_period_max ?? 0];
    return time + lo + Math.random() * Math.max(0, hi - lo);
  };
  return {
    dim(next) { k = next; apply(); },
    weather(look, plain) {
      zone = look ?? plain ?? RADIANT;
      fog = look && plain
        ? { color: ratio(look.fog_color_day, plain.fog_color_day), k: Math.min(1.5, Math.max(0.35, share(look.fog_end_day, plain.fog_end_day))) }
        : { color: new THREE.Color(1, 1, 1), k: 1 };
      flash = 0;
      nextFlash = 0;
      apply();
    },
    tick(time) {
      const strength = zone.lightning_intensity_max ?? 0;
      if (strength <= 0 || (zone.lightning_period_max ?? 0) <= 0) return false;
      if (!nextFlash) nextFlash = later(time);
      const was = flash;
      // a flash: up at once, down over a few frames
      if (time >= nextFlash) { flash = Math.min(2, strength); nextFlash = later(time); }
      else flash = Math.max(0, flash - 0.05);
      if (flash !== was) apply();
      return flash !== was;
    },
    fit(box) {
      box.getCenter(centre);
      const size = box.getSize(new THREE.Vector3());
      reach = Math.max(size.x, size.z);
      const cam = sun.shadow.camera;
      cam.left = -reach * 0.62; cam.right = reach * 0.62; cam.top = reach * 0.62; cam.bottom = -reach * 0.62;
      cam.near = reach * 0.05; cam.far = reach * 2.5;
      cam.updateProjectionMatrix();
      scene.fog = new THREE.Fog(fogColor, reach * 1.1, reach * 3);
      apply();
    },
  };
}
