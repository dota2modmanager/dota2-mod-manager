import type { PreviewGem } from '../builder/gems.ts';

const matches = (path: string, prefixes: string[]) => prefixes.some(prefix => path.startsWith(prefix));

/** Dedicated item particles take priority over Terrorblade's hero-wide arcana tint. */
export function loadoutGem(path: string, gems: readonly PreviewGem[]) {
  const key = path.toLowerCase();
  const own = gems.find(row => matches(key, row.rules.own));
  if (own) return { color: own.color, bake: own.rules.bake, own: true };
  const shared = gems.find(row => matches(key, row.rules.shared));
  if (!shared) return;
  // Many Terrorblade cosmetics bake their glow into the particle's colors.
  // CP15/16 alone only reaches systems with a prismatic operator.
  const wearable = !shared.stock && shared.set === 'terrorblade-arcana' && key.startsWith('particles/econ/items/terrorblade/') &&
    !key.startsWith('particles/econ/items/terrorblade/terrorblade_horns_arcana/');
  return { color: shared.color, bake: false, own: wearable };
}

export function loadoutMaterialGem(path: string, slot: string | undefined, gems: readonly PreviewGem[]) {
  const key = path.toLowerCase();
  const arcana = gems.find(gem => gem.set === 'terrorblade-arcana');
  const specific = gems.find(gem => gem.slot === slot && gem !== arcana &&
    (matches(key, gem.rules.materials) || gem.set === 'terrorblade-scythes' || gem.set === 'terrorblade-span'));
  const heroSlot = arcana?.slot.slice(0, arcana.slot.lastIndexOf(':') + 1);
  return specific ?? (arcana && (matches(key, arcana.rules.materials) || heroSlot && slot?.startsWith(heroSlot)) ? arcana : undefined);
}
