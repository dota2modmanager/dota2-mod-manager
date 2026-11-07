/* The particles an item or a hero shows on its loadout, read out of the game for the 3D preview
 * (issue #417), and the attachment points they hang on.
 *
 * A particle system (.vpcf_c) is a KV3 tree: emitters, initializers, operators, renderers, the
 * control points and what drives them, and child systems. The independent TS runtime executes
 * supported operations in file order and diagnoses unsupported ones. This sends the full tree,
 * child timing and snapshots rather than flattening them into one approximate sprite. A model's attachments
 * (attach_sword, attach_hitloc) are in its MDAT blocks: a bone, an offset and a turn from it.
 *
 * Which systems: an item's "particle_create" asset modifiers for its first style, the ones the
 * game spawns only on the loadout included, the team-only ones for Radiant; and the hero's own
 * RenderablePortrait "loadout" particles, which the game plays as the loadout opens. */
import { readKv3, numberOf, type Kv3Block, type Kv3Node } from './kv3.ts';
import type { UnusualEffect } from './unusual-effects.ts';
import type { SnapshotPoint, LoadoutAttachment } from '../renderer/api/preview3d.ts';
import { snapshotPoints } from './particle-snapshot.ts';
import { resourceBlocks, resourceBlock } from './resource.ts';

/** A KV3 value as plain JSON, as the window gets it over IPC. */
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** A system with its children, as the window plays it. */
export interface ParticleDef { path: string; tree: { [k: string]: Json }; children: ParticleDef[]; childGroup?: number; delay?: number; endcap?: boolean; snapshot?: SnapshotPoint[]; snapshots?: Record<number, SnapshotPoint[]> }

/** An attachment point: the bone it follows, and where it sits from it in the bone's own space (Source units). */
export interface Attachment extends Partial<LoadoutAttachment> { name: string; bone: string; offset: [number, number, number]; rotation: [number, number, number, number] }

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
export function dataTree(file: Buffer | null): { [k: string]: Json } | null {
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
export function particleDef(read: (path: string) => Buffer | null, path: string, budget = { left: 128 }, depth = 0, inherited = new Map<number, SnapshotPoint[]>()): ParticleDef | null {
  if (budget.left <= 0 || depth > 12) return null;
  const tree = dataTree(read(compiled(path)));
  if (!tree) return null;
  budget.left -= 1;
  const snapshots = new Map(inherited);
  if (typeof tree.m_hSnapshot === 'string' && /\.vsnap(?:_c)?$/i.test(tree.m_hSnapshot)) {
    const file = read(tree.m_hSnapshot.toLowerCase().replace(/\.vsnap$/, '.vsnap_c'));
    const data = dataTree(file);
    if (file && data) {
      try { snapshots.set(Number(tree.m_nSnapshotControlPoint ?? 0), snapshotPoints(file, data)); } catch { /* unsupported snapshot */ }
    }
  }
  const used: Record<number, SnapshotPoint[]> = {};
  const users = ['m_Initializers', 'm_Emitters', 'm_Operators'].flatMap((key) => Array.isArray(tree[key]) ? tree[key] : []);
  for (const op of users) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) continue;
    const cp = op._class === 'C_INIT_InitSkinnedPositionFromCPSnapshot' ? Number(op.m_nSnapshotControlPointNumber ?? 1)
      : op._class === 'C_INIT_InitFromCPSnapshot' ? Number(op.m_nControlPointNumber ?? 0)
        : op._class === 'C_OP_InstantaneousEmitter' ? Number(op.m_nSnapshotControlPoint ?? -1) : -1;
    const points = snapshots.get(cp);
    if (points?.length) used[cp] = points;
  }
  const snapshot = Object.values(used)[0];
  const children: ParticleDef[] = [];
  for (const c of (Array.isArray(tree.m_Children) ? tree.m_Children : []) as { [k: string]: Json }[]) {
    const ref = typeof c?.m_ChildRef === 'string' ? c.m_ChildRef : '';
    if (!ref || c.m_bDisableChild === true) continue;
    const child = particleDef(read, ref, budget, depth + 1, snapshots);
    if (child) children.push({ ...child, childGroup: Number(c.m_nChildGroupID ?? 0),
      ...(typeof c.m_flDelay === 'number' ? { delay: Math.max(0, c.m_flDelay) } : {}),
      ...(c.m_bEndCap === true ? { endcap: true } : {}) });
  }
  // Keep authored child timing, group and CP metadata for dota-loadout.
  return { path, tree, children, ...(snapshot?.length ? { snapshot, snapshots: used } : {}) };
}

/** The texture a renderer draws its sprites with, as the game names it. */
function rendererTextures(r: { [k: string]: Json }): string[] {
  const layers: Json[] = Array.isArray(r.m_vecTexturesInput) ? r.m_vecTexturesInput : [{ m_hTexture: r.m_hTexture ?? null }];
  return layers.flatMap((layer) => {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer) || layer.m_bEnabled === false || layer.m_bReplaceTextureWithGradient === true) return [];
    const input = layer.m_hTexture;
    return typeof input === 'string' && /^materials\/[\w/.-]+\.vtex$/i.test(input) ? [input.toLowerCase()] : [];
  });
}

/** Every texture a system and its children draw with, once each. */
export function particleTextures(def: ParticleDef): string[] {
  const out = new Set<string>();
  const walk = (d: ParticleDef) => {
    for (const r of (Array.isArray(d.tree.m_Renderers) ? d.tree.m_Renderers : []) as { [k: string]: Json }[]) {
      if (r && typeof r === 'object') for (const t of rendererTextures(r)) out.add(t);
    }
    d.children.forEach(walk);
  };
  walk(def);
  return [...out];
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

/** Overlay economy control points onto the root particle's preview configuration. */
export function bindItemParticle(def: ParticleDef, effect: UnusualEffect | undefined, configName = ''): ParticleDef {
  if (!effect && !configName) return def;
  const configs = Array.isArray(def.tree.m_controlPointConfigurations) ? def.tree.m_controlPointConfigurations : [];
  const records = configs.filter((c): c is Record<string, Json> => !!c && typeof c === 'object' && !Array.isArray(c));
  const config = records.find((c) => c.m_name === (configName || 'preview')) ?? records.find((c) => c.m_name === 'preview') ?? records[0];
  if (!effect && !config) return def;
  const drivers = Array.isArray(config?.m_drivers) ? [...config.m_drivers] : [];
  const points = new Map((effect?.points ?? []).filter((p) => Number.isInteger(p.index) && p.index >= 0).map((p) => [p.index, p]));
  if (effect && !points.has(0) && (effect.attachment || (effect.attachType && !/point/i.test(effect.attachType)))) {
    points.set(0, { index: 0, attachType: effect.attachType, attachment: effect.attachment ?? null });
  }
  for (const point of points.values()) {
    if (drivers.some(d => d && typeof d === 'object' && !Array.isArray(d) && Number(d.m_iControlPoint ?? 0) === point.index)) continue;
    const entity = point.entity ?? effect?.entity;
    drivers.push({
      m_iControlPoint: point.index,
      m_iAttachType: (point.attachType || effect?.attachType || '').toUpperCase(),
      m_attachmentName: point.attachment ?? '',
      m_entityName: entity === 'parent' ? 'parent' : 'self',
    });
  }
  return { ...def, tree: { ...def.tree, m_controlPointConfigurations: [{ m_name: 'preview', m_drivers: drivers }] } };
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
    const list = (tree as { m_attachments?: { key?: string; value?: { [k: string]: Json } }[] } | null)?.m_attachments;
    for (const a of Array.isArray(list) ? list : []) {
      const v = a?.value;
      const bone = (v?.m_influenceNames as string[] | undefined)?.[0];
      const name = a?.key || v?.m_name;
      if (!v || typeof name !== 'string' || !bone || out.some((x) => x.name === name)) continue;
      const offset = ((v.m_vInfluenceOffsets as number[][] | undefined)?.[0] || [0, 0, 0]) as [number, number, number];
      const rotation = ((v.m_vInfluenceRotations as number[][] | undefined)?.[0] || [0, 0, 0, 1]) as [number, number, number, number];
      out.push({ name, bone, offset, rotation, bones: (v.m_influenceNames as string[]).slice(0, Number(v.m_nInfluences ?? 1)), offsets: v.m_vInfluenceOffsets as number[][], rotations: v.m_vInfluenceRotations as number[][], weights: v.m_influenceWeights as number[], ignoreRotation: !!v.m_bIgnoreRotation });
    }
  }
  return out;
}

/** Preserve operator parameters for diagnosing missing rendering features; no texture bytes. */
export function particleReport(def: ParticleDef): object {
  return {
    path: def.path, snapshotPoints: def.snapshot?.length,
    snapshots: Object.fromEntries(Object.entries(def.snapshots ?? {}).map(([cp, points]) => [cp, points.length])),
    delay: def.delay, endcap: def.endcap, childGroup: def.childGroup, tree: def.tree,
    children: def.children.map(particleReport),
  };
}
