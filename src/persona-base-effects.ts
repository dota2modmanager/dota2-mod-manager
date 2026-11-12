/* What of a persona's base the build takes: its persona's own effects, not another item's.
 * Kept apart from src/item-builder-personas.ts, which says how a persona is worn. */
import { entryPath } from './vpk.ts';
import { personaLayouts } from './item-builder-personas.ts';
import type { ReadyBase } from './arcana-bases.ts';

/**
 * A persona's base without another item's effects: the Acolyte's carries Magus Apex's eyes as its
 * orbs and its Sun Strike, at the plain hero's paths, and they won over the persona's own orbs. An
 * effect folder under particles/econ/items/ that none of the persona's own items names is another
 * item's: its files go, and so does a plain path's file that leads into it, where the persona's
 * own copy or the game's then stands. The other bases' folders are their persona's own (axe_carnival,
 * dk_persona, mirana_persona).
 */
export function withoutOthersEffects(text: string, ready: ReadyBase[]): ReadyBase[] {
  return ready.map((r) => {
    const layout = r.base.persona ? personaLayouts(text).get(r.base.hero) : undefined;
    if (!layout) return r;
    const own = [...layout.personas, ...layout.parts.flatMap((p) => (p.given ? [p.given] : []))].map((i) => text.slice(i.start, i.end)).join('\n');
    const folder = (p: string) => p.toLowerCase().split('/').slice(0, 5).join('/');
    const others = new Set(r.entries.map((e) => entryPath(e)).filter((p) => /^particles\/econ\/items\//i.test(p) && !own.includes(`${folder(p)}/`)).map(folder));
    if (!others.size) return r;
    const entries = r.entries.filter((e) => {
      const p = entryPath(e).toLowerCase();
      if (others.has(folder(p))) return false;
      const said = p.endsWith('.vpcf_c') ? e.data.toString('latin1').toLowerCase() : '';
      return ![...others].some((f) => said.includes(`${f}/`));
    });
    return { ...r, entries, paths: new Set(entries.map((e) => entryPath(e).toLowerCase())) };
  });
}
