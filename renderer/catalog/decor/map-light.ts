/* The Optimization window's map lit as Dota lights its own, by the game's world shader
 * (global_lit_simple.vfx, read from shaders_pc_dir.vpk) and the light of the map's zone
 * (ent_dota_lightinfo in default_ents, map_build.rs weather_lights):
 *
 *   sun   = saturate(N · -lightDir) × shadow × clouds
 *   open  = 1 - the ambient occlusion (map-ao.ts)
 *   light = sun × colour × light_scale × (0.45 + 0.55 × open^1.85)
 *         + open^2.1 × 1.5 × (saturate(N · ambientDir) × ambient_colour × ambient_scale × mix(1, shadow × clouds, ambient_shadow_amount)
 *                             + (1 - sun) × mix(shadow_secondary_colour, shadow_colour, N.up × 0.5 + 0.5) × shadow_scale)
 *         + Σ small lights: saturate(N · toward it) × smoothstep(saturate((1 - distance / radius) / (1 - start_falloff))) × colour × intensity
 *   pixel = mix(albedo × light, fog colour, min(pow(saturate((distance - start) / (end - start)), exponent), max))
 *
 * as the game's deferred passes do it (deferred_global_light.vfx, deferred_post_process.vfx, read
 * 2026-11-25): the clouds are the global light's picture (env_global_light), cast down the sun's
 * way onto the ground in two layers that drift, the darker of the two; the fog is the fog
 * controller's, counted from where the game's camera would stand, so the map seen from afar is
 * not lost in it. Then the game's tonemap. The small lights are the map's lamps and braziers
 * (env_deferred_light_client_only, deferred_local_light.vfx read the same day): the window takes
 * the LOCAL nearest the middle of the view. Their reach is short (a lamp's 128 inches from 270 up
 * barely touches the ground). client.dll packs each for deferred_local_light_cs (0x1817ec240, from
 * the entity's keys at 0x18180bff0): its colour as the bytes / 255, not linearised, times its
 * intensity; start_falloff, which no light on the map sets, is 0.5.
 *
 * Day turns to night as the game's clock does (client.dll's light manager, read 2026-11-25): five
 * minutes of each, the game starting by day, and each pair of a zone's numbers blended as
 * day × f + night × (1 - f), f going to 1 by day and 0 by night at dota_tod_transition_speed (1 a
 * second). Its slower twin (dota_tod_slow_transition_speed, 0.2) moves only the fog's height and
 * the fog of war, which the window does not draw.
 *
 * Colours are the zone's sRGB numbers in linear light, directions its pitch and yaw. A weather is
 * its own zone's numbers, the dark and the dusk the same light turned down. Without the shadows
 * the trees float and the river has no banks: they are what makes the map read. */
import * as THREE from 'three';
import type { ZoneLight, ZonePlace } from '../../api/decor.ts';
import { blendZones, shares } from './map-zones.ts';

export interface MapLight {
  /** sun and shadows set over the map's box */
  fit(box: THREE.Box3): void;
  /** the sun and the sky's light at this share of the game's, a little bluer as it falls (the dark map) */
  dim(k: number): void;
  /** a weather's zone over the everyday one, or none */
  weather(look: ZoneLight | null, plain: ZoneLight | null): void;
  /** the clouds' picture (the map's light copy has it, map_scene.rs), or none */
  clouds(picture: THREE.Texture | null): void;
  /** a frame, the camera where it is: whether the light changed (lightning, the clouds drifting, day turning to night) */
  tick(time: number, camera: THREE.Camera, target: THREE.Vector3): boolean;
  /** whether the sun moved since last asked (day turning to night): the shadows are drawn again */
  sunMoved(): boolean;
}

/** The Radiant forest's everyday zone, for a game whose map could not be read. */
const RADIANT: ZoneLight = {
  color_day: [216, 208, 207], light_scale_day: 5, light_direction_day: [66, 0, 0],
  ambient_color_day: [63, 144, 169], ambient_scale_day: 5, ambient_direction_day: [0, 23, 0],
  shadow_color_day: [230, 175, 177], shadow_secondary_color_day: [230, 175, 177], shadow_scale_day: 1, shadow_ground_scale_day: 1,
  fog_color_day: [149, 239, 255], fog_start_day: 1250, fog_end_day: 4500,
};

/** The game's day and night, each this many seconds (DOTA_DAY_LENGTH: five minutes of each). */
export const DAY_SECONDS = 300;
/** How fast the light turns from day to night and back: dota_tod_transition_speed, a share a second. */
const TURN_SPEED = 1;

/** Whether it is day at this many seconds into the game, which starts by day. */
export const isDay = (time: number): boolean => Math.floor(time / DAY_SECONDS) % 2 === 0;

/** A zone's day number and its night one, blended as the game does at f (1 the day, 0 the night). */
function blend(day: number | undefined, night: number | undefined, f: number): number | undefined;
function blend(day: number[] | undefined, night: number[] | undefined, f: number): number[] | undefined;
function blend(day: number | number[] | undefined, night: number | number[] | undefined, f: number): number | number[] | undefined {
  if (day === undefined || night === undefined || f >= 1) return day ?? night;
  if (typeof day === 'number') return typeof night === 'number' ? day * f + night * (1 - f) : day;
  return Array.isArray(night) ? day.map((v, i) => v * f + (night[i] ?? v) * (1 - f)) : day;
}

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

/** The game's light for every material of the map, shared: one change reaches them all (the water reads it too). */
export const lit = {
  uSunDir: { value: pointing(RADIANT.light_direction_day) },
  uSun: { value: new THREE.Color() },
  uAmbientDir: { value: pointing(RADIANT.ambient_direction_day) },
  uAmbient: { value: new THREE.Color() },
  uShadeUp: { value: new THREE.Color() },
  uShadeDown: { value: new THREE.Color() },
  /** the zone's shadow colour as it stands, without its scale (m_AmbientColor2): the river's murk takes it */
  uShade: { value: new THREE.Color() },
  uAmbientShadow: { value: 0 },
  /** the zone's specular colour (linear) and how little of it the sun's colour takes (0: all) */
  uSpecColor: { value: new THREE.Color() },
  uSpecIndependence: { value: 0 },
  /** where the zone's shine comes from (the window's axes) and how tight it is */
  uSpecDir: { value: pointing([64, 283, 0]) },
  uSpecPow: { value: 28 },
  uClouds: { value: null as THREE.Texture | null },
  uCloudOn: { value: 0 },
  /** 1 while the bed under the water is drawn: the game's refraction pass lights it with the sun, its shadows and
   * the clouds', but without the occlusion, small lights, shine or fog (a frame of the game, 2026-11-26) */
  uPlain: { value: 0 },
  uCloudScale: { value: 1 },
  uCloudOffset: { value: new THREE.Vector4() },
  uFogColor: { value: new THREE.Color() },
  /** start, end, exponent, the most it covers; in metres */
  uFog: { value: new THREE.Vector4(1e9, 2e9, 1, 0) },
  /** how much farther than the game's the camera stands, taken off the fog's distance */
  uFogFrom: { value: 0 },
  /** the small lights near the view: where (metres) and how far each reaches, its colour × intensity (linear) */
  uLocalAt: { value: Array.from({ length: 48 }, () => new THREE.Vector4()) },
  uLocalColour: { value: Array.from({ length: 48 }, () => new THREE.Color()) },
  uLocalCount: { value: 0 },
  /** the map's ambient occlusion (map-ao.ts) at half the screen's size, whether there is one, a screen pixel */
  uAO: { value: null as THREE.Texture | null },
  uAOOn: { value: 0 },
  uAOPixel: { value: new THREE.Vector2(1, 1) },
  /** 1 while map-ao.ts draws the map's depth: a material stops once its pixel is known to be there */
  uAOPass: { value: 0 },
};
/** How many of the map's small lights the shader takes at once. */
const LOCAL = 48;

/** A Source inch in the window's metres (the map's export). */
export const INCH = 0.0254;
/** How far south of the point it looks at the game's camera stands, in inches: its distance (dota_camera_distance 1134) × cos 60°. */
const CAMERA_BACK = 567;
/** What the game gives the world's sky and shadow light over the zone's scales (its global light
 * buffer in four frames read in RenderDoc: an ambient scale of 5 came out 7.5 everywhere, the Dire's
 * shadow scale of 2 came out 3; the heroes' own copy of the shadow's keeps the zone's number). */
const WORLD_SHADE = 1.5;
/** How far the game's camera stands from what it looks at, in metres. */
const GAME_CAMERA = 1200 * INCH;

/** The game's world light in a standard material's shader, in place of three's: its shadows kept.
 * `overlay`: an overlay's (map-view.ts), which keeps its alpha in the river's bed pass. */
export function litShader(sh: THREE.WebGLProgramParametersWithUniforms, overlay = false): void {
  Object.assign(sh.uniforms, lit);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLitWorld;')
    .replace('#include <project_vertex>', `#include <project_vertex>
    {
      vec4 at = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
      at = batchingMatrix * at;
      #endif
      #ifdef USE_INSTANCING
      at = instanceMatrix * at;
      #endif
      vLitWorld = ( modelMatrix * at ).xyz;
    }`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
    uniform vec3 uSunDir, uSun, uAmbientDir, uAmbient, uShadeUp, uShadeDown, uFogColor, uSpecColor, uSpecDir;
    uniform float uSpecIndependence, uSpecPow;
    uniform float uAmbientShadow, uCloudOn, uCloudScale, uFogFrom, uPlain, uAOOn, uAOPass;
    uniform sampler2D uAO;
    uniform vec2 uAOPixel;
    uniform vec4 uLocalAt[ ${LOCAL} ];
    uniform vec3 uLocalColour[ ${LOCAL} ];
    uniform int uLocalCount;
    #define START_FALLOFF 0.5
    uniform vec4 uCloudOffset, uFog;
    uniform sampler2D uClouds;
    varying vec3 vLitWorld;`)
    .replace('#include <opaque_fragment>', `{
      if ( uAOPass > 0.5 ) { gl_FragColor = vec4( 0.0 ); return; }
      float shade = 1.0;
      #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      shade = receiveShadow ? getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity,
        directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
      #endif
      // the clouds, in the game's axes (the export turned Source's x, y, z into z, x, y). The game
      // shifts them along the sun by the point's y, not its height (multiblend and props alike,
      // RenderDoc 2026-11-27: mad cb2[0].xyxy, v0.yyyy, v0.xyxy), which shears each cloud into
      // the long diagonal streaks its ground shows
      if ( uCloudOn > 0.5 ) {
        vec3 p = vLitWorld.zxy, l = uSunDir.zxy;
        vec4 uv = ( p.xy + l.xy * p.y ).xyxy / uCloudScale + uCloudOffset;
        shade *= saturate( min( texture2D( uClouds, uv.xy ).r, texture2D( uClouds, uv.zw ).g ) );
      }
      vec3 n = inverseTransformDirection( normal, viewMatrix );
      float sun = saturate( dot( n, -uSunDir ) ) * shade;
      // the occlusion takes the sky's and the shadow's light and part of the sun's (deferred_global_light.vfx)
      float open = 1.0 - ( uAOOn > 0.5 && uPlain < 0.5 ? texture2D( uAO, gl_FragCoord.xy * uAOPixel ).r : 0.0 );
      vec3 light = sun * uSun * ( 0.45 + 0.55 * pow( open, 1.85 ) ) + pow( open, 2.1 ) * ( saturate( dot( n, uAmbientDir ) ) * uAmbient * ( 1.0 + uAmbientShadow * ( shade - 1.0 ) )
        + ( 1.0 - sun ) * mix( uShadeDown, uShadeUp, n.y * 0.5 + 0.5 ) );
      for ( int i = 0; i < ${LOCAL}; i++ ) {
        if ( i >= uLocalCount || uPlain > 0.5 ) break;
        vec3 to = uLocalAt[ i ].xyz - vLitWorld;
        float far = length( to ), reach = saturate( ( uLocalAt[ i ].w - far ) / uLocalAt[ i ].w / ( 1.0 - START_FALLOFF ) );
        light += saturate( dot( n, to / max( far, 1e-4 ) ) ) * reach * reach * ( 3.0 - 2.0 * reach ) * uLocalColour[ i ];
      }
      // the shine of a prop with a specular picture (map-spec.ts), as global_lit_simple.vfx lays it:
      // light × (albedo + (1 - independence) × shine) + independence × shine
      vec3 shine = vec3( 0.0 );
      #if defined( MM_SPECULAR ) && defined( USE_MAP )
      {
        // the game's constant is the zone's direction turned around: read as it stands, every flat
        // stair and banner at mid shone cyan where the game's own frame (dota-bench, 2026-11-26) is dark
        vec3 e = normalize( cameraPosition - vLitWorld );
        shine = pow( saturate( dot( -uSpecDir, reflect( e, n ) ) ), uSpecPow ) * texture2D( uSpecMap, vMapUv ).r * uSpecIntensity
          * uSpecColor * ( 1.0 - uPlain );
      }
      #endif
      float alone = saturate( uSpecIndependence );
      outgoingLight = ( diffuseColor.rgb + ( 1.0 - alone ) * shine ) * light + alone * shine + totalEmissiveRadiance;
      float far = max( distance( vLitWorld, cameraPosition ) - uFogFrom, 0.0 );
      float fog = min( pow( saturate( ( far - uFog.x ) / max( uFog.y - uFog.x, 1e-3 ) ), uFog.z ), uFog.w );
      #ifdef MM_GLOW
      // a glow adds its light: the fog takes it away rather than painting it (gls_glow.asm)
      diffuseColor.a *= 1.0 - fog * ( 1.0 - uPlain );
      #else
      outgoingLight = mix( outgoingLight, uFogColor, fog * ( 1.0 - uPlain ) );
      #endif
    }
    #include <opaque_fragment>
    // in the river's bed pass the alpha is the water fog only overlays add to (map-water.ts):
    // the game's bed writes its own depth there, which the water here reads from the depth instead
    ${overlay ? '' : 'if ( uPlain > 0.5 ) gl_FragColor.a = 0.0;'}`)
    // the fog is the game's, above, laid before the tonemap as the game lays it
    .replace('#include <fog_fragment>', '');
}

/**
 * The game's tonemap, from its post-process pass (deferred_post_process.vfx with D_TONEMAP, read
 * from the shader's bytecode 2026-11-25): a curve that keeps the darks and mid-tones near where they
 * are (0.18 comes out 0.16) and runs anything over about 0.85 to white.
 */
const GAME_TONEMAP = `vec3 CustomToneMapping( vec3 color ) {
  color *= toneMappingExposure;
  vec3 x = 0.6 * color;
  return saturate( x * ( color * 9.48 + 2.12 ) / ( x * ( color * 0.72 + 5.92 ) + 1.9 ) );
}`;
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment
  .replace('vec3 CustomToneMapping( vec3 color ) { return color; }', GAME_TONEMAP);

/** A zone's colour over the everyday one's, channel by channel, kept within reason: for the fog. */
function ratio(a: number[] | undefined, b: number[] | undefined): THREE.Color {
  if (!a || !b) return new THREE.Color(1, 1, 1);
  const c = (i: number) => Math.min(1.8, Math.max(0.35, (a[i] + 8) / (b[i] + 8)));
  return new THREE.Color(c(0), c(1), c(2));
}
const share = (a: number | undefined, b: number | undefined) => (a === undefined || b === undefined || b <= 0 ? 1 : a / b);

export function lightMap(renderer: THREE.WebGLRenderer, scene: THREE.Scene): MapLight {
  // the game's own tonemap over its light
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // three's own lights stay for the shadows (the sun) and for what draws outside the game's shader
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
  // the look's own light and its zones (map-zones.ts), each zone's share where the view looked last
  let base: ZoneLight = RADIANT, places: ZonePlace[] = [], weights: number[] = [];
  const looked = new THREE.Vector3(Infinity, 0, 0);
  const lookAt = (target: THREE.Vector3): boolean => {
    looked.copy(target);
    // the window's x, z are Source's y, x (map-light.ts pointing); the game weighs the zones where
    // its camera stands, south of the point it looks at (a frame of the game read in RenderDoc)
    const w = shares(places, target.z / INCH, target.x / INCH - CAMERA_BACK);
    if (w.length === weights.length && w.every((v, i) => Math.abs(v - weights[i]) < 0.01)) return false;
    weights = w;
    zone = blendZones(base, places, w);
    return true;
  };
  let fog = { color: new THREE.Color(1, 1, 1), k: 1 };
  let flash = 0;
  let nextFlash = 0;
  // the day's share of the light (1 the day, 0 the night), the frame it was moved at, and whether the sun moved
  let f = 1, last = 0, sunMoved = false;
  // the map's small lights in the window's axes: [x, y, z, reach] in metres and colour × intensity;
  // which of them the shader has, and where the view's middle was when it got them
  let locals: { at: THREE.Vector4; colour: THREE.Color }[] = [];
  const picked = new THREE.Vector3(Infinity, 0, 0);
  const pick = (target: THREE.Vector3) => {
    picked.copy(target);
    const near = locals
      .map((l) => ({ l, d: Math.hypot(l.at.x - target.x, l.at.z - target.z) - l.at.w }))
      .sort((a, b) => a.d - b.d).slice(0, LOCAL);
    near.forEach(({ l }, i) => { lit.uLocalAt.value[i].copy(l.at); lit.uLocalColour.value[i].copy(l.colour); });
    lit.uLocalCount.value = near.length;
  };
  const apply = () => {
    const at = zone;
    const z: ZoneLight = {
      ...at,
      color_day: blend(at.color_day, at.color_night, f), light_scale_day: blend(at.light_scale_day, at.light_scale_night, f),
      light_direction_day: blend(at.light_direction_day, at.light_direction_night, f),
      ambient_color_day: blend(at.ambient_color_day, at.ambient_color_night, f), ambient_scale_day: blend(at.ambient_scale_day, at.ambient_scale_night, f),
      ambient_direction_day: blend(at.ambient_direction_day, at.ambient_direction_night, f),
      shadow_color_day: blend(at.shadow_color_day, at.shadow_color_night, f),
      shadow_secondary_color_day: blend(at.shadow_secondary_color_day, at.shadow_secondary_color_night, f),
      shadow_scale_day: blend(at.shadow_scale_day, at.shadow_scale_night, f),
      shadow_ground_scale_day: blend(at.shadow_ground_scale_day, at.shadow_ground_scale_night, f),
      fog_color_day: blend(at.fog_color_day, at.fog_color_night, f),
      fog_start_day: blend(at.fog_start_day, at.fog_start_night, f), fog_end_day: blend(at.fog_end_day, at.fog_end_night, f),
      specular_color_day: blend(at.specular_color_day, at.specular_color_night, f),
      specular_independence_day: blend(at.specular_independence_day, at.specular_independence_night, f),
      specular_direction_day: blend(at.specular_direction_day, at.specular_direction_night, f),
      specular_power_day: blend(at.specular_power_day, at.specular_power_night, f),
    };
    const bright = k * (1 + flash);
    // the dark map: the sun falls and the light left turns bluer, as the game's night
    lit.uSun.value.copy(linear(z.color_day, z.light_scale_day ?? 5)).lerp(cool, (1 - k) * 0.5).multiplyScalar(bright);
    lit.uAmbient.value.copy(linear(z.ambient_color_day, z.ambient_scale_day ?? 5)).multiplyScalar((0.4 + 0.6 * k) * WORLD_SHADE);
    lit.uShadeUp.value.copy(linear(z.shadow_color_day, z.shadow_scale_day ?? 1)).multiplyScalar((0.4 + 0.6 * k) * WORLD_SHADE);
    lit.uShadeDown.value.copy(linear(z.shadow_secondary_color_day ?? z.shadow_color_day, z.shadow_ground_scale_day ?? z.shadow_scale_day ?? 1)).multiplyScalar((0.4 + 0.6 * k) * WORLD_SHADE);
    lit.uShade.value.copy(linear(z.shadow_color_day)).multiplyScalar(0.4 + 0.6 * k);
    lit.uSunDir.value.copy(pointing(z.light_direction_day));
    lit.uAmbientDir.value.copy(pointing(z.ambient_direction_day));
    lit.uAmbientShadow.value = z.ambient_shadow_amount ?? 0;
    lit.uSpecColor.value.copy(linear(z.specular_color_day ?? [81, 196, 232]));
    lit.uSpecIndependence.value = z.specular_independence_day ?? 0;
    lit.uSpecDir.value.copy(pointing(z.specular_direction_day ?? [64, 283, 0]));
    // a zone's power of -1 is the map's (env_global_light specularpower)
    const power = z.specular_power_day ?? -1;
    lit.uSpecPow.value = power > 0 ? power : (z.global_specular_power ?? 28);
    lit.uFogColor.value.copy(linear(z.fog_color_day ?? RADIANT.fog_color_day)).multiplyScalar(0.4 + 0.6 * k);
    lit.uFog.value.set((z.fog_start_day ?? 1250) * INCH, (z.fog_end_day ?? 4500) * INCH, z.fog_exponent ?? 2, z.fog_max_density ?? 1);
    lit.uCloudScale.value = (z.cloud_scale ?? 6500) * INCH;
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
      base = zone = look ?? plain ?? RADIANT;
      places = base.zones ?? [];
      weights = [];
      if (Number.isFinite(looked.x)) lookAt(looked);
      locals = (plain?.local_lights ?? []).filter((l) => l.length >= 8).map((l) => ({
        at: new THREE.Vector4(l[1] * INCH, l[2] * INCH, l[0] * INCH, l[7] * INCH),
        colour: new THREE.Color(l[3] / 255, l[4] / 255, l[5] / 255).multiplyScalar(l[6]),
      }));
      picked.set(Infinity, 0, 0);
      fog = look && plain
        ? { color: ratio(look.fog_color_day, plain.fog_color_day), k: Math.min(1.5, Math.max(0.35, share(look.fog_end_day, plain.fog_end_day))) }
        : { color: new THREE.Color(1, 1, 1), k: 1 };
      flash = 0;
      nextFlash = 0;
      apply();
    },
    clouds(picture) {
      if (picture) {
        picture.wrapS = picture.wrapT = THREE.RepeatWrapping;
        picture.colorSpace = THREE.NoColorSpace;
        picture.needsUpdate = true;
      }
      lit.uClouds.value = picture;
      lit.uCloudOn.value = picture ? 1 : 0;
    },
    sunMoved() { const was = sunMoved; sunMoved = false; return was; },
    tick(time, camera, target) {
      // day turning to night and back: the share walks to its end at the game's speed
      const goal = isDay(time) ? 1 : 0, step = Math.max(0, time - last) * TURN_SPEED;
      last = time;
      let turned = false;
      if (f !== goal) {
        f = goal > f ? Math.min(goal, f + step) : Math.max(goal, f - step);
        sunMoved = turned = true;
        apply();
      }
      lit.uFogFrom.value = Math.max(0, camera.position.distanceTo(target) - GAME_CAMERA);
      // the small lights nearest the view's middle, chosen again once it moved a few metres
      if (picked.distanceTo(target) > 4) pick(target);
      // the zones' light where the view looks, blended again once it moved a few metres
      let moved = false;
      if (places.length && looked.distanceTo(target) > 2 && lookAt(target)) { apply(); moved = true; }
      // each layer of clouds drifts its own way at its own speed, in pictures a second
      const drift = (dir: number[] | undefined, speed: number | undefined): [number, number] => {
        const yaw = THREE.MathUtils.degToRad(dir?.[1] ?? 0), d = -((speed ?? 0) * time) / (zone.cloud_scale ?? 6500);
        return [Math.cos(yaw) * d, Math.sin(yaw) * d];
      };
      lit.uCloudOffset.value.set(...drift(zone.cloud1_direction, zone.cloud1_speed), ...drift(zone.cloud2_direction, zone.cloud2_speed));
      const clouds = lit.uCloudOn.value > 0;
      const strength = zone.lightning_intensity_max ?? 0;
      if (strength <= 0 || (zone.lightning_period_max ?? 0) <= 0) return clouds || turned || moved;
      if (!nextFlash) nextFlash = later(time);
      const was = flash;
      // a flash: up at once, down over a few frames
      if (time >= nextFlash) { flash = Math.min(2, strength); nextFlash = later(time); }
      else flash = Math.max(0, flash - 0.05);
      if (flash !== was) apply();
      return clouds || turned || moved || flash !== was;
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
