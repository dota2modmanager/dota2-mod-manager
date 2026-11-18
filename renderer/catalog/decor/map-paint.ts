/* A catalog terrain that is a pak of materials, put on the map already loaded rather than a map
 * exported again (crates/mm-core/src/looks/map_paint.rs reads the pak): what it hides goes dark, every
 * other material it brings takes its picture and tint, and what it does to the ground comes back
 * as layers for the ground's own blend (map-ground.ts setGround). Each material remembers what it
 * was, so picking the default map again gives the map back as it loaded. */
import * as THREE from 'three';
import type { GroundLayer, TerrainPaint } from '../../api/decor.ts';
import { pictureOf } from './map-ground.ts';

interface Was { color: THREE.Color; map: THREE.Texture | null; visible: boolean }

export interface Painter {
  /** a material of the map, under its path */
  add(m: THREE.Material): void;
  /** the pak put on, or taken off with null; the ground's layers it brings, by the ground's path */
  paint(p: TerrainPaint | null): Promise<Record<string, GroundLayer[]> | null>;
}

const nameOf = (m: THREE.Material): string => String((m.userData as { vmat?: { Name?: string } }).vmat?.Name || '').toLowerCase();

export function painter(isGround: (m: THREE.Material) => boolean): Painter {
  const byName = new Map<string, THREE.MeshStandardMaterial[]>();
  const was = new Map<THREE.MeshStandardMaterial, Was>();
  const remember = (m: THREE.MeshStandardMaterial) => {
    if (!was.has(m)) was.set(m, { color: m.color.clone(), map: m.map, visible: m.visible });
  };
  const restore = () => {
    for (const [m, w] of was) {
      m.color.copy(w.color);
      if (m.map !== w.map) { m.map = w.map; m.needsUpdate = true; }
      m.visible = w.visible;
    }
    was.clear();
  };
  return {
    add(m) {
      const n = nameOf(m);
      if (!n) return;
      const list = byName.get(n) ?? [];
      if (!list.includes(m as THREE.MeshStandardMaterial)) list.push(m as THREE.MeshStandardMaterial);
      byName.set(n, list);
    },
    async paint(p) {
      restore();
      if (!p) return null;
      for (const n of p.hidden) for (const m of byName.get(n) ?? []) { remember(m); m.visible = false; }
      const grounds: Record<string, GroundLayer[]> = { ...p.grounds };
      for (const [n, look] of Object.entries(p.plain)) {
        const mats = byName.get(n) ?? [];
        // a ground the pak draws with one picture: the blend takes it on every layer
        if (mats.some(isGround)) {
          if (look.png) grounds[n] = [{ png: look.png, tint: look.tint, scale: 0 }];
          continue;
        }
        const picture = look.png ? await pictureOf(look.png) : null;
        for (const m of mats) {
          remember(m);
          m.color.setRGB(look.tint[0], look.tint[1], look.tint[2]);
          if (picture && m.map !== picture) {
            picture.flipY = false;
            m.map = picture;
            m.needsUpdate = true;
          }
        }
      }
      return Object.keys(grounds).length ? grounds : null;
    },
  };
}
