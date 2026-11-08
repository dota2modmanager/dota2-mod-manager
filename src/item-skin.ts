/* Which material set an item's visuals wear its model in (src/model-skin.ts makes a model wear it). */
import { blockBounds, eachChild } from './schema.ts';

/** The material set the first style's block names ("skin"), as a string, or undefined for none. */
export function firstStyleSkin(visuals: string): string | undefined {
  let skin: string | undefined;
  eachChild(visuals, blockBounds(visuals, 0), (c) => {
    if (!c.isBlock || c.key.toLowerCase() !== 'styles') return;
    eachChild(visuals, c.body!, (st) => {
      if (st.isBlock && st.key === '0') eachChild(visuals, st.body!, (f) => { if (!f.isBlock && f.key.toLowerCase() === 'skin') skin ??= f.value; });
    });
  });
  return skin;
}

/**
 * The material set an item wears its model in, 0 for the first: what its style says, or a
 * "model_skin" modifier for the style picked. Luna's Midnight Locks is one model and three sets, and
 * 861 hero items are of this kind (2026-11-06).
 * @param visuals  the item's visuals with the picked style made its first (withStyle)
 */
export function wornSkin(visuals: string, fallback = 0): number {
  if (!visuals) return fallback;
  const own = firstStyleSkin(visuals);
  if (own !== undefined && /^\d+$/.test(own)) return Number(own);
  for (const m of visuals.matchAll(/"asset_modifier\d*"\s*\{([^{}]*)\}/gi)) {
    if (!/"type"\s+"model_skin"/i.test(m[1])) continue;
    const skin = /"skin"\s+"(\d+)"/i.exec(m[1])?.[1];
    if (skin !== undefined && Number(/"style"\s+"(\d+)"/i.exec(m[1])?.[1] || 0) === 0) return Number(skin);
  }
  let skin = fallback;
  eachChild(visuals, blockBounds(visuals, 0), field => {
    if (!field.isBlock && field.key.toLowerCase() === 'skin' && /^\d+$/.test(field.value)) skin = Number(field.value);
  });
  return skin;
}
