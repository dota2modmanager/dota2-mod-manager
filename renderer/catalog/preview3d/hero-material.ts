/* The game's hero shader in the 3D preview (issue #417): a hero and its items lit the way the
 * game's loadout lights them, not as plastic.
 *
 * The toolchain keeps each material's own settings in the GLB (extras.vmat: the shader, its
 * switches, numbers and every texture it samples), and the shader is hero.vfx for all of them. Its
 * masks are the ones the Workshop documents for item makers:
 *   masks 1: R detail, G diffuse warp, B metalness, A self-illumination
 *   masks 2: R specular intensity, G rim light, B tint the specular by the colour, A specular exponent
 * The fresnel warp is three curves read by how much a surface faces the eye (R colour, G rim,
 * B specular); the diffuse warp is the hero's own light ramp, read by the half-lambert term.
 *
 * What this does not do: the game's cube map (the preview reflects a sky-to-ground gradient
 * instead), the detail texture, status effects and cloaking. A material with another shader keeps
 * the loader's own. */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

type Vmat = {
  ShaderName?: string;
  IntParams?: Record<string, number>;
  FloatParams?: Record<string, number>;
  VectorParams?: Record<string, number[]>;
  TextureParams?: Record<string, string>;
};

/** The light rig every hero material shares, in view space; scene.ts turns it with the camera each frame. */
export interface HeroLights {
  key: THREE.Vector3; keyColor: THREE.Color;
  fill: THREE.Vector3; fillColor: THREE.Color;
  up: THREE.Vector3; sky: THREE.Color; ground: THREE.Color; rim: THREE.Color;
}

const vertexShader = /* glsl */`
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
uniform vec4 uUvTransform;
varying vec2 vUv0;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vUv0 = uv * uUvTransform.xy + uUvTransform.zw;
  #include <beginnormal_vertex>
  #include <morphinstance_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  vNormalV = normalize(transformedNormal);
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vViewPos = -mvPosition.xyz;
}
`;

const fragmentShader = /* glsl */`
uniform sampler2D uColor, uNormal, uMasks1, uMasks2, uFresnelWarp, uDiffuseWarp, uCubeMask;
uniform float uHasNormal, uHasMasks1, uHasMasks2, uHasDiffuseWarp, uAlphaTest, uSelfIllumOn, uHasCubeMask;
uniform float uWarpFull, uMetalFull, uSelfIllumFull, uSpecFull, uExpFull;
uniform float uSpecScale, uSpecExp, uRimScale, uCubeScale, uWarpRow;
uniform vec3 uSpecColor, uRimColorM;
uniform vec3 uKey, uKeyColor, uFill, uFillColor, uUp, uSky, uGround, uRim;
varying vec2 vUv0;
varying vec3 vNormalV;
varying vec3 vViewPos;

mat3 tangentFrame(vec3 eye, vec3 n, vec2 uv) {
  vec3 q0 = dFdx(eye), q1 = dFdy(eye);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1p = cross(q1, n), q0p = cross(n, q0);
  vec3 t = q1p * st0.x + q0p * st1.x;
  vec3 b = q1p * st0.y + q0p * st1.y;
  float det = max(dot(t, t), dot(b, b));
  float s = det == 0.0 ? 0.0 : inversesqrt(det);
  return mat3(t * s, b * s, n);
}

vec3 warp(vec3 n, vec3 l, float mask) {
  float nl = dot(n, l);
  vec3 plain = vec3(max(nl, 0.0));
  if (uHasDiffuseWarp < 0.5) return plain;
  vec3 ramp = texture2D(uDiffuseWarp, vec2(clamp(nl * 0.5 + 0.5, 0.01, 0.99), uWarpRow)).rgb;
  return mix(plain, ramp, mask);
}

void main() {
  vec4 base = texture2D(uColor, vUv0);
  if (base.a < uAlphaTest) discard;
  vec3 albedo = base.rgb;
  vec3 n = normalize(vNormalV) * (gl_FrontFacing ? 1.0 : -1.0);
  if (uHasNormal > 0.5) {
    vec3 t = texture2D(uNormal, vUv0).xyz * 2.0 - 1.0;
    t.y = -t.y;
    n = normalize(tangentFrame(-vViewPos, n, vUv0) * t);
  }
  vec3 v = normalize(vViewPos);
  vec4 m1 = uHasMasks1 > 0.5 ? texture2D(uMasks1, vUv0) : vec4(0.0, 1.0, 0.0, 0.0);
  vec4 m2 = uHasMasks2 > 0.5 ? texture2D(uMasks2, vUv0) : vec4(0.0);
  float warpMask = mix(m1.g, 1.0, uWarpFull);
  float metal = mix(m1.b, 1.0, uMetalFull);
  // the mask's alpha is self-illumination only where the material switches it on
  float selfIllum = mix(m1.a, 1.0, uSelfIllumFull) * uSelfIllumOn;
  float specMask = mix(m2.r, 1.0, uSpecFull);
  float expo = mix(m2.a * 127.0 + 1.0, uSpecExp, uExpFull);
  float nv = clamp(dot(n, v), 0.0, 1.0);
  vec3 fres = texture2D(uFresnelWarp, vec2(clamp(nv, 0.01, 0.99), 0.5)).rgb;

  float up = dot(n, uUp);
  vec3 ambient = mix(uGround, uSky, up * 0.5 + 0.5);
  vec3 light = warp(n, uKey, warpMask) * uKeyColor + warp(n, uFill, warpMask) * uFillColor + ambient;
  vec3 col = albedo * light * (1.0 - metal * 0.85);

  vec3 specTint = mix(vec3(1.0), albedo, m2.b) * uSpecColor;
  vec3 hk = normalize(uKey + v), hf = normalize(uFill + v);
  float spec = pow(max(dot(n, hk), 0.0), expo) * max(dot(n, uKey), 0.0) * length(uKeyColor)
    + 0.5 * pow(max(dot(n, hf), 0.0), expo) * max(dot(n, uFill), 0.0) * length(uFillColor);
  col += specTint * spec * specMask * uSpecScale * (0.35 + fres.b);

  vec3 r = reflect(-v, n);
  vec3 env = mix(uGround, uSky * 2.0, smoothstep(-0.3, 0.6, dot(r, uUp)));
  float cubeMask = uHasCubeMask > 0.5 ? texture2D(uCubeMask, vUv0).r : metal;
  col += env * albedo * cubeMask * uCubeScale * 0.35;

  col += uRim * uRimColorM * fres.g * m2.g * uRimScale * clamp(up + 0.35, 0.0, 1.0);
  col = mix(col, albedo, selfIllum);

  gl_FragColor = vec4(col, uAlphaTest > 0.0 ? 1.0 : base.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const shared = (lights: HeroLights) => ({
  uKey: { value: lights.key }, uKeyColor: { value: lights.keyColor },
  uFill: { value: lights.fill }, uFillColor: { value: lights.fillColor },
  uUp: { value: lights.up }, uSky: { value: lights.sky }, uGround: { value: lights.ground }, uRim: { value: lights.rim },
});

/**
 * A texture of the GLB by the name the material gives it, as a copy of its own: the loader marks the
 * one it shares as sRGB wherever it used it as a colour (masks 1 is its emissive map), and a mask
 * read as sRGB is a different mask. Colours are decoded to linear on the GPU; lookups are clamped.
 */
async function textureNamed(gltf: GLTF, name: string | undefined, kind: 'color' | 'data' | 'lookup' | 'ramp' = 'data'): Promise<THREE.Texture | null> {
  if (!name) return null;
  const list = (gltf.parser.json.textures || []) as { name?: string }[];
  const index = list.findIndex((t) => t.name === name);
  if (index < 0) return null;
  try {
    const tex = (await gltf.parser.getDependency('texture', index) as THREE.Texture).clone();
    tex.colorSpace = kind === 'color' || kind === 'ramp' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (kind === 'lookup' || kind === 'ramp') { tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; }
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

/** The game's hero shader for one material, or null when it is not one this preview draws itself. */
async function heroMaterial(gltf: GLTF, from: THREE.Material, lights: HeroLights): Promise<THREE.ShaderMaterial | null> {
  const vmat = (from.userData as { vmat?: Vmat }).vmat;
  if (!vmat || !/^hero(_\w+)?\.vfx$/i.test(vmat.ShaderName || '')) return null;
  const int = vmat.IntParams || {};
  const num = (k: string, d = 0) => vmat.FloatParams?.[k] ?? d;
  const vec = (k: string, d: number[]) => vmat.VectorParams?.[k] ?? d;
  const tp = vmat.TextureParams || {};
  const [color, normal, masks1, masks2, fresnel, diffuseWarp, cubeMask] = await Promise.all([
    textureNamed(gltf, tp.g_tColor, 'color'), textureNamed(gltf, tp.g_tNormal),
    int.F_MASKS_1 ? textureNamed(gltf, tp.g_tMasks1) : null, int.F_MASKS_2 ? textureNamed(gltf, tp.g_tMasks2) : null,
    textureNamed(gltf, tp.g_tFresnelWarp, 'lookup'), int.F_DIFFUSE_WARP ? textureNamed(gltf, tp.g_tDiffuseWarp, 'ramp') : null,
    int.F_MASK_CUBE_MAP_BY_SEPARATE_MASK ? textureNamed(gltf, tp.g_tCubeMapSeparateMask) : null,
  ]);
  if (!color || !fresnel) return null;
  const scale = vec('g_vTexCoordScale', [1, 1]);
  const offset = vec('g_vTexCoordOffset', [0, 0]);
  const blank = color;
  const translucent = !!int.F_TRANSLUCENT;
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      ...shared(lights),
      uColor: { value: color }, uNormal: { value: normal || blank }, uMasks1: { value: masks1 || blank }, uMasks2: { value: masks2 || blank },
      uFresnelWarp: { value: fresnel }, uDiffuseWarp: { value: diffuseWarp || blank },
      uHasNormal: { value: normal ? 1 : 0 }, uHasMasks1: { value: masks1 ? 1 : 0 }, uHasMasks2: { value: masks2 ? 1 : 0 },
      uHasDiffuseWarp: { value: diffuseWarp ? num('g_flDiffuseWarpBlendToFull', 1) > 0 || masks1 ? 1 : 0 : 0 },
      // the lower half of a warp is the plain ramp; the upper, a second one a mask can pick
      uWarpRow: { value: 0.75 },
      uAlphaTest: { value: int.F_ALPHA_TEST ? num('g_flAlphaTestReference', 0.5) : 0 },
      uSelfIllumOn: { value: int.F_SELF_ILLUM ? 1 : 0 },
      uCubeMask: { value: cubeMask || blank }, uHasCubeMask: { value: cubeMask ? 1 : 0 },
      uWarpFull: { value: num('g_flDiffuseWarpBlendToFull') }, uMetalFull: { value: num('g_flMetalnessBlendToFull') },
      uSelfIllumFull: { value: num('g_flSelfIllumBlendToFull') }, uSpecFull: { value: num('g_flSpecularBlendToFull') },
      uExpFull: { value: num('g_flSpecularExponentBlendToFull') },
      uSpecScale: { value: num('g_flSpecularScale', 1) }, uSpecExp: { value: num('g_flSpecularExponent', 20) },
      uRimScale: { value: num('g_flRimLightScale', 1) }, uCubeScale: { value: int.F_SPECULAR_CUBE_MAP ? num('g_flCubeMapScalar', 1) : 0 },
      uSpecColor: { value: new THREE.Color().fromArray(vec('g_vSpecularColor', [1, 1, 1])) },
      uRimColorM: { value: new THREE.Color().fromArray(vec('g_vRimLightColor', [1, 1, 1])) },
      uUvTransform: { value: new THREE.Vector4(scale[0], scale[1], offset[0], offset[1]) },
    },
    side: (from as THREE.MeshStandardMaterial).side,
    transparent: translucent,
    depthWrite: !translucent,
  });
}

/** Every hero material of a model swapped for the game's shader; the rest stay as the loader made them. */
export async function useHeroShader(gltf: GLTF, lights: HeroLights): Promise<void> {
  const made = new Map<THREE.Material, Promise<THREE.Material | null>>();
  const jobs: Promise<void>[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = ([] as THREE.Material[]).concat(mesh.material);
    jobs.push(Promise.all(list.map((m) => {
      if (!made.has(m)) made.set(m, heroMaterial(gltf, m, lights).catch(() => null));
      return made.get(m)!.then((x) => x || m);
    })).then((next) => { mesh.material = Array.isArray(mesh.material) ? next : next[0]; }));
  });
  await Promise.all(jobs);
}
