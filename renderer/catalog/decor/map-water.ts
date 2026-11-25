/* The river of the Optimization window's map, drawn by the game's water shader (water_dota.vfx,
 * its forward pass read from the shader's bytecode 2026-11-25):
 *
 *   d      = how deep the water is under this pixel, a share of g_flWaterDepth (35 inches)
 *   bed    = the map under the water, looked up a little off where the waves bend it
 *   colour = bed × mix(1, refraction tint, saturate(3.5 d))
 *   colour = mix(colour, water fog colour × the light it takes, d)
 *   colour = saturate(colour + reflection colour × specular colour × sun × pow(saturate(R · reflection dir), power))
 *   pixel  = colour × the world's light on the waves' normal (map-light.ts, without shadows)
 *
 * d is what the map under the water writes into its alpha (multiblend's
 * D_WRITE_WATER_FOG_TO_DEST_ALPHA: saturate(dot(g_vClipPlane0, P) × g_flInvFogRange)), how far
 * below the water's plane it lies; Dota's river is a few inches deep, so d stays near 0.1. The bed
 * is a pass of its own: the map drawn without its water into a picture with its depth (the game's
 * refraction map), done again only when the view moved or every few frames for the clouds' shadows.
 *
 * Not yet as the game: the fog's light is g_vWaterFogColor × mix(sun, AmbientColor2,
 * g_flWaterFogShadowFactor), and with the zone's pink shadow colour as AmbientColor2 the river
 * turns red, which the game's is not; the zone's ambient colour without its scale is taken instead,
 * the closest of the tries to a frame of the game. The reflection map's picture (× g_vFogColor ×
 * Reflectance) is unknown and left out. The game's normal and flow pictures are
 * not in the map's light copy yet, so the waves are made: a few moving ripples bend the normal.
 * Against a frame of the game the river's colour is off by 6 of 255 (the turquoise sheet before: 20). */
import * as THREE from 'three';
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

const FRAGMENT = `
#define AMBIENT_SCALE 5.0
uniform vec3 uSunDir, uSun, uAmbientDir, uAmbient, uShadeUp, uShadeDown, uSpecColor;
uniform float uSpecIndependence;
uniform sampler2D uBed, uBedDepth;
uniform vec2 uPixel;
uniform float uNear, uFar, uTime;
uniform vec3 uRefractionTint, uWaterFog, uReflectionColor, uReflectionDir;
uniform float uRefractionAmount, uReflectionPower, uBaseBloom, uDepth, uForceFog;
uniform vec2 uForceFogRange;
varying vec3 vWorld;

float eyeDepth( float z ) { return uNear * uFar / ( uFar - z * ( uFar - uNear ) ); }

void main() {
  // the game's axes: the export turned Source's x, y, z into three's z, x, y
  vec3 p = vWorld.zxy, eye = cameraPosition.zxy;
  vec2 wp = vWorld.xz;
  float t = uTime;
  vec2 bend = vec2(
    sin( wp.x * 0.85 + t * 1.2 ) * 0.35 + sin( wp.y * 1.6 - t * 0.9 ) * 0.25 + sin( ( wp.x + wp.y ) * 3.3 + t * 2.3 ) * 0.15,
    cos( wp.y * 1.05 + t * 1.0 ) * 0.35 + cos( wp.x * 1.9 - t * 1.5 ) * 0.25 + cos( ( wp.x - wp.y ) * 3.7 + t * 1.9 ) * 0.15 ) * 0.3;
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

  // the sun's shine on the waves, as the game's water takes it
  vec3 v = normalize( ray );
  vec3 r = 2.0 * dot( v, n ) * n - v;
  float shine = pow( saturate( dot( uReflectionDir, r ) ), uReflectionPower );
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
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...lit,
      ...bed,
      uTime: waterTime,
      uRefractionTint: { value: colour(vec.g_vRefractionTint, [0.349, 0.663, 0.78]) },
      uWaterFog: { value: colour(vec.g_vWaterFogColor, [0.259, 0.137, 0.051]) },
      uReflectionColor: { value: colour(vec.g_vReflectionColor, [0.231, 0.231, 0.231]) },
      uReflectionDir: { value: new THREE.Vector3(dir[0], dir[1], dir[2]) },
      uRefractionAmount: { value: f.g_flRefractionAmount ?? 0.06 },
      uReflectionPower: { value: f.g_flReflectionPower ?? 2.4 },
      uBaseBloom: { value: f.g_flBaseBloom ?? 0.01 },
      uDepth: { value: (f.g_flWaterDepth ?? 35) * INCH },
      uForceFog: { value: v.IntParams?.F_FORCE_FOG_OVERRIDE ? 1 : 0 },
      uForceFogRange: { value: new THREE.Vector2(f.g_flForceFogOverrideMin ?? 0, f.g_flForceFogOverrideMax ?? 0) },
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
      renderer.render(scene, camera);
      renderer.setRenderTarget(was);
      for (const w of waters) w.visible = true;
    },
    dispose() { target?.dispose(); target = null; },
  };
}
