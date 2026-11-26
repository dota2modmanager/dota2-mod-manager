/* A prop's shine, as the game lays it: global_lit_simple.vfx under F_SPECULAR, its pixel shader
 * read from the game's bytecode 2026-11-26:
 *
 *   shine  = pow(saturate(specular dir · reflect(to the eye, n)), specular power)
 *            × g_tSpecular.r × g_flSpecularIntensity × the zone's specular colour
 *   colour = light × (albedo + (1 - independence) × shine) + independence × shine
 *
 * The zone gives the colour (a cold blue on the Radiant side), where the shine comes from and how
 * tight it is (map-light.ts); the material its picture, whose red says which pixels are wet or
 * polished. This file gives a material its picture and turns the shine on in its shader. */
import * as THREE from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface VmatOfSpec { FloatParams?: Record<string, number> }
const dataOf = (m: THREE.Material) => m.userData as { vmat?: VmatOfSpec; specular?: number };

/** Whether a material shines (map_scene.rs names its specular picture). */
export const isShiny = (m: THREE.Material): boolean => typeof dataOf(m).specular === 'number';

/** No shine until the picture is in. */
const NONE = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

const own = new WeakMap<THREE.Material, { uSpecMap: { value: THREE.Texture }; uSpecIntensity: { value: number } }>();

function uniformsOf(m: THREE.Material) {
  let u = own.get(m);
  if (u) return u;
  u = { uSpecMap: { value: NONE }, uSpecIntensity: { value: dataOf(m).vmat?.FloatParams?.g_flSpecularIntensity ?? 1 } };
  own.set(m, u);
  return u;
}

/** Turn the shine on in a shiny material's shader (map-light.ts draws it), before the world's light goes in. */
export function specShader(sh: THREE.WebGLProgramParametersWithUniforms, m: THREE.Material): void {
  Object.assign(sh.uniforms, uniformsOf(m));
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#define MM_SPECULAR\n#include <common>\nuniform sampler2D uSpecMap;\nuniform float uSpecIntensity;');
}

/** A shiny material takes its specular picture out of the map's file. */
export async function specPictures(m: THREE.Material, parser: GLTFParser): Promise<void> {
  const i = dataOf(m).specular;
  if (typeof i !== 'number') return;
  const t = (await parser.getDependency('texture', i).catch(() => null)) as THREE.Texture | null;
  if (!t) return;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  uniformsOf(m).uSpecMap.value = t;
}
