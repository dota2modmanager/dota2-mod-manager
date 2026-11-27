/* The river of the Optimization window's map, drawn by the game's water shader (water_dota.vfx,
 * read from its bytecode 2026-11-25 and checked pixel by pixel against a RenderDoc frame of the game
 * 2026-11-26):
 *
 *   d      = saturate(how deep the bed lies under the water / FOG_RANGE), in inches
 *   bed    = the map under the water, looked up a little off where the waves bend it
 *   colour = bed × mix(1, refraction tint, saturate(3.5 d))
 *   colour = mix(colour, water fog colour × the zone's shadow colour, d)
 *   pixel  = saturate(colour + reflection colour × specular colour × sun × pow(saturate(R · reflection dir), power))
 *
 * The game draws the water into its deferred pass but leaves it out of the light that pass lays on the
 * rest of the map: the bed is lit already, so the colour above is the pixel, and only the view's fog and
 * the tonemap come after it. The bed is a pass of its own: the map drawn without its water into a
 * picture with its depth (the game's refraction map), lit by the sun with its shadows and the clouds',
 * but without the occlusion, small lights, shine or fog (map-light.ts uPlain), done again only when
 * the view moved or every few frames for the clouds' shadows.
 *
 * d is what the map under the water writes into its alpha (multiblend's
 * D_WRITE_WATER_FOG_TO_DEST_ALPHA: saturate(dot(plane, P) × g_flInvFogRange)), the plane the water's
 * own, (0, 0, -1, height), and the range 35 inches; the frame's river floor under the rune is 10 inches
 * deep, 0.29. Props under the water write 8/35 whatever their depth, which is left out here. The fog's light is mix(sun, AmbientColor2, g_flWaterFogShadowFactor) with
 * the factor 1, the zone light's m_AmbientColor2 as it stands. The reflection map holds nothing of the
 * map (black over the whole frame), so the reflection term is left out.
 *
 * The waves are the game's normal picture flowing (F_FLOW_NORMALS, read the same way 2026-11-26),
 * P the pixel's place in inches, (x, -y), and the flow the map's flow picture where the water lies
 * (ent_dota_lightinfo's water_flow_map_texture at 0.5 + (x, y) / 18944, a frame's cb3[7..8]; the
 * material's TextureFlow without one). Without it the river took the material's flat 0.5, a flow of
 * nothing, and its waves ran sixteen times as weak as the game's (|flow|² + 0.1: 0.1 against 1.65 at
 * the Dire rune):
 *
 *   t        = time × flow time scale / (2 × interval) + noise(P × noise scale).g × noise strength
 *   phase k  = fract(t + ½ or t), its turn floor(...): picture at P / normal scale + turn × 0.311 (+ ½) + phase × flow × scroll
 *   n.xy     = (picture A × |2 phase B - 1|^exp + picture B × |2 phase A - 1|^exp) × 2 - 1, × (|flow|² + 0.1) × bump
 *
 * so each picture fades out as it is about to jump back, and the noise keeps the stretches of the
 * river from pulsing together. The material's scales are the shader's divisors (its 500 is a
 * picture 500 inches wide).
 *
 * With the player's cheap water (video.txt dota_cheap_water, water_dota's D_CHEAP_WATER, read from a
 * RenderDoc frame at the game's low settings 2026-11-27) the same waves, bent by the low end's bump
 * (g_flLowEndBumpStrength in place of the bump), light a flat colour laid over the bed by its alpha:
 *
 *   light    = sun × saturate(N · -L) + ambient × saturate(N · ambient dir) + (1 - N · -L) × shadow colours
 *   fresnel  = saturate((1 - N.z)^g_flLowEndSurfaceFactor + g_flLowEndSurfaceMinimumColor)
 *   s        = saturate(g_vLowEndReflectionDir · R), shine = low end reflection colour × fog colour × s^power
 *   surface  = saturate(g_vLowEndSurfaceColor × fresnel + shine), alpha = saturate(s^power + g_flLowEndSurfaceOpacity)
 *   pixel    = mix(surface × light, surface, saturate(2 s + g_flLowEndBaseBloom)) over the bed
 *
 * no depth, no refraction, no water fog: the river reads as one teal sheet. */
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

/** The way the water runs over the whole map (the light copy's waterFlow, map_scene.rs), once in. */
const flowMap = {
  uFlowMap: { value: null as THREE.Texture | null },
  uHasFlowMap: { value: 0 },
};

/** Whether the water is the game's cheap one (the player's dota_cheap_water), shared by every water. */
const cheap = { uCheap: { value: 0 } };

/** Draw the cheap water, as the player's game does with dota_cheap_water. */
export function cheapWater(on: boolean): void {
  cheap.uCheap.value = on ? 1 : 0;
}

/** The map's flow picture, as the light copy carries it. */
export function waterFlow(t: THREE.Texture): void {
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  flowMap.uFlowMap.value = t;
  flowMap.uHasFlowMap.value = 1;
}

/** Inches across the map's flow picture (1184 pixels of 16). */
const FLOW_SPAN = 18944;

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
/** How deep under the water the fog turns to its full colour, in inches (g_flInvFogRange = 1/35 in a
 * frame of the game). */
const FOG_RANGE = 35;

const FLAT = pixel(128, 128, 255);
const CALM = pixel(0, 0, 0);

const FRAGMENT = `
// saturate and the rest: without it the water does not build where three draws it into a picture of its own (map-ao.ts)
#include <common>
uniform sampler2D uNormal, uNoise, uFlowMap;
uniform vec2 uFlow;
uniform float uHasFlowMap;
uniform vec4 uFlowNums, uWaveNums;
uniform vec3 uSun, uShade, uSpecColor, uFogColor;
uniform float uSpecIndependence, uFogFrom;
uniform vec4 uFog;
uniform sampler2D uBed, uBedDepth;
uniform vec2 uPixel;
uniform float uNear, uFar, uTime;
uniform vec3 uRefractionTint, uWaterFog, uReflectionColor, uReflectionDir;
uniform float uRefractionAmount, uReflectionPower, uForceFog;
uniform vec2 uForceFogRange;
uniform float uCheap, uLowBump, uLowPower, uLowBloom;
uniform vec3 uLowSurface, uLowFresnel, uLowReflColor, uLowReflDir;
uniform vec3 uSunDir, uAmbient, uAmbientDir, uShadeUp, uShadeDown;
varying vec3 vWorld;

float eyeDepth( float z ) { return uNear * uFar / ( uFar - z * ( uFar - uNear ) ); }

void main() {
  // the game's axes: the export turned Source's x, y, z into three's z, x, y
  vec3 p = vWorld.zxy, eye = cameraPosition.zxy;
  // the waves: the normal picture flowing (uFlowNums: bump, time scale, interval, scroll;
  // uWaveNums: noise scale, noise strength, normal scale, the fade's power)
  vec2 at = vec2( p.x, -p.y ) / ${INCH};
  vec2 flow = uHasFlowMap > 0.5 ? texture2D( uFlowMap, 0.5 + p.xy / ${INCH} / ${FLOW_SPAN}.0 ).xy * 2.0 - 1.0 : uFlow;
  vec2 scroll = flow * uFlowNums.w;
  float t = uFlowNums.y * uTime / ( 2.0 * uFlowNums.z ) + texture2D( uNoise, at * uWaveNums.x ).y * uWaveNums.y;
  vec2 base = at * uWaveNums.z;
  float a = t + 0.5, fa = fract( a ), fb = fract( t );
  vec2 pa = texture2D( uNormal, base + floor( a ) * 0.311 + 0.5 + fa * scroll ).xy;
  vec2 pb = texture2D( uNormal, base + floor( t ) * 0.311 + fb * scroll ).xy;
  vec2 bend = ( pb * pow( abs( 2.0 * fa - 1.0 ), uWaveNums.w ) + pa * pow( abs( 2.0 * fb - 1.0 ), uWaveNums.w ) ) * 2.0 - 1.0;
  bend *= ( dot( flow, flow ) + 0.1 ) * uFlowNums.x * ( uCheap > 0.5 ? uLowBump : 1.0 );
  if ( dot( bend, bend ) > 1.0 ) bend = normalize( bend );
  vec3 n = vec3( bend, sqrt( max( 1.0 - dot( bend, bend ), 0.0 ) ) );

  vec2 uv = gl_FragCoord.xy * uPixel;
  vec3 ray = p - eye;
  float dist = length( ray );
  if ( uCheap > 0.5 ) {
    // the cheap water: a flat colour, lit as the props are without their shadows, over the bed
    vec3 n3 = n.yzx;
    float sun = saturate( dot( n3, -uSunDir ) );
    vec3 light = sun * uSun + saturate( dot( n3, uAmbientDir ) ) * uAmbient + ( 1.0 - sun ) * mix( uShadeDown, uShadeUp, n.z * 0.5 + 0.5 );
    vec3 v = normalize( ray );
    vec3 r = 2.0 * dot( v, n ) * n - v;
    float s = saturate( dot( uLowReflDir, r ) ), glint = pow( s, uLowPower );
    float fresnel = saturate( pow( 1.0 - n.z, uLowFresnel.x ) + uLowFresnel.y );
    vec3 surface = saturate( uLowSurface * fresnel + uLowReflColor * uFogColor * glint );
    vec3 c = mix( surface * light, surface, saturate( 2.0 * s + uLowBloom ) );
    c = mix( texture2D( uBed, uv ).rgb, c, saturate( glint + uLowFresnel.z ) );
    float far = max( dist - uFogFrom, 0.0 );
    float fog = min( pow( saturate( ( far - uFog.x ) / max( uFog.y - uFog.x, 1e-3 ) ), uFog.z ), uFog.w );
    gl_FragColor = vec4( mix( c, uFogColor, fog ), 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }

  // how deep: where the bed lies below the water's plane, in inches
  float surface = eyeDepth( gl_FragCoord.z ), under = eyeDepth( texture2D( uBedDepth, uv ).x );
  vec3 below = eye + ray * ( under / max( surface, 1e-3 ) );
  float d = saturate( ( p.z - below.z ) / ${INCH} / ${FOG_RANGE}.0 );
  if ( uForceFog > 0.5 ) d = mix( uForceFogRange.x, uForceFogRange.y, d );

  // the bed, bent by the waves as far as the water is deep and the camera near (1120: the game's number)
  vec2 off = n.xy * d * uRefractionAmount * 1120.0 / ( dist / ${INCH} );
  vec4 under4 = texture2D( uBed, clamp( uv - off * vec2( 1.0, -1.0 ), 0.0, 1.0 ) );
  vec3 c = under4.rgb;
  // an overlay on the bed (the Dire camp's marking) lays its own alpha over the bed's fog, as deep as it
  // covers: the game's overlays blend into the alpha its bed writes the fog in
  d = max( d, under4.a );
  c = mix( c, c * uRefractionTint, saturate( 3.5 * d ) );
  c = mix( c, uWaterFog * uShade, d );

  // the sun's shine on the waves, as the game's water takes it
  vec3 v = normalize( ray );
  vec3 r = 2.0 * dot( v, n ) * n - v;
  // the material's direction as it stands (dp3_sat cb0[16].yzw, R in water_dota; the far river at the
  // Dire rune takes 0.63 of its shine from it, RenderDoc 2026-11-27)
  float shine = pow( saturate( dot( uReflectionDir, r ) ), uReflectionPower );
  vec3 shineColour = mix( uReflectionColor * uSpecColor * uSun, uReflectionColor * uSpecColor, saturate( uSpecIndependence ) );
  c = saturate( c + shineColour * shine );

  // the view's fog, as on the rest of the map (map-light.ts); the game's light pass leaves the water out
  float far = max( dist - uFogFrom, 0.0 );
  float fog = min( pow( saturate( ( far - uFog.x ) / max( uFog.y - uFog.x, 1e-3 ) ), uFog.z ), uFog.w );
  gl_FragColor = vec4( mix( c, uFogColor, fog ), 1.0 );
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
      ...flowMap,
      ...cheap,
      uTime: waterTime,
      uLowBump: { value: f.g_flLowEndBumpStrength ?? 0.15 },
      uLowPower: { value: f.g_flLowEndReflectionPower ?? 2.247 },
      uLowBloom: { value: f.g_flLowEndBaseBloom ?? 0.01 },
      uLowSurface: { value: colour(vec.g_vLowEndSurfaceColor, [0.184, 0.275, 0.243]) },
      uLowFresnel: { value: new THREE.Vector3(f.g_flLowEndSurfaceFactor ?? 0.224, f.g_flLowEndSurfaceMinimumColor ?? 0.104, f.g_flLowEndSurfaceOpacity ?? 0.875) },
      uLowReflColor: { value: colour(vec.g_vLowEndReflectionColor, [0.729, 0.729, 0.729]) },
      uLowReflDir: { value: new THREE.Vector3(...((vec.g_vLowEndReflectionDir ?? [-0.03, -1, 0.273]).slice(0, 3) as [number, number, number])) },
      uRefractionTint: { value: colour(vec.g_vRefractionTint, [0.349, 0.663, 0.78]) },
      uWaterFog: { value: colour(vec.g_vWaterFogColor, [0.259, 0.137, 0.051]) },
      uReflectionColor: { value: colour(vec.g_vReflectionColor, [0.231, 0.231, 0.231]) },
      uReflectionDir: { value: new THREE.Vector3(dir[0], dir[1], dir[2]) },
      uRefractionAmount: { value: f.g_flRefractionAmount ?? 0.06 },
      uReflectionPower: { value: f.g_flReflectionPower ?? 2.4 },
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
      // as the game's refraction pass draws it (multiblend's water-fog variant): the sun with its shadows and
      // the clouds', no occlusion, small lights, shine or fog
      lit.uPlain.value = 1;
      const clearAlpha = renderer.getClearAlpha();
      renderer.setClearAlpha(0);
      renderer.render(scene, camera);
      renderer.setClearAlpha(clearAlpha);
      lit.uPlain.value = 0;
      renderer.setRenderTarget(was);
      for (const w of waters) w.visible = true;
    },
    dispose() { target?.dispose(); target = null; },
  };
}
