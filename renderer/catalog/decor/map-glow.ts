/* A glow of the map: global_lit_simple.vfx under F_TRANSLUCENT and F_ADDITIVE_BLEND, not an overlay
 * (the light hanging in the Dire's lava pit, glow_00). Its pixel shader, read from the game's bytecode
 * 2026-11-26:
 *
 *   speed  = scroll picture (g_tScrollSpeed).g
 *   colour = g_tColor(uv + scroll direction × speed × g_flScrollUvSpeed × time) × tint × vertex colour, lit
 *   alpha  = scroll picture.a × vertex alpha × g_flOpacityScale × |N · camera forward|^g_flAlphaAnglePower × (1 - fog)
 *
 * added over what is behind it (alpha × colour + behind), writing no depth. The export hands such a
 * material its scroll picture as its colour; the light copy keeps the colour beside it
 * (map_scene.rs glow_colour). Cut as a leaf, the pit stood as a red wall where the game's is dark
 * under an orange haze. */
import * as THREE from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { waterTime } from './map-water.ts';

interface VmatOfGlow { IntParams?: Record<string, number>; FloatParams?: Record<string, number>; VectorParams?: Record<string, number[]> }
const dataOf = (m: THREE.Material) => m.userData as { vmat?: VmatOfGlow; glowColour?: number };
const on = (m: THREE.Material, key: string) => dataOf(m).vmat?.IntParams?.[key] === 1;

/** Whether a material is a glow. */
export const isGlow = (m: THREE.Material): boolean => !on(m, 'F_OVERLAY') && on(m, 'F_TRANSLUCENT') && on(m, 'F_ADDITIVE_BLEND');

/** Whether the world's light falls on the glow: only with F_ALLOW_LIGHTING_ON_TRANSLUCENT. Without
 * it the game's variant reads no light at all (global_lit_simple, S_ALLOW_LIGHTING_ON_TRANSLUCENT 0:
 * colour = picture × tint × vertex colour, plus shine): the Dire's pit haze (fountain_dire_01) is
 * its copy's orange as it stands, where the zone's blue light would make it a dim red. */
const lit = (m: THREE.Material): boolean => on(m, 'F_ALLOW_LIGHTING_ON_TRANSLUCENT');

/** The power the glow fades by as it turns from the camera (0: it does not). */
const anglePower = (m: THREE.Material): number =>
  (on(m, 'F_ALPHA_ANGLE_POWER') ? (dataOf(m).vmat?.FloatParams?.g_flAlphaAnglePower ?? 1) : 0);

/** A grey until the colour picture is in. */
const GREY = (() => {
  const t = new THREE.DataTexture(new Uint8Array([108, 108, 108, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

const own = new WeakMap<THREE.Material, Record<string, { value: unknown }>>();
function uniformsOf(m: THREE.Material) {
  let u = own.get(m);
  if (u) return u;
  const f = dataOf(m).vmat?.FloatParams ?? {}, dir = dataOf(m).vmat?.VectorParams?.g_vScrollUvDirection ?? [0, 0];
  const scrolls = on(m, 'F_SCROLL_UV');
  u = {
    uGlowColour: { value: GREY as THREE.Texture },
    uGlowScroll: { value: new THREE.Vector2(dir[0] ?? 0, dir[1] ?? 0).multiplyScalar(scrolls ? (f.g_flScrollUvSpeed ?? 0) : 0) },
    uGlowOpacity: { value: f.g_flOpacityScale ?? 1 },
    uGlowTime: waterTime,
  };
  own.set(m, u);
  return u;
}

/** Make a glow's material add its light over the scene, as the game blends it. */
export function prepareGlow(m: THREE.Material): void {
  m.transparent = true; m.depthWrite = false;
  m.blending = THREE.CustomBlending; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor;
}

/** The glow's colour, scroll and fade in its shader, the world's light (map-light.ts) after. */
export function glowShader(sh: THREE.WebGLProgramParametersWithUniforms, m: THREE.Material): void {
  Object.assign(sh.uniforms, uniformsOf(m));
  sh.fragmentShader = `#define MM_GLOW\n${lit(m) ? '' : '#define MM_GLOW_UNLIT\n'}${sh.fragmentShader}`
    .replace('#include <common>', '#include <common>\nuniform sampler2D uGlowColour;\nuniform vec2 uGlowScroll;\nuniform float uGlowOpacity, uGlowTime;')
    .replace('#include <map_fragment>', `#ifdef USE_MAP
    {
      vec4 trans = texture2D( map, vMapUv );
      vec4 colour = texture2D( uGlowColour, vMapUv + uGlowScroll * trans.g * uGlowTime );
      diffuseColor *= vec4( colour.rgb, trans.a * uGlowOpacity );
    }
    #endif`)
    .replace('#include <opaque_fragment>', `{
      vec3 forward = -vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] );
      diffuseColor.a *= pow( abs( dot( inverseTransformDirection( normal, viewMatrix ), forward ) ), ${anglePower(m).toFixed(3)} );
    }
    #include <opaque_fragment>`);
}

/** The program's key: the fade's power is written into it. */
export const glowKey = (m: THREE.Material): string => `glow${anglePower(m)}${lit(m) ? 'lit' : ''}`;

/** A glow takes its colour picture out of the map's file. */
export async function glowPictures(m: THREE.Material, parser: GLTFParser): Promise<void> {
  const i = dataOf(m).glowColour;
  if (typeof i !== 'number') return;
  const t = (await parser.getDependency('texture', i).catch(() => null)) as THREE.Texture | null;
  if (!t) return;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  uniformsOf(m).uGlowColour.value = t;
}
