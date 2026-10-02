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

/** An effect the builder can add to an item: a particle it creates. */
export type ItemEffect = { id: string; name: string; type: string; modifier: string };

/** Every effect the builder offers, in the order the picker lists them. */
export const ITEM_EFFECTS: ItemEffect[] = [
  {
    id: 'fire',
    name: 'Огонь',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_trail_lava/courier_trail_lava.vpcf',
  },
  {
    id: 'lightnings',
    name: 'Молнии',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_platinum_roshan/platinum_roshan_ambient.vpcf',
  },
  {
    id: 'frostbloom',
    name: 'Иней',
    type: 'particle_create',
    modifier: 'particles/econ/seasonal/seasonal_ambient_silver.vpcf',
  },
  {
    id: 'snow',
    name: 'Снег',
    type: 'particle_create',
    modifier: 'particles/econ/seasonal/seasonal_ambient_snow.vpcf',
  },
  {
    id: 'bubbles',
    name: 'Пузыри',
    type: 'particle_create',
    modifier: 'particles/econ/seasonal/seasonal_ambient_bubbles.vpcf',
  },
  {
    id: 'sand-storm',
    name: 'Песчаная буря',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_roshan_desert_sands/baby_roshan_desert_sands_ambient.vpcf',
  },
  {
    id: 'ghost',
    name: 'Призрак',
    type: 'particle_create',
    modifier: 'particles/econ/courier/courier_f2p/courier_f2p_10th_anniversary_ambient.vpcf',
  },
];

/** The effect variants the synthetic cosmetics/items picker can apply. */
export function itemEffects(): { id: string; name: string }[] {
  return [{ id: '', name: t('Без эффекта') }, ...ITEM_EFFECTS.map(({ id, name }) => ({ id, name: t(name) }))];
}
