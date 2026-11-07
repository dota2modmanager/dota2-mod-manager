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
