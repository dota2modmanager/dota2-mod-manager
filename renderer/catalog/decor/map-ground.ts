/* The map's ground as the game paints it. A terrain blend (multiblend.vfx) lays up to four
 * pictures over each other, sand path, grass, more grass, rock, by weights painted per vertex,
 * each picture in a tint of its own, and the whole under a painted vertex colour. The light copy
 * (crates/mm-core/src/looks/map_scene.rs) keeps the weights (_TEXCOORD_1), the paint (_TEXCOORD_3) and
 * each layer's picture, tint and scale in the material's extras; here the material's shader is
 * taught to blend them. Drawn with its first picture alone, as before, the map lost its paths.
 *
 * The dark look of the Optimization window darkens these grounds by the same factor the build
 * writes into the game's materials (map_optimize.rs DUSK, DARK). */
import * as THREE from 'three';
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GroundLayer } from '../../api/content.ts';

interface Layer { texture: number; tint: [number, number, number]; scale: number }

/** A blended ground's uniforms, by layer, and what they held as the map has them. */
interface Painted { pictures: { value: THREE.Texture }[]; tints: { value: THREE.Vector3 }[]; scales: { value: number }[]; own: { picture: THREE.Texture; tint: THREE.Vector3; scale: number }[]; base: number }

/** Every blended ground by its material's path, for another map's ground to go in. */
const painted = new Map<string, Painted>();

/** How much of its colour the ground keeps, shared by every ground: 1 in the game's own light. */
export const groundLight = { value: 1 };


/** Whether a material is a terrain blend the export kept the layers of. */
export const isGround = (m: THREE.Material): boolean => Array.isArray((m.userData as { layers?: unknown }).layers);

/**
 * Teach a terrain blend's material to blend its layers. The pictures load through the export's
 * own parser; until they have, the material draws with its first picture. `changed` asks for a frame.
 */
export async function paintGround(mat: THREE.MeshStandardMaterial, parser: GLTFParser, changed: () => void): Promise<void> {
  const layers = (mat.userData as { layers: Layer[] }).layers;
  const pictures = await Promise.all(layers.map((l) => parser.getDependency('texture', l.texture).catch(() => null))) as (THREE.Texture | null)[];
  if (pictures.some((p) => !p)) return;
  for (const p of pictures as THREE.Texture[]) {
    p.wrapS = p.wrapT = THREE.RepeatWrapping;
    p.colorSpace = THREE.SRGBColorSpace;
    p.needsUpdate = true;
  }
  // the second layer's scale is the one the map's UVs were drawn at with the first picture alone
  const base = layers[1]?.scale || layers[0].scale || 1;
  const p: Painted = {
    pictures: pictures.map((x) => ({ value: x as THREE.Texture })),
    tints: layers.map((l) => ({ value: new THREE.Vector3(...l.tint) })),
    scales: layers.map((l) => ({ value: base / (l.scale || 1) })),
    own: layers.map((l, k) => ({ picture: pictures[k] as THREE.Texture, tint: new THREE.Vector3(...l.tint), scale: base / (l.scale || 1) })),
    base,
  };
  const name = String((mat.userData as { vmat?: { Name?: string } }).vmat?.Name || '').toLowerCase();
  if (name) painted.set(name, p);
  mat.color.setRGB(1, 1, 1);
  mat.onBeforeCompile = (sh) => {
    layers.forEach((_, k) => {
      sh.uniforms[`uLayer${k}`] = p.pictures[k];
      sh.uniforms[`uTint${k}`] = p.tints[k];
      sh.uniforms[`uScale${k}`] = p.scales[k];
    });
    sh.uniforms.uGround = groundLight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 _texcoord_1;\nattribute vec4 _texcoord_3;\nvarying vec4 vBlend;\nvarying vec4 vPaint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlend = _texcoord_1;\nvPaint = _texcoord_3;');
    const decl = layers.map((_, k) => `uniform sampler2D uLayer${k}; uniform vec3 uTint${k}; uniform float uScale${k};`).join('\n');
    const sample = (k: number) => `texture2D(uLayer${k}, vMapUv * uScale${k}).rgb * uTint${k}`;
    const blend = [`vec3 ground = ${sample(0)};`, ...layers.slice(1).map((_, i) => `ground = mix(ground, ${sample(i + 1)}, clamp(vBlend.${'xyz'[i]}, 0.0, 1.0));`)].join('\n');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${decl}\nuniform float uGround;\nvarying vec4 vBlend;\nvarying vec4 vPaint;`)
      .replace('#include <map_fragment>', `${blend}\ndiffuseColor.rgb *= ground * vPaint.rgb * uGround;`);
  };
  mat.customProgramCacheKey = () => `ground-${layers.length}`;
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
        // a scale of 0: a picture with none of its own (a terrain's plain one) tiles as the layer did
        p.scales[k].value = l.scale ? p.base / l.scale : p.own[k].scale;
      } else {
        p.pictures[k].value = p.own[k].picture;
        p.tints[k].value = p.own[k].tint;
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
