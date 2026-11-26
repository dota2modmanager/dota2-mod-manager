/* A prop's tint where its tint mask lets it, as the game lays it: global_lit_simple.vfx under
 * F_TINT_MASK, its pixel shader read from the game's bytecode 2026-11-26:
 *
 *   albedo = colour picture × mix(g_vColorTint2, g_vColorTint × the copy's tint, tint mask.g)
 *
 * The copy's tint is what the map paints that copy in (map-merge.ts lays it as vertex colours), so
 * a tree's leaves take the map's greens and its trunk, outside the mask, keeps its own colour; the
 * Dire banner's cloth stays red. Without the mask the tint would cover the whole model. */
import * as THREE from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface VmatOfTint { VectorParams?: Record<string, number[]> }
const dataOf = (m: THREE.Material) => m.userData as { vmat?: VmatOfTint; propTintMask?: number };

/** Whether a material tints only where its mask says (map_scene.rs names the mask). */
export const isMaskTinted = (m: THREE.Material): boolean => typeof dataOf(m).propTintMask === 'number';

/** Every pixel tinted, until the mask's own picture is in: as the material drew before. */
const ALL = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** A material's colour number (sRGB as picked) as the linear factor the shader multiplies by. */
const linear = (v: number[] | undefined) =>
  new THREE.Color().setRGB(v?.[0] ?? 1, v?.[1] ?? 1, v?.[2] ?? 1, THREE.SRGBColorSpace);

const own = new WeakMap<THREE.Material, { uTintMask: { value: THREE.Texture }; uTint: { value: THREE.Color }; uTint2: { value: THREE.Color } }>();

function uniformsOf(m: THREE.Material) {
  let u = own.get(m);
  if (u) return u;
  const v = dataOf(m).vmat?.VectorParams ?? {};
  u = { uTintMask: { value: ALL }, uTint: { value: linear(v.g_vColorTint) }, uTint2: { value: linear(v.g_vColorTint2) } };
  own.set(m, u);
  return u;
}

const FRAGMENT = `
#ifdef USE_MAP
{
  vec3 copyTint = vec3( 1.0 );
  #if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  copyTint = vColor.rgb;
  #endif
  diffuseColor.rgb *= mix( uTint2, uTint * copyTint, texture2D( uTintMask, vMapUv ).g );
}
#endif`;

/** Teach a mask-tinted material's shader the game's tint, in place of three's vertex colours. */
export function tintShader(sh: THREE.WebGLProgramParametersWithUniforms, m: THREE.Material): void {
  Object.assign(sh.uniforms, uniformsOf(m));
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform sampler2D uTintMask;\nuniform vec3 uTint, uTint2;')
    .replace('#include <color_fragment>', FRAGMENT);
}

/** A mask-tinted material takes its mask out of the map's file. */
export async function tintPictures(m: THREE.Material, parser: GLTFParser): Promise<void> {
  const i = dataOf(m).propTintMask;
  if (typeof i !== 'number') return;
  const t = (await parser.getDependency('texture', i).catch(() => null)) as THREE.Texture | null;
  if (!t) return;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  uniformsOf(m).uTintMask.value = t;
}
