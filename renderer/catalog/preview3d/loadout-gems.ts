import type { PreviewGem } from '../builder/gems.ts';

const matches = (path: string, prefixes: string[]) => prefixes.some(prefix => path.startsWith(prefix));

/** Dedicated item particles take priority over Terrorblade's hero-wide arcana tint. */
export function loadoutGem(path: string, gems: readonly PreviewGem[]) {
  const key = path.toLowerCase();
  const own = gems.find(row => matches(key, row.rules.own));
  if (own) return { color: own.color, bake: own.rules.bake, own: true };
  const shared = gems.find(row => matches(key, row.rules.shared));
  if (!shared) return;
  // Many Terrorblade cosmetics bake their glow into the particle's colors, and so do his own blades
  // (hero_terrorblade/terrorblade_ambient_sword*.vpcf): CP15/16 alone only reaches systems with a
  // prismatic operator, so a gem picked on the arcana left the blades red until the build baked it
  // in and the weapon was put on again. With a gem of its own the arcana colours them all, as the
  // game does once it is built.
  const baked = !shared.stock && shared.set === 'terrorblade-arcana';
  return { color: shared.color, bake: false, own: baked };
}

export function loadoutMaterialGem(path: string, slot: string | undefined, gems: readonly PreviewGem[]) {
  const key = path.toLowerCase();
  const arcana = gems.find(gem => gem.set === 'terrorblade-arcana');
  const specific = gems.find(gem => gem.slot === slot && gem !== arcana &&
    (matches(key, gem.rules.materials) || gem.set === 'terrorblade-scythes' || gem.set === 'terrorblade-span'));
  const heroSlot = arcana?.slot.slice(0, arcana.slot.lastIndexOf(':') + 1);
  return specific ?? (arcana && (matches(key, arcana.rules.materials) || heroSlot && slot?.startsWith(heroSlot)) ? arcana : undefined);
}
