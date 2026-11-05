/* The particles an item or a hero shows on its loadout, read out of the game for the 3D preview
 * (issue #417), and the attachment points they hang on.
 *
 * A particle system (.vpcf_c) is a KV3 tree: emitters, initializers, operators, renderers, the
 * control points and what drives them, and child systems. The window plays an approximation of a
 * few dozen of the commonest of those (renderer/catalog/preview3d/particles.ts), so this hands it
 * the tree as plain JSON, children inlined, without interpreting it. A model's attachments
 * (attach_sword, attach_hitloc) are in its MDAT blocks: a bone, an offset and a turn from it.
 *
 * Which systems: an item's "particle_create" asset modifiers for its first style, the ones the
 * game spawns only on the loadout included, the team-only ones for Radiant; and the hero's own
 * RenderablePortrait "loadout" particles, which the game plays as the loadout opens. */
import { readKv3, numberOf, type Kv3Block, type Kv3Node } from './kv3.ts';
import { resourceBlocks, resourceBlock } from './resource.ts';

/** A KV3 value as plain JSON, as the window gets it over IPC. */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** A system with its children, as the window plays it. */
export interface ParticleDef { path: string; tree: { [k: string]: Json }; children: ParticleDef[] }

/** An attachment point: the bone it follows, and where it sits from it in the bone's own space (Source units). */
export interface Attachment { name: string; bone: string; offset: [number, number, number]; rotation: [number, number, number, number] }

/** A KV3 node as plain JSON. */
export function kvJson(kv: Kv3Block, n: Kv3Node | undefined): Json {
  if (!n) return null;
  switch (n.kind) {
    case 'object': return Object.fromEntries([...n.members].map(([k, v]) => [k, kvJson(kv, v)]));
    case 'array': return n.items.map((x) => kvJson(kv, x));
    case 'number': return numberOf(kv, n);
    case 'string': return n.value;
    case 'other': return n.type === 2 ? !!n.value : n.type === 13 ? true : n.type === 14 ? false : null;
    default: return null;
  }
}

/** The DATA tree of a compiled resource, or null for one the reader cannot take. */
function dataTree(file: Buffer | null): { [k: string]: Json } | null {
  try {
    if (!file || !resourceBlocks(file).some((b) => b.name === 'DATA')) return null;
    const kv = readKv3(resourceBlock(file, 'DATA').data);
    const j = kvJson(kv, kv.root);
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

const compiled = (p: string) => p.toLowerCase().replace(/\\/g, '/').replace(/\.vpcf$/, '.vpcf_c');

/**
 * A system and its children, at most `budget` systems in all: a system with dozens of children
 * would cost the window more than its look is worth.
 */
export function particleDef(read: (path: string) => Buffer | null, path: string, budget = { left: 24 }, depth = 0): ParticleDef | null {
  if (budget.left <= 0 || depth > 4) return null;
  const tree = dataTree(read(compiled(path)));
  if (!tree) return null;
  budget.left -= 1;
  const children: ParticleDef[] = [];
  for (const c of (Array.isArray(tree.m_Children) ? tree.m_Children : []) as { [k: string]: Json }[]) {
    const ref = typeof c?.m_ChildRef === 'string' ? c.m_ChildRef : '';
    if (!ref || c.m_bDisableChild === true) continue;
    const child = particleDef(read, ref, budget, depth + 1);
    if (child) children.push(child);
  }
  delete tree.m_Children;
  return { path, tree, children };
}

/** The particle_create systems an item block brings, for its first style. */
export function itemParticles(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/"asset_modifier\d*"\s*\{([^{}]*)\}/gi)) {
    const body = m[1];
    const field = (k: string) => new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(body)?.[1];
    if ((field('type') || '').toLowerCase() !== 'particle_create') continue;
    const style = field('style');
    if (style && style !== '0') continue;
    if (field('dire_only') === '1' || field('flying_courier_only') === '1' || field('required_arcana_level')) continue;
    const p = field('modifier');
    if (p && /^particles\/[\w/.-]+\.vpcf$/i.test(p)) out.push(p.toLowerCase());
  }
  return out;
}

/** The hero's own loadout particles, out of its script's RenderablePortrait block. */
export function heroLoadoutParticles(script: string): string[] {
  const block = /"RenderablePortrait"\s*\{[\s\S]*?"Particles"\s*\{([^{}]*)\}/i.exec(script)?.[1] || '';
  return [...block.matchAll(/"(particles\/[\w/.-]+\.vpcf)"\s+"loadout"/gi)].map((m) => m[1].toLowerCase());
}

/** A model's attachment points. */
export function modelAttachments(model: Buffer | null): Attachment[] {
  const out: Attachment[] = [];
  if (!model) return out;
  let blocks: { name: string }[] = [];
  try { blocks = resourceBlocks(model); } catch { return out; }
  const mdat = blocks.filter((b) => b.name === 'MDAT').length;
  for (let i = 0; i < mdat; i++) {
    let tree: Json = null;
    try { const kv = readKv3(resourceBlock(model, 'MDAT', i).data); tree = kvJson(kv, kv.root); } catch { continue; }
    const list = (tree as { m_attachments?: { value?: { [k: string]: Json } }[] } | null)?.m_attachments;
    for (const a of Array.isArray(list) ? list : []) {
      const v = a?.value;
      const bone = (v?.m_influenceNames as string[] | undefined)?.[0];
      if (!v || typeof v.m_name !== 'string' || !bone || out.some((x) => x.name === v.m_name)) continue;
      const offset = ((v.m_vInfluenceOffsets as number[][] | undefined)?.[0] || [0, 0, 0]) as [number, number, number];
      const rotation = ((v.m_vInfluenceRotations as number[][] | undefined)?.[0] || [0, 0, 0, 1]) as [number, number, number, number];
      out.push({ name: v.m_name, bone, offset, rotation });
    }
  }
  return out;
}
