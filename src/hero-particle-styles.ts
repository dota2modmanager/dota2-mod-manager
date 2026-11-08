import type { ParticleDef } from './particle-spec.ts';

/** Keep genuine model-born particles, but never spawn a style-0 version beside
 * a style-specific override of the very same root (Spectre's *_ambient_v2_*).
 * This is restricted to matching canonical paths and leaves unrelated
 * weapon/shoulder or caster particles intact. */
export function styleParticleRoots(model: {path: string; config: string}[], selected: string[], style: number) {
  const canon = (path: string) => path.toLowerCase().replace(/\\/g,'/')
    .replace(/_v\d+(?=_|\.vpcf$)/g,'')
    .replace(/_style\d+(?=_|\.vpcf$)/g,'');
  const override = style > 0 ? new Set(selected.map(canon)) : new Set<string>();
  const selectedPaths = new Set(selected.map(p=>p.toLowerCase()));
  const roots = new Map<string,string>();
  for (const {path,config} of model) {
    // If the selected style supplies an alternate root, its base sibling must
    // not run concurrently. Do not suppress independent inherited particles.
    if (override.has(canon(path)) && !selectedPaths.has(path.toLowerCase())) continue;
    roots.set(path,config);
  }
  for (const path of selected) if (!roots.has(path)) roots.set(path,'');
  return roots;
}

const stockBlade = 'particles/units/heroes/hero_terrorblade/terrorblade_ambient_sword';

/** Checks whether a particle path refers to Terrorblade's default sword effect. */
export const isStockTerrorbladeBlade = (path: string) =>
    path.toLowerCase().startsWith(stockBlade) && /\.vpcf(?:_c)?$/i.test(path);

/** Determines whether Terrorblade's stock sword particles should be suppressed when a replacement provides its own effects. */
export function replaceTerrorbladeBladeFx(body: string, model: string, roots: Iterable<string>) {
    return body === 'models/heroes/terrorblade/terrorblade_arcana.vmdl' &&
        model !== 'models/heroes/terrorblade/weapon.vmdl' &&
        [...roots].some(path => path !== 'particles/error/null.vpcf' && !isStockTerrorbladeBlade(path));
}

/** Use the wearable's native snapshot wherever its particle tree names the stock one. */
export function bladeSnapshots(def: ParticleDef, replacements?: Map<string, string>): ParticleDef {
  if (!replacements?.size) return def;
  const snapshot = def.tree.m_hSnapshot;
  const chosen = typeof snapshot === 'string' ? replacements.get(snapshot.toLowerCase().replace(/_c$/, '')) : undefined;
  return { ...def, tree: chosen?.endsWith('.vsnap') ? { ...def.tree, m_hSnapshot: chosen } : def.tree,
    children: def.children.map(child => bladeSnapshots(child, replacements)) };
}
