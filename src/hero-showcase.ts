/* How the game stages a hero on its loadout, for the 3D preview (issue #417), out of the game's
 * own files rather than tuned by eye:
 *
 *  - the camera is panorama/layout/models/loadout/loadout_camera.vmdl's "loadout_camera_fullbody":
 *    straight in front of the hero, 668 units out and 80 up, looking level (read out of the model on
 *    2026-11-05; it is one keyframe, so it is written here);
 *  - the hero stands at the origin at its script's LoadoutScale (Juggernaut 0.85, Pudge 0.98);
 *  - its light, ambient, background colour and pedestal are its entry in
 *    scripts/npc/portraits_showcase.txt, where an arcana's own model has an entry of its own.
 *
 * Positions and directions go to the window in the GLB's space: the toolchain turns Source's
 * (x forward, y left, z up, inches) into (y, z, x) metres, which is why a hero faces +Z there. */
import { blockBounds, eachChild } from './schema.ts';

/** Inches to the GLB's metres. */
const METRE = 0.0254;
/** The loadout camera, in Source units: loadout_camera_fullbody's one keyframe. */
export const LOADOUT_CAMERA = { x: 668.17529, y: 0, z: 79.86814 };

/** A point or a direction, in Source's axes or the GLB's as the name using it says. */
export type Vec3 = [number, number, number];
/** A linear colour, 1 being the game's 255. */
export type Rgb = [number, number, number];

/** What the window stages the hero with. Colours are linear, 1 is the game's 255. */
export interface HeroStage {
  /** the hero's LoadoutScale */
  scale: number;
  /** the camera, in the GLB's metres */
  camera: Vec3;
  /** where the key light comes from, as a direction toward it, and its colour times its scale */
  key: { from: Vec3; color: Rgb } | null;
  ambient: { from: Vec3; color: Rgb } | null;
  /** the colour behind the hero */
  background: Rgb | null;
  /** the model the hero stands on, as items_game would name it */
  pedestal: string | null;
}

/** A point or direction in Source's axes, in the GLB's. */
export const toGlb = ([x, y, z]: Vec3, scale = 1): Vec3 => [y * scale, z * scale, x * scale];

const numbers = (s: string | undefined): number[] => (s || '').trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n));
const vec = (s: string | undefined): Vec3 | null => { const n = numbers(s); return n.length >= 3 ? [n[0], n[1], n[2]] : null; };
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** The way Source angles (pitch down, yaw, roll) look. */
export function forward(angles: Vec3): Vec3 {
  const [p, y] = [angles[0] * Math.PI / 180, angles[1] * Math.PI / 180];
  return [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)];
}

/** The fields of the first of `keys` that portraits_showcase.txt has an entry for, or null. */
export function showcaseEntry(text: string, keys: string[]): Map<string, string> | null {
  const found = new Map<string, Map<string, string>>();
  try {
    eachChild(text, blockBounds(text, 0), (c) => {
      if (!c.isBlock) return;
      const fields = new Map<string, string>();
      eachChild(text, c.body, (f) => { if (!f.isBlock) fields.set(f.key, f.value); });
      found.set(c.key.toLowerCase().replace(/\\/g, '/'), fields);
    });
  } catch {
    return null;
  }
  for (const k of keys) {
    const hit = found.get(k.toLowerCase().replace(/\\/g, '/'));
    if (hit) return hit;
  }
  return null;
}

/**
 * The stage for a hero.
 * @param showcase  portraits_showcase.txt, or null when the game has none
 * @param script    the hero's script, for its LoadoutScale
 * @param keys      the entries to look for, the most particular first: the body's model, then the hero
 */
export function heroStage(showcase: string | null, script: string | null, keys: string[]): HeroStage {
  const scale = Number(/"LoadoutScale"\s+"([\d.]+)"/i.exec(script || '')?.[1]) || 1;
  const e = showcase ? showcaseEntry(showcase, keys) : null;
  const rgb = (k: string, mult = 1): Rgb | null => { const n = vec(e?.get(k)); return n ? [n[0] / 255 * mult, n[1] / 255 * mult, n[2] / 255 * mult] : null; };
  const lightAt = vec(e?.get('PortraitLightPosition'));
  const keyColor = rgb('PortraitLightColor', Number(e?.get('PortraitLightScale')) || 1);
  const ambientAngles = vec(e?.get('PortraitAmbientDirection'));
  const ambientColor = rgb('PortraitAmbientColor', Number(e?.get('PortraitAmbientScale')) || 1);
  const bg = vec(e?.get('PortraitBackgroundColor1'));
  const model = e?.get('PortraitBackgroundModel') || '';
  return {
    scale,
    camera: toGlb([LOADOUT_CAMERA.x, LOADOUT_CAMERA.y, LOADOUT_CAMERA.z], METRE),
    // the light is aimed at the hero's middle, not its feet
    key: lightAt && keyColor ? { from: toGlb(unit([lightAt[0], lightAt[1], lightAt[2] - 80])), color: keyColor } : null,
    // the ambient direction is where it shines; it comes from the other way
    ambient: ambientAngles && ambientColor ? { from: toGlb(forward(ambientAngles).map((v) => -v) as Vec3), color: ambientColor } : null,
    background: bg ? [bg[0], bg[1], bg[2]] : null,
    pedestal: /^models\/[\w/.-]+\.vmdl$/i.test(model) ? model.toLowerCase() : null,
  };
}
