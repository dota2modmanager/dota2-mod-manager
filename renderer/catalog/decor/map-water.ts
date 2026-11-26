/* The river of the Optimization window's map, drawn by the game's water shader (water_dota.vfx,
 * its forward pass read from the shader's bytecode 2026-11-25):
 *
 *   d      = how deep the water is under this pixel, a share of the fog range (FOG_RANGE, 16 inches)
 *   bed    = the map under the water, looked up a little off where the waves bend it
 *   colour = bed × mix(1, refraction tint, saturate(3.5 d))
 *   colour = mix(colour, water fog colour × the light it takes, d) + reflection (below)
 *   colour = saturate(colour + reflection colour × specular colour × sun × pow(saturate(R · reflection dir), power))
 *   pixel  = colour × the world's light on the waves' normal (map-light.ts, without shadows)
 *
 * d is what the map under the water writes into its alpha (multiblend's
 * D_WRITE_WATER_FOG_TO_DEST_ALPHA: saturate(dot(g_vClipPlane0, P) × g_flInvFogRange)), how far
 * below the water's plane it lies over the view's fog range (FOG_RANGE). The bed
 * is a pass of its own: the map drawn without its water into a picture with its depth (the game's
 * refraction map), done again only when the view moved or every few frames for the clouds' shadows.
 * The game lights that pass more plainly than the frame: the sun, the light around and the shadows'
 * colour, but no shadows, clouds, small lights or fog (map-light.ts uPlain).
 *
 * Then the reflection: the reflection map × g_vReflectionTint × the zone's fog colour × g_flReflectance,
 * where the water is deep (saturate(2d) × saturate(20(d - 0.05))); the picture is one grey here
 * (REFLECTION_GREY). With the zones blended (map-zones.ts) the Radiant's cyan fog and the Dire's red
 * one mix at mid into the game's grey-teal river.
 *
 * Not yet as the game: the fog's light is g_vWaterFogColor × mix(sun, AmbientColor2,
 * g_flWaterFogShadowFactor), AmbientColor2 being the zone light's m_AmbientColor2 (client.dll), the
 * shadows' colour; with the zone's pink shadow colour the river turns red, which the game's is not
 * (tried 2026-11-26 at three depths: off by 18 to 35 of 255), so something the game adds is missing,
 * likely the reflection map's picture; the zone's ambient colour without its scale is taken instead,
 * the closest of the tries to a frame of the game. Against a frame of the game the river's colour is
 * off by 5 of 255 (the turquoise sheet before: 25).
 *
 * The waves are the game's normal picture flowing (F_FLOW_NORMALS, read the same way 2026-11-26),
 * P the pixel's place in inches, (x, -y), and the flow one colour over the whole river (TextureFlow):
 *
 *   t        = time × flow time scale / (2 × interval) + noise(P × noise scale).g × noise strength
 *   phase k  = fract(t + ½ or t), its turn floor(...): picture at P / normal scale + turn × 0.311 (+ ½) + phase × flow × scroll
 *   n.xy     = (picture A × |2 phase B - 1|^exp + picture B × |2 phase A - 1|^exp) × 2 - 1, × (|flow|² + 0.1) × bump
 *
 * so each picture fades out as it is about to jump back, and the noise keeps the stretches of the
 * river from pulsing together. The material's scales are the shader's divisors (its 500 is a
 * picture 500 inches wide). */
import * as THREE from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { INCH, lit } from './map-light.ts';

/** The seconds the waves have run, shared by every water. */
export const waterTime = { value: 0 };

const vmatOf = (m: THREE.Material) => (m.userData as { vmat?: VmatOfWater }).vmat;
interface VmatOfWater {
  ShaderName?: string; IntParams?: Record<string, number>; FloatParams?: Record<string, number>;
  VectorParams?: Record<string, number[]>;
}

/** Whether a material is the game's water. */
export const isWater = (m: THREE.Material): boolean => /water/i.test(String(vmatOf(m)?.ShaderName ?? ''));

/** The map under the water, shared by every water: its picture, its depth, the size of a pixel. */
const bed = {
  uBed: { value: null as THREE.Texture | null },
  uBedDepth: { value: null as THREE.Texture | null },
  uPixel: { value: new THREE.Vector2(1, 1) },
  uNear: { value: 1 },
  uFar: { value: 5000 },
};

const made = new WeakMap<THREE.Material, THREE.ShaderMaterial>();
/** every water material made, to hide while the bed is drawn */
const waters = new Set<THREE.ShaderMaterial>();

/** A material colour of the game's (sRGB 0-1) in linear light. */
const colour = (v: number[] | undefined, or: [number, number, number]) =>
  new THREE.Color().setRGB(...((v ?? or).slice(0, 3) as [number, number, number]), THREE.SRGBColorSpace);

const VERTEX = `
varying vec3 vWorld;
void main() {
  vec4 at = modelMatrix * vec4( position, 1.0 );
  vWorld = at.xyz;
  gl_Position = projectionMatrix * viewMatrix * at;
}`;

/** A flat normal and a calm noise, until the water's own pictures are in. */
const pixel = (r: number, g: number, b: number) => {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
};
/** How deep the water turns fully to its fog colour, in inches: g_flInvFogRange is the view's, not the
 * material's g_flWaterDepth (35), and with 35 the river bed showed through as a turquoise sheet. 16 is
 * what matches a frame of the game at mid, where the river is 16 inches deep (the bed at 0, the water
 * at 16): there the bed is lost, as in the game, and shows only at the banks. */
const FOG_RANGE = 16;
/** The reflection map's picture, which the window has no copy of, as one grey: fitted to the same
 * frame (the river's colour off by 5 of 255; with no reflection the deep river was black). */
const REFLECTION_GREY = 0.08;

const FLAT = pixel(128, 128, 255);
const CALM = pixel(0, 0, 0);

const FRAGMENT = `
#define AMBIENT_SCALE 5.0
uniform sampler2D uNormal, uNoise;
uniform vec2 uFlow;
uniform vec4 uFlowNums, uWaveNums;
uniform vec3 uSunDir, uSun, uAmbientDir, uAmbient, uShadeUp, uShadeDown, uSpecColor;
uniform float uSpecIndependence;
uniform sampler2D uBed, uBedDepth;
uniform vec2 uPixel;
uniform float uNear, uFar, uTime;
uniform vec3 uRefractionTint, uWaterFog, uReflectionColor, uReflectionDir, uReflectionTint, uFogColor;
uniform float uRefractionAmount, uReflectionPower, uBaseBloom, uDepth, uForceFog, uReflectance, uReflectionGrey;
uniform vec2 uForceFogRange;
varying vec3 vWorld;

float eyeDepth( float z ) { return uNear * uFar / ( uFar - z * ( uFar - uNear ) ); }

void main() {
  // the game's axes: the export turned Source's x, y, z into three's z, x, y
  vec3 p = vWorld.zxy, eye = cameraPosition.zxy;
  // the waves: the normal picture flowing (uFlowNums: bump, time scale, interval, scroll;
  // uWaveNums: noise scale, noise strength, normal scale, the fade's power)
  vec2 at = vec2( p.x, -p.y ) / ${INCH};
  vec2 scroll = uFlow * uFlowNums.w;
  float t = uFlowNums.y * uTime / ( 2.0 * uFlowNums.z ) + texture2D( uNoise, at * uWaveNums.x ).y * uWaveNums.y;
  vec2 base = at * uWaveNums.z;
  float a = t + 0.5, fa = fract( a ), fb = fract( t );
  vec2 pa = texture2D( uNormal, base + floor( a ) * 0.311 + 0.5 + fa * scroll ).xy;
  vec2 pb = texture2D( uNormal, base + floor( t ) * 0.311 + fb * scroll ).xy;
  vec2 bend = ( pb * pow( abs( 2.0 * fa - 1.0 ), uWaveNums.w ) + pa * pow( abs( 2.0 * fb - 1.0 ), uWaveNums.w ) ) * 2.0 - 1.0;
  bend *= ( dot( uFlow, uFlow ) + 0.1 ) * uFlowNums.x;
  if ( dot( bend, bend ) > 1.0 ) bend = normalize( bend );
  vec3 n = vec3( bend, sqrt( max( 1.0 - dot( bend, bend ), 0.0 ) ) );

  // how deep: where the bed lies below the water's plane, a share of the material's depth
  vec2 uv = gl_FragCoord.xy * uPixel;
  float surface = eyeDepth( gl_FragCoord.z ), under = eyeDepth( texture2D( uBedDepth, uv ).x );
  vec3 ray = p - eye;
  float dist = length( ray );
  vec3 below = eye + ray * ( under / max( surface, 1e-3 ) );
  float d = saturate( ( p.z - below.z ) / uDepth );
  if ( uForceFog > 0.5 ) d = mix( uForceFogRange.x, uForceFogRange.y, d );

  // the bed, bent by the waves as far as the water is deep and the camera near (1120: the game's number)
  vec2 off = n.xy * d * uRefractionAmount * 1120.0 / ( dist / ${INCH} );
  vec3 c = texture2D( uBed, clamp( uv - off * vec2( 1.0, -1.0 ), 0.0, 1.0 ) ).rgb;
  c = mix( c, c * uRefractionTint, saturate( 3.5 * d ) );
  c = mix( c, uWaterFog * uAmbient / AMBIENT_SCALE, d );
  // the reflection map × g_vReflectionTint × the zone's fog colour × g_flReflectance, where the water
  // is deep enough; the map's picture is taken as one grey (uReflectionGrey)
  c += saturate( 2.0 * d ) * saturate( ( d - 0.05 ) * 20.0 ) * uReflectance * uReflectionGrey * uReflectionTint * uFogColor;

  // the sun's shine on the waves, as the game's water takes it
  vec3 v = normalize( ray );
  vec3 r = 2.0 * dot( v, n ) * n - v;
  // the material's direction turned around, as the props' shine (map-light.ts): read as it stands,
  // the waves at mid streaked bright where the game's water is smooth
  float shine = pow( saturate( dot( -uReflectionDir, r ) ), uReflectionPower );
  vec3 shineColour = mix( uReflectionColor * uSpecColor * uSun, uReflectionColor * uSpecColor, saturate( uSpecIndependence ) );
  c = saturate( c + shineColour * shine );

  // the world's light on the waves (map-light.ts), without the shadows
  vec3 sunDir = uSunDir.zxy, ambientDir = uAmbientDir.zxy;
  float sun = saturate( dot( -sunDir, n ) );
  vec3 light = sun * uSun + saturate( dot( ambientDir, n ) ) * uAmbient + ( 1.0 - sun ) * mix( uShadeDown, uShadeUp, n.z * 0.5 + 0.5 );
  gl_FragColor = vec4( mix( c * light, c, saturate( uBaseBloom ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The water material that draws in place of the export's flat one (one per original). */
export function waterOf(original: THREE.Material): THREE.ShaderMaterial {
  const had = made.get(original);
  if (had) return had;
  const v = vmatOf(original) ?? {};
  const f = v.FloatParams ?? {}, vec = v.VectorParams ?? {};
  const dir = vec.g_vReflectionDir ?? [-0.256, -1, 0.349];
  const flow = vec.TextureFlow ?? [0.5, 0.5];
  // the material's scales are its pictures' sizes: the shader takes one over each
  const per = (x: number | undefined, or: number) => 1 / (x || or);
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...lit,
      ...bed,
      uTime: waterTime,
      uRefractionTint: { value: colour(vec.g_vRefractionTint, [0.349, 0.663, 0.78]) },
      uWaterFog: { value: colour(vec.g_vWaterFogColor, [0.259, 0.137, 0.051]) },
      uReflectionColor: { value: colour(vec.g_vReflectionColor, [0.231, 0.231, 0.231]) },
      uReflectionDir: { value: new THREE.Vector3(dir[0], dir[1], dir[2]) },
      uReflectionTint: { value: colour(vec.g_vReflectionTint, [1, 1, 1]) },
      uReflectance: { value: f.g_flReflectance ?? 0.33 },
      uReflectionGrey: { value: REFLECTION_GREY },
      uRefractionAmount: { value: f.g_flRefractionAmount ?? 0.06 },
      uReflectionPower: { value: f.g_flReflectionPower ?? 2.4 },
      uBaseBloom: { value: f.g_flBaseBloom ?? 0.01 },
      uDepth: { value: FOG_RANGE * INCH },
      uForceFog: { value: v.IntParams?.F_FORCE_FOG_OVERRIDE ? 1 : 0 },
      uForceFogRange: { value: new THREE.Vector2(f.g_flForceFogOverrideMin ?? 0, f.g_flForceFogOverrideMax ?? 0) },
      uNormal: { value: FLAT as THREE.Texture },
      uNoise: { value: CALM as THREE.Texture },
      uFlow: { value: new THREE.Vector2(flow[0] * 2 - 1, flow[1] * 2 - 1) },
      uFlowNums: { value: new THREE.Vector4(f.g_flBumpStrength ?? 1, f.g_flFlowTimeScale ?? 1, f.g_flNormalFlowTimeIntervalInSeconds ?? 0.6, f.g_flNormalFlowUvScrollDistance ?? 0.18) },
      uWaveNums: { value: new THREE.Vector4(f.g_flNoiseUvScale ?? 0.0005, f.g_flNoiseStrength ?? 2, per(f.g_flNormalUvScale, 500), f.g_flNormalFlowLerpExp ?? 1) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
  });
  m.userData = { ...original.userData };
  made.set(original, m);
  waters.add(m);
  return m;
}

/** A water takes its normal and noise pictures out of the map's file (map_scene.rs water_pictures). */
export async function wavePictures(m: THREE.ShaderMaterial, parser: GLTFParser): Promise<void> {
  const data = m.userData as { waterNormal?: number; waterNoise?: number };
  const load = (i: number | undefined) =>
    i === undefined ? Promise.resolve(null) : (parser.getDependency('texture', i).catch(() => null) as Promise<THREE.Texture | null>);
  const [normal, noise] = await Promise.all([load(data.waterNormal), load(data.waterNoise)]);
  for (const [t, slot] of [[normal, m.uniforms.uNormal], [noise, m.uniforms.uNoise]] as const) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    slot.value = t;
  }
}

/** The map under the water, drawn into a picture with its depth before the frame. */
export interface WaterBed {
  /** draws the map without its water into the bed's picture: `fresh` when the view or the map changed */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, fresh: boolean): void;
  dispose(): void;
}

export function waterBed(): WaterBed {
  let target: THREE.WebGLRenderTarget | null = null;
  let frames = 0;
  const size = new THREE.Vector2();
  return {
    draw(renderer, scene, camera, fresh) {
      renderer.getDrawingBufferSize(size);
      if (!target || target.width !== size.x || target.height !== size.y) {
        target?.dispose();
        target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(size.x, size.y) });
        fresh = true;
      }
      // the clouds' shadows drift on the bed too, slowly: a fresh bed every few frames is enough
      if (!fresh && ++frames % 8 !== 0) return;
      bed.uBed.value = target.texture;
      bed.uBedDepth.value = target.depthTexture;
      bed.uPixel.value.set(1 / size.x, 1 / size.y);
      bed.uNear.value = camera.near;
      bed.uFar.value = camera.far;
      for (const w of waters) w.visible = false;
      const was = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      // as the game's refraction pass draws it (multiblend's water-fog variant): no shadows, clouds, small lights or fog
      lit.uPlain.value = 1;
      renderer.render(scene, camera);
      lit.uPlain.value = 0;
      renderer.setRenderTarget(was);
      for (const w of waters) w.visible = true;
    },
    dispose() { target?.dispose(); target = null; },
  };
}
