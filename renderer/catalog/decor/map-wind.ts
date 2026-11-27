/* The map's trees, bushes and flags swaying as the game sways them: global_lit_simple.vfx under
 * F_ENABLE_WIND, its vertex shader read from the game's bytecode 2026-11-25, and the frame's wind
 * from worldrenderer.dll (the r_world_wind_* convars and the code that hands them to the shader).
 *
 *   p      = where the vertex stands, Source inches (x, y); h = how high it is in its own model
 *   mask   = g_tWindMask at the vertex's UV: red the slow sway it takes, green the quick (a trunk none)
 *   a      = (2 p × frequency + offset.xy, offset.z), offset = (0.25, 0.3, 0.2) × seconds
 *   w      = smooth triangle waves of speed × (0.125, 0.25, 1, 1.5) × (a, a.x + a.y + a.z)
 *   w     *= mask.xxyy × saturate(noise(p / 8192 + 0.007 offset.x).x) × flexibility × (low, low, high, high)
 *            (low and high are the material's, × 0.5 and × 0.05: SLOW_SCALE, QUICK_SCALE)
 *   move   = (w.x + w.y) × strength × wind × h + (w.z + w.w) × strength × max(h, 128) × normalize(wind + gust)
 *
 * where gust = (noise(p / 256).xy × 2 - 1) × 2, wind is r_world_wind_dir (45°), strength is
 * r_world_wind_strength / 100 (0.4; the quick sway's is the same, at least
 * r_dota_wind_min_high_freq_strength / 100) and frequency r_world_wind_frequency_trees (0.003).
 * In the game's own frames the strength and the wind's turn move with time (0.23 at 37°, 0.36 at
 * 31°), the quick sway's staying at least 0.25; the window keeps the convars' still wind.
 * The slow sway bends a tree by its height, the quick one shakes its leaves. The move is in the
 * world; a copy placed by a matrix takes it back through the matrix's turn.
 *
 * The shadows stay as they were drawn: the game sways them too, but redrawing the map's shadows
 * every frame is a second map a frame. */
import * as THREE from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { INCH } from './map-light.ts';

/** The seconds the wind has blown, shared by every swaying material. */
export const windTime = { value: 0 };

interface VmatOfWind { IntParams?: Record<string, number>; FloatParams?: Record<string, number>; VectorParams?: Record<string, number[]> }
const vmatOf = (m: THREE.Material) => (m.userData as { vmat?: VmatOfWind }).vmat;

/** Whether a material sways in the wind (its shader's F_ENABLE_WIND). */
export const isWindy = (m: THREE.Material): boolean => vmatOf(m)?.IntParams?.F_ENABLE_WIND === 1;

/** A one-pixel picture of these bytes: what a material sways by until its own picture is in. */
const pixel = (r: number, g: number) => {
  const t = new THREE.DataTexture(new Uint8Array([r, g, 0, 255]), 1, 1);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
};
// every part sways fully, and the noise sits at its middle (no gusts) without a picture of its own
const ALL = pixel(255, 255);
const CALM = pixel(128, 128);

/** The wind of the frame (worldrenderer.dll's defaults; the shader's g_vWind*). */
const wind = {
  // strength, the grass's frequency (unused by trees), the trees' frequency, the quick sway's strength
  uWindStrength: { value: new THREE.Vector4(0.4, 0, 0.003, Math.max(0.4, 25 / 100)) },
  uWindDir: { value: new THREE.Vector3(0.707, 0.707, 0).normalize() },
  uWindSpeed: { value: new THREE.Vector3(0.25, 0.3, 0.2) },
  uWindTime: windTime,
};

/** What the game makes of a material's g_flWindLowFrequencyEffects and g_flWindHighFrequencyEffects
 * before its shader sees them: read from the shader's constants in two of the game's frames
 * (RenderDoc, 2026-11-27), every swaying material of the map there: a tree's 1 and 1 come as 0.5
 * and 0.05, the lily pads' 2 and 2.5 as 1 and 0.125, a banner's 0 and 2 as 0 and 0.1. Taken as
 * they stand, the lily pads shook into blades and the leaves shivered twenty times too far. */
const SLOW_SCALE = 0.5;
const QUICK_SCALE = 0.05;

const own = new WeakMap<THREE.Material, { uWindMask: { value: THREE.Texture }; uWindNoise: { value: THREE.Texture }; uWindMaterial: { value: THREE.Vector4 }; uWindUv: { value: THREE.Vector4 } }>();

/** A swaying material's own numbers: its pictures (flat until loaded) and its vmat's wind. */
function uniformsOf(m: THREE.Material) {
  let u = own.get(m);
  if (u) return u;
  const f = vmatOf(m)?.FloatParams ?? {}, v = vmatOf(m)?.VectorParams ?? {};
  const scale = v.g_vTexCoordScale ?? [1, 1], offset = v.g_vTexCoordOffset ?? [0, 0];
  u = {
    uWindMask: { value: ALL },
    uWindNoise: { value: CALM },
    // flexibility, slow, quick, speed: the shader's defaults where the material says nothing, the
    // slow and quick as the game hands them to the shader (SLOW_SCALE, QUICK_SCALE)
    uWindMaterial: { value: new THREE.Vector4(f.g_flWindFlexibility ?? 0.3, (f.g_flWindLowFrequencyEffects ?? 1) * SLOW_SCALE,
      (f.g_flWindHighFrequencyEffects ?? 1) * QUICK_SCALE, f.g_flWindSpeedMultiplier ?? 1) },
    uWindUv: { value: new THREE.Vector4(scale[0] ?? 1, scale[1] ?? 1, offset[0] ?? 0, offset[1] ?? 0) },
  };
  own.set(m, u);
  return u;
}

const PARS = `
uniform sampler2D uWindMask, uWindNoise;
uniform vec4 uWindStrength, uWindMaterial, uWindUv;
uniform vec3 uWindDir, uWindSpeed;
uniform float uWindTime;
attribute float windZ;
vec4 windWave( vec4 x ) { vec4 g = fract( fract( x ) * 2.0 - 0.5 ) * 2.0 - 1.0; return g * g * ( 3.0 - 2.0 * abs( g ) ); }`;

const SWAY = `
{
  mat4 place = modelMatrix;
  #ifdef USE_INSTANCING
  place = place * instanceMatrix;
  float h = position.y / ${INCH};
  #else
  float h = windZ;
  #endif
  // the game's axes: the export turned Source's x, y, z into three's z, x, y
  vec2 p = ( place * vec4( transformed, 1.0 ) ).zx / ${INCH};
  vec3 offset = uWindSpeed * uWindTime;
  vec2 mask = texture2D( uWindMask, uv * uWindUv.xy + uWindUv.zw ).xy;
  vec2 gust = ( texture2D( uWindNoise, p / 256.0 ).xy * 2.0 - 1.0 ) * 2.0;
  vec3 a = vec3( 2.0 * p * uWindStrength.z, 0.0 ) + offset;
  vec4 w = windWave( uWindMaterial.w * vec4( 0.125, 0.25, 1.0, 1.5 ) * vec4( a, a.x + a.y + a.z ) );
  float n = saturate( texture2D( uWindNoise, p / 8192.0 + offset.x * 0.007 ).x );
  w *= mask.xxyy * n * uWindMaterial.x * uWindMaterial.yyzz;
  float slow = ( w.x + w.y ) * uWindStrength.x, quick = ( w.z + w.w ) * uWindStrength.w;
  vec3 move = slow * uWindDir * h + quick * max( h, 128.0 ) * normalize( uWindDir + vec3( gust, 0.0 ) );
  transformed += inverse( mat3( place ) ) * ( move.yzx * ${INCH} );
}`;

/** Teach a swaying material's shader the game's wind, before the world's light is put in. */
export function windShader(sh: THREE.WebGLProgramParametersWithUniforms, m: THREE.Material): void {
  Object.assign(sh.uniforms, wind, uniformsOf(m));
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>${PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>${SWAY}`);
}

/** A swaying material of the map takes its wind mask and noise out of the map's file. */
export async function windPictures(m: THREE.Material, parser: GLTFParser): Promise<void> {
  const data = m.userData as { windMask?: number; windNoise?: number };
  const u = uniformsOf(m);
  const load = (i: number | undefined) =>
    i === undefined ? Promise.resolve(null) : (parser.getDependency('texture', i).catch(() => null) as Promise<THREE.Texture | null>);
  const [mask, noise] = await Promise.all([load(data.windMask), load(data.windNoise)]);
  for (const [t, slot] of [[mask, u.uWindMask], [noise, u.uWindNoise]] as const) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    slot.value = t;
  }
}
