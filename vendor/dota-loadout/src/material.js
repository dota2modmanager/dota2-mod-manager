// Dota's hero shader (hero.vfx, pixel shader of the forward mode, read from the game's compiled
// shader) on three's Phong, which only gives the colour texture, the normal map, skinning and the
// alpha test here. Textures: masks R detail, G self-illumination, B rim; specular R specular,
// G metalness, B tint by base colour; the normal's blue carries the specular exponent mask (its z
// is rebuilt); the fresnel warp gives rim (R) and specular (B) strength by the angle to the eye.
//   detail      = detail × tint × detail mask × blend, as F_DETAIL says (None, Add, Add Self Illum, Mod2X):
//   albedo      = colour + detail (Add), colour × mix(1, 2 × detail, detail mask × blend) (Mod2X), or colour
//   diffuse     = half-Lambert key light (or the diffuse warp's ramp of it, where its mask says) × shadow
//                 + directional ambient + shadow colour in shadow
//   specular    = N·L × (L·R)^(exponent mask × exponent) × light × scale × specular mask
//                 × mix(colour, specular colour, tint mask) × max(fresnel B, metalness)
//   lit         = mix(albedo × diffuse + specular, specular, metalness)
//                 + rim mask × rim colour × ambient colour × rim scale × max(N·up, 0) × fresnel R
//               + cube map (F_SPECULAR_CUBE_MAP) of the reflection × scale × specular mask (or metalness),
//                 off a non-metal only at grazing angles (fresnel B), as Viper's wings and Marci's cloth look
//                 × mix(1, colour, max(tint mask, metalness)) — a metal reflects in its own colour
//   out         = mix(lit, albedo, self-illumination) + detail (Add Self Illum: the scrolling fire of
//                 Terrorblade's items, in his gem's colour over the colour's own, lit)
import * as THREE from 'three';

const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); BLACK.needsUpdate = true;
const GREY = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); GREY.needsUpdate = true;
// F_DETAIL's blends of the detail into the albedo, and what the pixel then is (by mode; other shaders'
// modes past Mod2X blend as Add with the detail's alpha as self-illumination, as before).
const DETAIL_ALBEDO = ['vec3 heroAlbedo = heroBase;', 'vec3 heroAlbedo = heroBase + heroDetailColor * heroDetail;', 'vec3 heroAlbedo = heroBase;',
  'vec3 heroAlbedo = heroBase * mix(vec3(1.0), 2.0 * heroDetailColor, clamp(heroDetail, 0.0, 1.0));'];
const DETAIL_OUT = ['outgoingLight = mix(heroLit, heroAlbedo, heroMasks.g);', 'outgoingLight = mix(heroLit, heroAlbedo, heroMasks.g);',
  'outgoingLight = mix(heroLit, heroAlbedo, heroMasks.g) + heroDetailColor * heroDetail;', 'outgoingLight = mix(heroLit, heroAlbedo, heroMasks.g);'];
const srgb = (c) => new THREE.Color().setRGB(...c, THREE.SRGBColorSpace);

// The game's axes from the scene's (glTF), for looking up the cube maps, which are in the game's.
const TO_SOURCE = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.PI / 2, 0, -Math.PI / 2, 'YXZ')).invert());

// m: a material of hero.json; texture(file, srgb) loads one of its textures, cube(file) a cube map
// from its strip of faces; time and light are uniforms shared by every material of the scene.
export function heroMaterial(m, texture, time, light, cube = null) {
  const material = new THREE.MeshPhongMaterial({
    map: m.color ? texture(m.color, true) : null, normalMap: m.normal ? texture(m.normal) : null,
    alphaMap: m.opacity ? texture(m.opacity) : null, alphaTest: m.alphaTest || 0, transparent: !!(m.translucent || m.additive || m.opacity && !m.alphaTest), depthWrite: !(m.translucent || m.additive || m.opacity && !m.alphaTest), side: THREE.DoubleSide,
  });
  // Compatibility for existing glTF PBR color factors.
  if (m.baseColor?.length >= 3) { material.color.setRGB(...m.baseColor.slice(0, 3)); material.opacity = m.baseColor[3] ?? 1; }
  // F_ENABLE_CLOAK: a cloaked body is not drawn (the game only bends what is behind it), a partly
  // cloaked one fades by its factor.
  if (m.cloak >= 1) material.visible = false;
  else if (m.cloak > 0) Object.assign(material, { transparent: true, opacity: 1 - m.cloak, depthWrite: false });
  // F_ADDITIVE_BLEND: glow layers (weapons, wings, Visage's spectral body) add to what lies behind.
  // The canvas is see-through (the page shows behind it): adding light must not add alpha too, or
  // a glow's dark edges turn the page behind them into the scene's black (Terrorblade's sword planes
  // as dark stars).
  if (m.additive) Object.assign(material, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  const uniforms = {
    ...light, tExponent: { value: m.exponent ? texture(m.exponent) : BLACK }, tMasks: { value: m.masks ? texture(m.masks) : BLACK }, tSpec: { value: m.specular ? texture(m.specular) : BLACK },
    tDetail: { value: m.detail ? texture(m.detail, true) : BLACK }, tFresnel: { value: m.fresnel ? texture(m.fresnel) : GREY }, uTime: time,
    uDetailScale: { value: new THREE.Vector2(...(m.detailScale?.length === 2 ? m.detailScale : [1, 1])) }, uDetailScroll: { value: new THREE.Vector2(...(m.detailScroll || [0, 0])) },
    uDetailBlend: { value: m.detailMode ? m.detailBlend ?? 1 : 0 }, uDetailTint: { value: srgb(m.detailTint || [1, 1, 1]) },
    uRimColor: { value: srgb(m.rimColor?.length === 3 ? m.rimColor : [1, 1, 1]).multiplyScalar(m.rimScale ?? 0) }, uSpecColor: { value: srgb(m.specColor?.length === 3 ? m.specColor : [1, 1, 1]) },
    uSpecExponent: { value: m.specExponent ?? 16 }, uSpecScale: { value: m.specScale ?? 1 },
    tDiffuseWarp: { value: m.diffuseWarp ? texture(m.diffuseWarp) : BLACK }, uDiffuseWarp: { value: m.diffuseWarp ? 1 : 0 },
    tCube: { value: m.cube && cube ? cube(m.cube) : null }, uCubeScale: { value: m.cubeScale ?? 0 }, uToSource: { value: TO_SOURCE },
  };
  const useCube = !!(m.cube && cube);
  // Missing environment lighting must not make the reflective parts black.
  const missingReflection = m.previewLighting && m.expectsReflectionCube;
  uniforms.uMetalness = { value: useCube ? 1 : m.metalnessWithoutCube ?? (missingReflection ? 0.45 : 1) };
  uniforms.uPreviewLighting = { value: m.previewLighting ? 1 : 0 };
  material.customProgramCacheKey = () => JSON.stringify([!!m.color, !!m.exponent, !!m.normal, m.detailMode, useCube, !!m.cubeByMetalness, !!m.unlit]);
  material.userData.hero = uniforms;
  // The hero's prismatic gem colours the detail (and the specular) of the materials that read it;
  // without one they take their own colour back. hex: '#rrggbb' or null.
  if (m.detailGem || m.specGem) material.userData.gem = (hex) => {
    const c = hex ? new THREE.Color(hex) : null;
    if (m.detailGem) uniforms.uDetailTint.value.copy(c || srgb(m.detailTint || [1, 1, 1]));
    if (m.specGem) uniforms.uSpecColor.value.copy(c || srgb(m.specGem));
  };
  if (m.specGem) uniforms.uSpecColor.value.copy(srgb(m.specGem));
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
#define USE_PACKED_NORMALMAP
uniform sampler2D tExponent, tMasks, tSpec, tDetail, tFresnel, tDiffuseWarp; uniform float uTime, uDetailBlend, uSpecExponent, uSpecScale, uDiffuseWarp, uCubeScale; uniform vec2 uDetailScale, uDetailScroll;
uniform float uMetalness, uPreviewLighting;
uniform mat3 uToSource;${useCube ? '\nuniform samplerCube tCube;' : ''}
uniform vec3 uRimColor, uSpecColor, uDetailTint, uLightDir, uLightColor, uAmbientDir, uAmbientColor, uAmbientTint, uShadowColor, uUp;`)
      .replace('#include <opaque_fragment>', `${m.color ? '' : 'vec2 vMapUv = vec2(0.0);'}
vec4 heroMasks = texture2D(tMasks, vMapUv), heroSpec = texture2D(tSpec, vMapUv), heroDetailTex = texture2D(tDetail, vMapUv * uDetailScale + fract(uDetailScroll * uTime));
vec3 heroBase = diffuseColor.rgb, heroV = normalize(vViewPosition), heroR = reflect(-heroV, normal);
vec4 heroWarp = texture2D(tFresnel, vec2(clamp(dot(normal, heroV), 0.0, 1.0), 0.5));
float heroDetail = heroMasks.r * uDetailBlend, heroNL = dot(normal, uLightDir), heroExponent = uSpecExponent * ${m.exponent ? 'texture2D(tExponent, vMapUv).r' : m.normal ? 'texture2D(normalMap, vNormalMapUv).b' : '1.0'};
vec3 heroDetailColor = heroDetailTex.rgb * uDetailTint;
${DETAIL_ALBEDO[m.detailMode] ?? 'vec3 heroAlbedo = heroBase + heroDetailColor * heroDetail;'}
float heroShadow = 1.0;
#if NUM_DIR_LIGHT_SHADOWS > 0
heroShadow = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
#endif
float heroHalf = heroNL * 0.5 + 0.5;
vec3 heroRamp = mix(vec3(heroHalf), texture2D(tDiffuseWarp, vec2(heroHalf, 0.5)).rgb, uDiffuseWarp * heroMasks.a);
vec3 heroDiffuse = heroRamp * heroShadow * uLightColor + clamp(dot(uAmbientDir, normal), 0.0, 1.0) * uAmbientColor + (1.0 - heroShadow) * uShadowColor;
// Keep the native metal mask. Without the game's lighting stages, dielectric
// highlights need a bounded gain, and near-zero exponents gloss entire limbs.
float dielectricPreview = uPreviewLighting * (1.0 - heroSpec.g);
float previewExponent = mix(heroExponent, max(heroExponent, 5.0), dielectricPreview);
float previewGain = mix(uSpecScale, min(uSpecScale, 0.65), dielectricPreview);
vec3 heroSpecular = clamp(heroNL, 0.0, 1.0) * pow(max(dot(uLightDir, heroR), 0.001), previewExponent) * uLightColor * previewGain * heroSpec.r * mix(heroBase, uSpecColor, heroSpec.b) * max(heroWarp.b, heroSpec.g);
vec3 heroLit = mix(heroAlbedo * heroDiffuse + heroSpecular, heroSpecular, heroSpec.g * uMetalness) + heroMasks.b * uRimColor * uAmbientTint * max(dot(normal, uUp), 0.0) * heroWarp.r;
${useCube ? `heroLit += textureCube(tCube, uToSource * inverseTransformDirection(heroR, viewMatrix)).rgb * uCubeScale * ${m.cubeByMetalness ? 'heroSpec.g' : 'heroSpec.r * mix(heroWarp.b, 1.0, heroSpec.g)'} * mix(vec3(1.0), heroBase, max(heroSpec.b, heroSpec.g));` : ''}
${m.unlit ? 'outgoingLight = heroBase + heroDetailColor * heroDetail;' : DETAIL_OUT[m.detailMode] ?? 'outgoingLight = mix(heroLit, heroAlbedo, clamp(heroDetailTex.a * heroDetail + heroMasks.g, 0.0, 1.0));'}
#include <opaque_fragment>`);
  };
  return material;
}
