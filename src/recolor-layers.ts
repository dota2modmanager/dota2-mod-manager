/* A hero in colours of the user's choosing, part by part (issue #422): each ability's effect and its
 * icon, the hero's other effects, the hero's icons and portrait, and the effects of the items picked
 * for him in the item builder. Each part is a layer with a colour of its own and its own switch,
 * and the whole recolour is one pak (src/hero-paint-service.ts).
 *
 * What belongs to an ability is read off the game's file names: Valve names an ability's particles
 * after it (particles/units/heroes/hero_juggernaut/juggernaut_blade_fury_glow.vpcf for
 * juggernaut_blade_fury), and its icon is panorama/images/spellicons/<ability>_png.vtex_c. The
 * ability list itself is the hero's script (scripts/npc/heroes/npc_dota_hero_<name>.txt). Particles
 * no ability claims are the hero's other effects: the attack, the crit, the portrait. An item's
 * effect is every particle its visuals name, with the children those particles create (RERL).
 *
 * The body is the colour textures of his model's materials (materials/models/heroes/<model folder>/,
 * *_color_*.vtex_c), the folder his script's "Model" is in. An item's own colour is the colour
 * textures its model's materials name (`itemModel:<id>`), apart from its effect.
 *
 * Particles take the colour through src/recolor.ts (the colours written in them move to the chosen
 * hue); pictures and textures through `shadePixels` below, the same move pixel by pixel. */
import { shade, type Rgb } from './recolor.ts';
import { readLoadoutMaterial } from './loadout-material.ts';
import { references } from './resource.ts';

/** What a layer recolours. */
export type LayerKind = 'ability' | 'abilityIcon' | 'effects' | 'portrait' | 'body' | 'item' | 'itemModel';

/** One part of a hero that takes a colour of its own. */
export interface RecolorLayer {
  /** `ability:<name>`, `abilityIcon:<name>`, `effects`, `portrait`, `body`, `item:<id>`, `itemModel:<id>` */
  id: string;
  kind: LayerKind;
  /** the ability's or the item's name, for the window to word */
  name?: string;
  /** the game's files the layer rewrites, in pak01 */
  files: string[];
}

const ABILITY = /"Ability\d+"\s+"([a-z0-9_]+)"/g;
// a talent, a placeholder slot, or nothing at all: no effect and no icon of its own
const NOT_AN_ABILITY = /^(special_bonus_|generic_hidden|.*_empty\d*$|dota_empty_ability)/;

/** The hero's abilities, in his script's order, once each; an Ability Draft copy (invoker_emp_ad) goes with its ability. */
export function heroAbilities(heroScript: string): string[] {
  const out: string[] = [];
  for (const m of heroScript.matchAll(ABILITY)) if (!NOT_AN_ABILITY.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
  return out.filter((a) => !(a.endsWith('_ad') && out.includes(a.slice(0, -3))));
}

/** The folder of the hero's model in his script, `juggernaut` for models/heroes/juggernaut/juggernaut.vmdl; null when it is not one of models/heroes. */
export function heroModelFolder(heroScript: string): string | null {
  return /"Model"\s+"models\/heroes\/([a-z0-9_]+)\//i.exec(heroScript)?.[1].toLowerCase() ?? null;
}

const flat = (s: string) => s.replace(/_/g, '');
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.vpcf_c$/, '');

// heroes whose particle folder is not hero_<npc name>, or that name only by their underscores
// (hero_crystalmaiden), counted over the game 2026-11-03; abyssal_underlord has none of his own
const FOLDER: Record<string, string> = { drow_ranger: 'drow', naga_siren: 'siren', vengefulspirit: 'vengeful' };

/** The folder a hero's own particles are in. */
export function heroParticleFolder(paths: Iterable<string>, hero: string): string {
  const named = FOLDER[hero];
  if (named) return `particles/units/heroes/hero_${named}/`;
  const want = [`particles/units/heroes/hero_${hero}/`, `particles/units/heroes/hero_${flat(hero)}/`];
  for (const p of paths) for (const w of want) if (p.startsWith(w)) return w;
  return want[0];
}

/** Whether a particle's name says it belongs to an ability: by the whole name, or by what follows
 *  the hero's (crystal_maiden_crystal_nova by maiden_crystal_nova_*), when that part is long enough
 *  not to turn up in others' names. */
function claims(ability: string, hero: string, particle: string): boolean {
  const name = flat(base(particle));
  if (name.startsWith(flat(ability))) return true;
  const short = ability.startsWith(`${hero}_`) ? flat(ability.slice(hero.length + 1)) : '';
  // past the hero's own name, so invoker_invoke does not claim every invoker_* file
  const rest = name.startsWith(flat(hero)) ? name.slice(flat(hero).length) : name;
  return short.length >= 6 && rest.includes(short);
}

/**
 * The layers a hero has, from the paths in pak01. A layer with no files is left out: a hero with no
 * picture for an ability, or an ability with no particle of its own, shows no row for it.
 * @param hero  the hero's name in his npc name, `juggernaut` for npc_dota_hero_juggernaut
 * @param items the items he wears, with the particles their visuals name and their model's colour textures
 * @param model the folder of his model (`heroModelFolder`), for the body's textures
 */
export function heroLayers(paths: Iterable<string>, hero: string, abilities: string[], items: { id: string; name: string; particles: string[]; textures?: string[] }[] = [], model: string | null = null): RecolorLayer[] {
  const all = [...paths];
  const folder = heroParticleFolder(all, hero);
  const own = all.filter((p) => p.startsWith(folder) && p.endsWith('.vpcf_c'));
  const claimed = new Set<string>();
  const layers: RecolorLayer[] = [];
  // the longest name first, so juggernaut_omni_slash_scepter would not go to an omni_slash before it
  for (const ability of [...abilities].sort((a, b) => b.length - a.length)) {
    const files = own.filter((p) => !claimed.has(p) && claims(ability, hero, p));
    files.forEach((p) => claimed.add(p));
    if (files.length) layers.push({ id: `ability:${ability}`, kind: 'ability', name: ability, files });
  }
  layers.sort((a, b) => abilities.indexOf(a.name!) - abilities.indexOf(b.name!));
  const rest = own.filter((p) => !claimed.has(p));
  if (rest.length) layers.push({ id: 'effects', kind: 'effects', files: rest });
  const present = new Set(all);
  for (const ability of abilities) {
    const icon = `panorama/images/spellicons/${ability}_png.vtex_c`;
    if (present.has(icon)) layers.push({ id: `abilityIcon:${ability}`, kind: 'abilityIcon', name: ability, files: [icon] });
  }
  const pictures = ['heroes', 'heroes/icons', 'heroes/selection'].map((d) => `panorama/images/${d}/npc_dota_hero_${hero}_png.vtex_c`).filter((p) => present.has(p));
  if (pictures.length) layers.push({ id: 'portrait', kind: 'portrait', files: pictures });
  if (model) {
    const dir = `materials/models/heroes/${model}/`;
    const body = all.filter((p) => p.startsWith(dir) && !p.slice(dir.length).includes('/') && /_color_(psd|tga|png)_[0-9a-f]+\.vtex_c$/.test(p));
    if (body.length) layers.push({ id: 'body', kind: 'body', files: body });
  }
  for (const item of items) {
    const files = item.particles.map((p) => p.toLowerCase().replace(/\.vpcf$/, '.vpcf_c')).filter((p) => present.has(p));
    if (files.length) layers.push({ id: `item:${item.id}`, kind: 'item', name: item.name, files: [...new Set(files)] });
    // after the body's: an item's own colour wins over the body's on a texture they share
    const textures = (item.textures ?? []).filter((p) => present.has(p));
    if (textures.length) layers.push({ id: `itemModel:${item.id}`, kind: 'itemModel', name: item.name, files: [...new Set(textures)] });
  }
  return layers;
}

/**
 * A particle and the particles it creates, followed down the tree once each.
 * @param refs the particles a file names (src/resource.ts references), compiled paths
 */
export function withChildren(roots: string[], refs: (path: string) => string[]): string[] {
  const seen = new Set<string>();
  const walk = (p: string) => {
    if (seen.has(p)) return;
    seen.add(p);
    for (const r of refs(p)) if (r.endsWith('.vpcf_c')) walk(r);
  };
  roots.forEach(walk);
  return [...seen];
}

/**
 * Pixels moved to the chosen colour in place, as `shade` moves a particle's colours: greys stay,
 * the rest take the chosen hue. `rgba` is four bytes a pixel; `bgra` says the red and blue are
 * swapped, as Electron's bitmaps have them on Windows.
 */
export function shadePixels(pixels: Buffer, target: Rgb, { bgra = false }: { bgra?: boolean } = {}): number {
  const [r, b] = bgra ? [2, 0] : [0, 2];
  let changed = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const from: Rgb = [pixels[i + r], pixels[i + 1], pixels[i + b]];
    const to = shade(from, target);
    if (to[0] === from[0] && to[1] === from[1] && to[2] === from[2]) continue;
    pixels[i + r] = to[0];
    pixels[i + 1] = to[1];
    pixels[i + b] = to[2];
    changed++;
  }
  return changed;
}

/**
 * The colour textures a model's materials name, as compiled paths: a model names its meshes and
 * materials (RERL), a material its textures, and the colour is g_tColor. An item's own colour.
 */
export function modelColorTextures(models: string[], read: (path: string) => Buffer | null): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const queue = models.map((m) => m.toLowerCase().replace(/_c$/, ''));
  for (let i = 0; i < queue.length && seen.size < 256; i++) {
    const p = queue[i];
    if (seen.has(p)) continue;
    seen.add(p);
    const file = read(`${p}_c`);
    if (!file) continue;
    if (p.endsWith('.vmat')) {
      const color = readLoadoutMaterial(file)?.textures.g_tColor;
      if (color) out.add(`${color.toLowerCase().replace(/_c$/, '')}_c`);
      continue;
    }
    try {
      queue.push(...references(file).map((r) => r.toLowerCase().replace(/_c$/, '')).filter((r) => /\.(vmat|vmesh)$/.test(r)));
    } catch { /* a file that names nothing */ }
  }
  return [...out];
}
