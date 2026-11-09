/* The particles of a hero's 3D preview (src/hero-preview.ts), out of the game's files alone: each
 * worn part's, the body's and the hero's own. They need no exported model, so they are gathered
 * before the models export and their resources (the models and pictures the particles name) fetch
 * alongside; a cold Terrorblade waited 3.5 s for those after his models and then 1.8 s for their
 * pictures. A part is named here by its place in the plan's parts; once the models are in,
 * `forParts` moves each to its place among those that exported. */
import { bladeSnapshots, replaceTerrorbladeBladeFx, styleParticleRoots } from './hero-particle-styles.ts';
import { modelParticleEntries } from './model-particles.ts';
import { bindItemParticle, modelAttachments, particleDef, particleReport, type ParticleDef } from './particle-spec.ts';
import { previewParticleReader } from './hero-preview-picks.ts';
import type { unusualEffects } from './unusual-effects.ts';

type Binding = ReturnType<typeof unusualEffects>[number];

/** What of the plan the particles read (src/hero-preview.ts plan). */
export interface FxPlan {
  body: string; bodyFx: string[]; heroFx: string[];
  replacements: Map<string, string>; bindings: Map<string, Binding>;
  read: (path: string) => Buffer | null;
  parts: { slot: string; model: string; style?: number; fx: string[]; replacements?: Map<string, string> }[];
}

/** One particle: on a part by its place in the plan's parts, on the body (-1), or the hero's own (-2). */
export interface PlannedFx { part: number; def: ParticleDef }

const compiled = (model: string) => model.replace(/\.vmdl$/i, '.vmdl_c');

/** Every particle the preview plays for the plan, at most 256 systems in all. */
export function previewParticles(p: FxPlan, log?: (msg: string) => void): PlannedFx[] {
  const particles: PlannedFx[] = [];
  const budget = { left: 256 };
  const suppressStockBlades = p.parts.some((part) => part.slot.endsWith(':weapon') && replaceTerrorbladeBladeFx(p.body, part.model, part.fx.map((fx) => part.replacements?.get(fx) ?? fx)));
  for (const [index, x] of p.parts.entries()) {
    const model = p.read(compiled(x.model));
    if (!model) continue;
    const roots = styleParticleRoots(modelParticleEntries(model), x.fx, x.style ?? 0);
    const resolved = new Set<string>(), readPart = previewParticleReader(p.read, p.replacements, x.replacements, suppressStockBlades);
    for (const [path, config] of roots) {
      const replacement = x.replacements?.get(path) ?? p.replacements.get(path) ?? path;
      if (resolved.has(replacement)) continue;
      resolved.add(replacement);
      const def = particleDef(readPart, replacement, budget);
      if (def) particles.push({ part: index, def: bindItemParticle(bladeSnapshots(def, x.replacements), p.bindings.get(replacement) ?? p.bindings.get(path), config) });
    }
    if (log && process.env.MM_PREVIEW_FX) log(`preview fx: ${JSON.stringify({
      slot: x.slot, model: x.model, attachments: modelAttachments(model).map((a) => [a.name, a.bone]),
      requested: [...resolved], loaded: particles.filter((entry) => entry.part === index).map(({ def }) => particleReport(def)),
    })}`);
  }
  const roots = new Set<string>(), readParticle = previewParticleReader(p.read, p.replacements, undefined, suppressStockBlades);
  const own = (part: number, paths: string[]) => {
    for (const root of paths) {
      const particle = p.replacements.get(root) ?? root;
      if (roots.has(particle)) continue;
      roots.add(particle);
      const def = particleDef(readParticle, particle, budget);
      if (def) particles.push({ part, def: bindItemParticle(def, p.bindings.get(particle) ?? p.bindings.get(root), 'preview') });
    }
  };
  own(-1, modelParticleEntries(p.read(compiled(p.body))).map((entry) => entry.path));
  own(-2, [...p.bodyFx, ...p.heroFx]);
  if (!particles.length && /\/wisp\/wisp\.vmdl$/i.test(p.body)) own(-2, ['particles/units/heroes/hero_wisp/wisp_ambient.vpcf']);
  return particles;
}

/**
 * The particles with each part's place among the parts that exported; a part whose model did not
 * come takes its particles with it. The same list when every part came.
 * @param placed for each part of the plan, its place among the exported ones, or -1
 */
export function forParts(particles: PlannedFx[], placed: number[]): PlannedFx[] {
  if (placed.every((at, i) => at === i)) return particles;
  return particles.flatMap((x) => (x.part < 0 ? [x] : placed[x.part] >= 0 ? [{ ...x, part: placed[x.part] }] : []));
}
