/* A hero's paint finer than a layer, as the build reads it (crates/mm-core/src/looks/paint_recipe.rs):
 * a key names a layer, one part of its model (`body@helmet_color`: the meshes drawn from one colour
 * texture) and one colour zone of its texture (`body~light`); a value is a colour and its mode, or
 * `keep`, then the material: metalness, gloss, shine, rim light and detail (the pattern a detail
 * texture lays over the colour, as an arcana's glow), 0 to 100.
 *
 *   '#202020:full;m=100;g=90;s=100'   black chrome
 *
 * The more precise key wins: zone over part over layer. The 3D preview's shader draws each pixel by
 * its zone the same way (vendor/dota-loadout/src/material.js, paintZone). */
import { fromHex, type Rgb } from '../arcana/tint.ts';
import { hsv01, modeNumber, PAINT_MODES, type PaintMode } from './paint-mode.ts';

/** Near black, grey (metal, bone, white), and seven hues: the zones a texture's own colours fall in. */
export const ZONES = ['dark', 'light', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'] as const;
export type Zone = typeof ZONES[number];

/** The material's channels, in the order a value names them and the shader reads them. */
export const MATS = ['m', 'g', 's', 'r', 'd'] as const;
export type Mats = (number | null)[];
export const NO_MATS: Mats = [null, null, null, null, null];

/** What one key gives: a colour (null: the texture's own) and its mode, the light end of a
 * gradient map (mode grad: dark to `hex`, light to `to`), and the material. */
export interface Look { hex: string | null; mode: PaintMode; mats: Mats; to?: string | null; at?: number | null }

/** The zone a pixel's own colour (0-255) is in, by the build's thresholds. */
export function zoneOf(rgb: Rgb): number {
  const [h, s, v] = hsv01(rgb);
  if (v < 0.2) return 0;
  if (s < 0.18) return 1;
  if (h < 0.042 || h >= 0.92) return 2;
  if (h < 0.11) return 3;
  if (h < 0.19) return 4;
  if (h < 0.45) return 5;
  if (h < 0.53) return 6;
  if (h < 0.72) return 7;
  return 8;
}

/** A value read; null for one that is not one or changes nothing. */
export function parseLook(value: string): Look | null {
  const [head, ...rest] = value.split(';');
  const look: Look = { hex: null, mode: 'tint', mats: [...NO_MATS] };
  if (head !== 'keep') {
    const m = /^(#[0-9a-f]{6})(?::(tint|keep|full|rgb|grad))?$/i.exec(head);
    if (!m) return null;
    look.hex = m[1].toLowerCase();
    look.mode = (m[2]?.toLowerCase() as PaintMode | undefined) ?? 'tint';
  }
  for (const p of rest) {
    const t = /^t=([0-9a-f]{6})$/i.exec(p);
    if (t) { look.to = `#${t[1].toLowerCase()}`; continue; }
    const b = /^b=(\d{1,3})$/.exec(p);
    if (b) { if (Number(b[1]) > 100) return null; look.at = Number(b[1]); continue; }
    const m = /^([mgsrd])=(\d{1,3})$/.exec(p);
    const n = m ? Number(m[2]) : NaN;
    if (!m || n > 100) return null;
    look.mats[MATS.indexOf(m[1] as typeof MATS[number])] = n;
  }
  return look.hex || look.mats.some((x) => x !== null) ? look : null;
}

/** A look as the window sends it; null when it changes nothing. */
export function lookValue(look: Look): string | null {
  const mats = look.mats.flatMap((n, i) => (n === null ? [] : [`${MATS[i]}=${Math.round(Math.min(100, Math.max(0, n)))}`]));
  if (!look.hex && !mats.length) return null;
  const head = look.hex ? (look.mode === 'tint' ? look.hex.toLowerCase() : `${look.hex.toLowerCase()}:${look.mode}`) : 'keep';
  const grad = look.hex && look.mode === 'grad';
  const to = [...(grad && look.to ? [`t=${look.to.replace('#', '').toLowerCase()}`] : []), ...(grad && look.at != null ? [`b=${Math.round(look.at)}`] : [])];
  return [head, ...to, ...mats].join(';');
}

export interface Key { layer: string; part: string | null; zone: Zone | null }

export function splitKey(key: string): Key {
  const [rest, zone] = key.split('~');
  const at = rest.indexOf('@');
  return {
    layer: at < 0 ? rest : rest.slice(0, at),
    part: at < 0 ? null : rest.slice(at + 1),
    zone: ZONES.includes(zone as Zone) ? zone as Zone : null,
  };
}

export const keyOf = (layer: string, part: string | null = null, zone: Zone | null = null): string =>
  `${layer}${part ? `@${part}` : ''}${zone ? `~${zone}` : ''}`;

/** The part a colour texture is, out of its compiled name, as the build has it. */
export const partOf = (texture: string): string =>
  (texture.split('/').pop() ?? texture).toLowerCase().replace(/_(psd|tga|png|jpg)_[0-9a-f]+\.vtex_c$/, '').replace('.vtex_c', '').replace(/[^a-z0-9_]/g, '_').slice(0, 80);

/** A part's name for people: helmet for helmet_color. */
export const partName = (part: string): string => part.replace(/_(color|colour|diffuse|albedo)$/, '').replace(/_/g, ' ').trim() || part;

/** `b` over `a`: what it sets wins. */
function over(a: Look | null, b: Look): Look {
  if (!a) return { ...b, mats: [...b.mats] };
  return { hex: b.hex ?? a.hex, mode: b.hex ? b.mode : a.mode, to: b.hex ? b.to : a.to, at: b.hex ? b.at : a.at, mats: a.mats.map((x, i) => b.mats[i] ?? x) };
}

/** What one texture gets: its layer's and part's look, and each zone's over it. */
export interface Recipe { base: Look | null; zones: (Look | null)[] }

export function recipeOf(values: Readonly<Record<string, string>>, layer: string, part: string): Recipe {
  let base: Look | null = null, own: Look | null = null;
  const zones: (Look | null)[] = ZONES.map(() => null), ownZones: (Look | null)[] = ZONES.map(() => null);
  for (const [k, v] of Object.entries(values)) {
    const key = splitKey(k);
    if (key.layer !== layer || (key.part && key.part !== part)) continue;
    const look = parseLook(v);
    if (!look) continue;
    const z = key.zone ? ZONES.indexOf(key.zone) : -1;
    if (z < 0) { if (key.part) own = look; else base = look; } else if (key.part) ownZones[z] = look; else zones[z] = look;
  }
  return {
    base: own ? over(base, own) : base,
    zones: zones.map((z, i) => (ownZones[i] ? over(z, ownZones[i]!) : z)),
  };
}

export const emptyRecipe = (r: Recipe): boolean => !r.base && r.zones.every((z) => !z);

/**
 * The recipe as the shader reads it: per zone, [h, s, v, mode] (mode 0 off; 8 more where the zone
 * asked for the colour itself, so its greys take it too; 5 a gradient map), the light end of the
 * gradient as sRGB 0-1 with where its two colours meet (0-1), and [metalness, gloss, shine, rim, detail] in 0-1, -1 where the material's own stays.
 */
export interface ShaderPaint { tones: number[][]; mats: number[][]; tos: number[][] }

export function shaderPaint(r: Recipe): ShaderPaint {
  const tones: number[][] = [], mats: number[][] = [], tos: number[][] = [];
  ZONES.forEach((_, z) => {
    const zone = r.zones[z];
    const color = zone?.hex ? { hex: zone.hex, mode: zone.mode, to: zone.to, at: zone.at, forced: true } : r.base?.hex ? { hex: r.base.hex, mode: r.base.mode, to: r.base.to, at: r.base.at, forced: false } : null;
    const to = color?.to ? fromHex(color.to) : null;
    tos.push([...(to ? to.map((n) => n / 255) : rgbOr(color?.hex)), (color?.at ?? 50) / 100]);
    const rgb = color ? fromHex(color.hex) : null;
    tones.push(rgb && color ? [...hsv01(rgb), modeNumber(PAINT_MODES.includes(color.mode) ? color.mode : 'tint') + (color.forced ? 8 : 0)] : [0, 0, 0, 0]);
    mats.push([0, 1, 2, 3, 4].map((i) => { const n = zone?.mats[i] ?? r.base?.mats[i] ?? null; return n === null ? -1 : n / 100; }));
  });
  return { tones, mats, tos };
}

/** A gradient with no light end goes to its own colour. */
function rgbOr(hex: string | undefined): number[] {
  const rgb = hex ? fromHex(hex) : null;
  return rgb ? rgb.map((n) => n / 255) : [0, 0, 0];
}

/** Ready materials: the masks a look sets, null where the game's own stays. */
export const MATERIAL_PRESETS: { key: string; icon: string; mats: Mats }[] = [
  { key: 'game', icon: 'restart_alt', mats: [null, null, null, null, null] },
  { key: 'matte', icon: 'texture', mats: [0, 5, 5, null, null] },
  { key: 'gloss', icon: 'auto_awesome', mats: [0, 80, 90, null, null] },
  { key: 'metal', icon: 'hardware', mats: [100, 60, 70, null, null] },
  { key: 'chrome', icon: 'diamond', mats: [100, 100, 100, 60, 0] },
];
