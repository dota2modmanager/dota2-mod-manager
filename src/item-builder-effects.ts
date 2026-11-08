/* The particle effects the item builder can put on top of an item: the effect's id, its name in
 * the picker, and the particle the game creates for it. What a pick then writes is
 * src/item-builder.ts, which callers import this through.
 *
 * Written by h6rd (https://github.com/h6rd) in #117, developed further with TheFleece
 * (https://github.com/TheFleece).
 * Copyright (C) 2026 h6rd
 * Copyright (C) 2026 TheFleece
 * SPDX-License-Identifier: GPL-3.0-or-later
 * The additional terms in NOTICE apply: whoever carries this code keeps both names here and in
 * the credits of the program it goes into.
 */
import { t } from './i18n.ts';
import { blockBounds, eachChild } from './schema.ts';

/** An effect the builder can add to an item: a particle it creates. Its name is the game's own
 * English one in every language, as players look effects up by it ("Frostbloom"); the four the
 * game names are its Attrib_Particle96, 163, 826 and 828, the other three are courier ambients. */
export type ItemEffect = { id: string; name: string; type: string; modifier: string };

/** Every effect the builder offers, in the order the picker lists them. */
export const ITEM_EFFECTS: ItemEffect[] = [
  {
    id: 'fire',
    name: 'Trail of Burning Doom',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_trail_lava/courier_trail_lava.vpcf',
  },
  {
    id: 'lightnings',
    name: 'Ionic Vapor',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_platinum_roshan/platinum_roshan_ambient.vpcf',
  },
  {
    id: 'frostbloom',
    name: 'Frostbloom',
    type: 'particle_create',
    modifier: 'particles/econ/seasonal/seasonal_ambient_silver.vpcf',
  },
  {
    id: 'snow',
    name: 'Snowdrift',
    type: 'particle_create',
    modifier: 'particles/econ/seasonal/seasonal_ambient_snow.vpcf',
  },
  {
    id: 'bubbles',
    name: 'Bubbles',
    type: 'particle_create',
    modifier: 'particles/econ/seasonal/seasonal_ambient_bubbles.vpcf',
  },
  {
    id: 'sand-storm',
    name: 'Desert Sands',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_roshan_desert_sands/baby_roshan_desert_sands_ambient.vpcf',
  },
  {
    id: 'ghost',
    name: 'Anniversary Ghost',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_f2p/courier_f2p_10th_anniversary_ambient.vpcf',
  },
];

/** The effect variants the synthetic cosmetics/items picker can apply. */
export function itemEffects(): { id: string; name: string }[] {
  return [{ id: '', name: t('Без эффекта') }, ...ITEM_EFFECTS.map(({ id, name }) => ({ id, name }))];
}

/** The visuals with an effect's particle created, after the ones they create already. */
export function appendItemEffect(visuals: string, effect: ItemEffect): string {
  const needle = String(effect.modifier || '').toLowerCase();
  if (needle && visuals.toLowerCase().includes(needle)) return visuals;
  const block = `"asset_modifier"\r\n{\r\n\t"type"\t\t"${effect.type}"\r\n\t"modifier"\t\t"${effect.modifier}"\r\n}`;
  // set from inside the walk, which is why they are widened by hand
  let after = null as number | null;
  let before = null as number | null;
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || c.key.toLowerCase() !== 'asset_modifier') return;
    const fields = new Map<string, string>();
    eachChild(visuals, c.body, (f) => { if (!f.isBlock) fields.set(f.key.toLowerCase(), f.value); });
    const type = (fields.get('type') || '').toLowerCase();
    if (type === 'particle_create') after = c.end;
    else if (after !== null && before === null) before = c.start;
  });
  const close = visuals.lastIndexOf('}');
  const at = before ?? after ?? close;
  if (at === -1) return visuals;
  const prefix = '\r\n\t';
  const suffix = before === null ? '\r\n' : '\r\n\t';
  return `${visuals.slice(0, at)}${prefix}${block}${suffix}${visuals.slice(at)}`;
}
