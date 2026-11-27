/* The map's ground as the game paints it. A terrain blend (multiblend.vfx) lays up to four
 * pictures over each other, sand path, grass, more grass, rock, by weights painted per vertex,
 * each picture in a tint of its own, and the whole under a painted vertex colour. The light copy
 * (crates/mm-core/src/looks/map_scene.rs) keeps the weights (_TEXCOORD_1), the softness of each
 * layer's edge (_TEXCOORD_2), the paint (_TEXCOORD_3), all three in the game's own channel order
 * (its vertex shader reads them as they are: at the Dire rune pond's floor the game's weights and
 * ours are both 0, 0, 0.95, RenderDoc 2026-11-27; read as blue-green-red, the first and third
 * layers traded places and cobbles covered the floors the game draws as smooth rock), and each
 * layer's picture, tint and scale and the tint mask in the material's extras; here the material's shader is
 * taught to blend them. Drawn with its first picture alone, as before, the map lost its paths.
 *
 * The dark look of the Optimization window darkens these grounds by the same factor the build
 * writes into the game's materials (map_optimize.rs DUSK, DARK). */
import * as THREE from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GroundLayer } from '../../api/content.ts';
import { litShader } from './map-light.ts';

interface Layer { texture: number; tint: [number, number, number]; scale: number }

/** A blended ground's uniforms, by layer, and what they held as the map has them. */
interface Painted {
  pictures: { value: THREE.Texture }[]; tints: { value: THREE.Vector3 }[]; tintsB: { value: THREE.Vector3 }[]; scales: { value: number }[];
  own: { picture: THREE.Texture; tint: THREE.Vector3; tintB: THREE.Vector3; scale: number }[]; base: number;
}

/** Every blended ground by its material's path, for another map's ground to go in. */
const painted = new Map<string, Painted>();

/** How much of its colour the ground keeps, shared by every ground: 1 in the game's own light. */
export const groundLight = { value: 1 };


/** Whether a material is a terrain blend the export kept the layers of. */
export const isGround = (m: THREE.Material): boolean => Array.isArray((m.userData as { layers?: unknown }).layers);

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** A layer's share where its painted weight meets its picture's height, over its softness. */
const EDGE = 'float edge(float h, float b, float s) { float lo = max(h - s, 0.0), hi = min(h + s, 1.0); return smoothstep(0.0, 1.0, clamp((b - lo) / max(hi - lo, 1e-4), 0.0, 1.0)); }';

/**
 * Teach a terrain blend's material to blend its layers as multiblend.vfx does (read from the
 * game's shader, 2026-11-25). Each layer above the first comes in where its painted weight rises
 * over the height in its picture's alpha, over a band as wide as the vertex's softness for it
 * (_TEXCOORD_2 halved), smoothstepped; each takes what the ones before it left, the first the rest.
 * A layer's colour is its picture under one of two tints, picked per pixel by its channel of the
 * tint mask; the whole under the painted vertex colour, in linear light. The pictures load through
 * the export's own parser; until they have, the material draws with its first picture.
 * `changed` asks for a frame.
 */
export async function paintGround(mat: THREE.MeshStandardMaterial, parser: GLTFParser, changed: () => void): Promise<void> {
  const data = mat.userData as { layers: Layer[]; tintMask?: number; vmat?: { Name?: string; VectorParams?: Record<string, number[]>; FloatParams?: Record<string, number> } };
  const layers = data.layers;
  const [pictures, mask] = await Promise.all([
    Promise.all(layers.map((l) => parser.getDependency('texture', l.texture).catch(() => null))) as Promise<(THREE.Texture | null)[]>,
    data.tintMask === undefined ? null : (parser.getDependency('texture', data.tintMask).catch(() => null) as Promise<THREE.Texture | null>),
  ]);
  if (pictures.some((p) => !p)) return;
  for (const p of pictures as THREE.Texture[]) {
    p.wrapS = p.wrapT = THREE.RepeatWrapping;
    p.colorSpace = THREE.SRGBColorSpace;
    p.needsUpdate = true;
  }
  if (mask) {
    mask.wrapS = mask.wrapT = THREE.RepeatWrapping;
    mask.colorSpace = THREE.NoColorSpace;
    mask.needsUpdate = true;
  }
  // a layer's second tint, where its mask is dark; its first where there is no mask
  const tintB = (k: number) => {
    const b = mask ? data.vmat?.VectorParams?.[`g_vColorTintB${k}`] : undefined;
    return b ? new THREE.Vector3(linear(b[0]), linear(b[1]), linear(b[2])) : new THREE.Vector3(...layers[k].tint);
  };
  // a layer's scale divides the map's UVs, as the game's Texture Scale does: 6 is a picture six
  // times the size of 1 (the larger the number, the larger the stones)
  const base = 1;
  const p: Painted = {
    pictures: pictures.map((x) => ({ value: x as THREE.Texture })),
    tints: layers.map((l) => ({ value: new THREE.Vector3(...l.tint) })),
    tintsB: layers.map((_, k) => ({ value: tintB(k) })),
    scales: layers.map((l) => ({ value: base / (l.scale || 1) })),
    own: layers.map((l, k) => ({ picture: pictures[k] as THREE.Texture, tint: new THREE.Vector3(...l.tint), tintB: tintB(k), scale: base / (l.scale || 1) })),
    base,
  };
  const name = String(data.vmat?.Name || '').toLowerCase();
  if (name) painted.set(name, p);
  mat.color.setRGB(1, 1, 1);
  // each layer's pictures turned by its own angle, about the middle of the picture
  const turn = layers.map((_, k) => THREE.MathUtils.degToRad(data.vmat?.FloatParams?.[`g_flTexCoordRotate${k}`] ?? 0));
  const f = (x: number) => x.toFixed(6);
  const uv = (k: number) => `mat2(${f(Math.cos(turn[k]))}, ${f(Math.sin(turn[k]))}, ${f(-Math.sin(turn[k]))}, ${f(Math.cos(turn[k]))}) * (vMapUv - 0.5) * uScale${k} + 0.5`;
  const channel = (k: number) => (mask ? `texture2D(uMask, uv${k}).${'xyzw'[k]}` : '1.0');
  const blend = [
    ...layers.map((_, k) => `vec2 uv${k} = ${uv(k)}; vec4 c${k} = texture2D(uLayer${k}, uv${k});`),
    'float rest = 1.0; float w;',
    ...layers.slice(1).map((_, i) => `w = min(rest, edge(c${i + 1}.a, vBlend.${'xyz'[i]}, vSoft.${'xyz'[i]})); vec3 g${i + 1} = w * c${i + 1}.rgb * mix(uTintB${i + 1}, uTint${i + 1}, ${channel(i + 1)}); rest -= w;`),
    `vec3 ground = rest * c0.rgb * mix(uTintB0, uTint0, ${channel(0)})${layers.slice(1).map((_, i) => ` + g${i + 1}`).join('')};`,
    // the painted colour is sRGB, as the game's vertex shader reads it
    'vec3 paint = mix(vPaint.rgb / 12.92, pow((vPaint.rgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, vPaint.rgb));',
  ].join('\n');
  mat.onBeforeCompile = (sh) => {
    layers.forEach((_, k) => {
      sh.uniforms[`uLayer${k}`] = p.pictures[k];
      sh.uniforms[`uTint${k}`] = p.tints[k];
      sh.uniforms[`uTintB${k}`] = p.tintsB[k];
      sh.uniforms[`uScale${k}`] = p.scales[k];
    });
    sh.uniforms.uGround = groundLight;
    sh.uniforms.uMask = { value: mask };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 _texcoord_1;\nattribute vec4 _texcoord_2;\nattribute vec4 _texcoord_3;\nvarying vec4 vBlend;\nvarying vec3 vSoft;\nvarying vec4 vPaint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlend = _texcoord_1;\nvSoft = max(_texcoord_2.xyz * 0.5, vec3(0.0001));\nvPaint = _texcoord_3;');
    const decl = layers.map((_, k) => `uniform sampler2D uLayer${k}; uniform vec3 uTint${k}, uTintB${k}; uniform float uScale${k};`).join('\n');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${decl}\nuniform sampler2D uMask;\nuniform float uGround;\nvarying vec4 vBlend;\nvarying vec3 vSoft;\nvarying vec4 vPaint;\n${EDGE}`)
      .replace('#include <map_fragment>', `${blend}\ndiffuseColor.rgb *= ground * paint * uGround;`);
    litShader(sh);
  };
  mat.customProgramCacheKey = () => `ground-${layers.length}-${mask ? 'mask' : ''}-${turn.map((t) => t.toFixed(3)).join(',')}`;
  mat.needsUpdate = true;
  changed();
}

const decoded = new Map<Uint8Array, Promise<THREE.Texture | null>>();
export async function pictureOf(png: Uint8Array): Promise<THREE.Texture | null> {
  let p = decoded.get(png);
  if (!p) {
    p = createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' })).then((bitmap) => {
      const t = new THREE.Texture(bitmap);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      t.needsUpdate = true;
      return t;
    }, () => null);
    decoded.set(png, p);
  }
  return p;
}

/**
 * Another map's ground in place of this one's (decor:ground's answer, by this map's material
 * paths), or this map's own again with null. A layer the other ground has not got keeps the last
 * it has: the shader was built for this ground's number of layers.
 */
export async function setGround(materials: Record<string, GroundLayer[]> | null, changed: () => void): Promise<void> {
  for (const [name, p] of painted) {
    const other = materials?.[name];
    for (let k = 0; k < p.pictures.length; k++) {
      const l = other?.[Math.min(k, other.length - 1)];
      const picture = l ? await pictureOf(l.png) : null;
      if (l && picture) {
        p.pictures[k].value = picture;
        p.tints[k].value = new THREE.Vector3(...l.tint);
        p.tintsB[k].value = p.tints[k].value;
        // a scale of 0: a picture with none of its own (a terrain's plain one) tiles as the layer did
        p.scales[k].value = l.scale ? 1 / l.scale : p.own[k].scale;
      } else {
        p.pictures[k].value = p.own[k].picture;
        p.tints[k].value = p.own[k].tint;
        p.tintsB[k].value = p.own[k].tintB;
        p.scales[k].value = p.own[k].scale;
      }
    }
  }
  changed();
}

/** The map's grounds forgotten, when its view closes. */
export function forgetGrounds(): void {
  painted.clear();
}
