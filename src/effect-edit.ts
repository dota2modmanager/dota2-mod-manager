/**
 * An effect of the game changed by hand: its size, how many particles it makes, how long they live,
 * how fast they leave, and its colour.
 *
 * A particle system is a KV3 tree, and each of these is a handful of numbers in it: a system's
 * constant radius and lifespan, its emitters' rates, the ranges its initializers roll from. A number
 * in the file is either plain, or a parameter that says how it is made, and a literal or a random
 * range can be scaled while the rest (a value read from a control point, a curve) is left alone.
 * The changed file keeps its path, so a pak with it replaces the effect wherever the game plays it.
 *
 * Colour takes the chosen hue and saturation and keeps each colour's brightness. A sprite's own
 * picture may be coloured too, and is multiplied by these: the renderer's desaturation brings it in
 * as grey, the game's own switch for it, so the chosen colour is the one that shows, a sheet of
 * frames keeps working, and no texture has to be copied or compiled.
 */
import { readKv3, numberOf, writeCell, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock } from './resource.ts';
import { entryAt, type VpkEntry } from './vpk.ts';

/** One system's changes, in percent of what the file says; what is left out stays. */
export interface EffectEdit { size?: number; count?: number; life?: number; speed?: number; tint?: string }
/** A whole effect's changes, by system path. `WHOLE` holds what goes on every system of it. */
export type EffectEdits = Record<string, EffectEdit>;

/** The key of the changes that go on every system. */
export const WHOLE = '*';
/** The lowest a slider goes, in percent. */
export const MIN_SCALE = 10;
/** The highest a slider goes, in percent. */
export const MAX_SCALE = 300;

const SCALES = ['size', 'count', 'life', 'speed'] as const;
/** The renderers that draw a picture in the particle's colour. */
const DRAWN = /^C_OP_Render(Sprites|Trails|Ropes|SpriteTrail)$/;
const pathOf = (p: string) => p.toLowerCase().replace(/\\/g, '/').replace(/\.vpcf_c$/, '.vpcf');

/** What the window sent: known fields, values in range, nothing that changes nothing. */
export function cleanEdits(raw: unknown): EffectEdits {
  const out: EffectEdits = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, Partial<EffectEdit> | null>).slice(0, 64)) {
    if (!value || typeof value !== 'object' || (key !== WHOLE && !/^particles\/[\w/.-]+\.vpcf$/.test(pathOf(key)))) continue;
    const e: EffectEdit = {};
    for (const k of SCALES) {
      const v = Math.min(Math.max(Math.round(Number(value[k] ?? 100) / 5) * 5, MIN_SCALE), MAX_SCALE);
      if (Number.isFinite(v) && v !== 100) e[k] = v;
    }
    if (typeof value.tint === 'string' && /^#[0-9a-f]{6}$/i.test(value.tint)) e.tint = value.tint.toLowerCase();
    if (Object.keys(e).length) out[key === WHOLE ? WHOLE : pathOf(key)] = e;
  }
  return out;
}

const members = (n: Kv3Node | undefined) => (n?.kind === 'object' ? n.members : null);
const classOf = (n: Kv3Node) => { const c = members(n)?.get('_class'); return c?.kind === 'string' ? c.value : ''; };
const items = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);

const made = (v: number, whole: boolean): Kv3Node => {
  const raw = Buffer.alloc(whole ? 4 : 8);
  if (whole) raw.writeInt32LE(Math.round(v)); else raw.writeDoubleLE(v);
  return { kind: 'number', type: whole ? 11 : 5, cell: null, typeAt: null, raw };
};

/** A number set where it lies when it fits there, or made anew. */
function put(kv: Kv3Block, node: Extract<Kv3Node, { kind: 'number' }>, v: number, swap: (n: Kv3Node) => void, whole: boolean): void {
  const c = node.cell;
  if (c && (c.float || c.width >= 4)) writeCell(kv, c, whole ? Math.round(v) : v);
  else swap(made(v, whole));
}

/** One field of an object scaled: a plain number, or a parameter that is a literal or a random range. */
function scale(kv: Kv3Block, holder: Map<string, Kv3Node> | null, key: string, k: number): boolean {
  const n = holder?.get(key);
  if (!holder || !n) return false;
  const whole = key.startsWith('m_n');
  if (n.kind === 'number') {
    put(kv, n, (numberOf(kv, n) ?? 0) * k, (x) => holder.set(key, x), whole);
    return true;
  }
  const inner = members(n);
  const type = inner?.get('m_nType');
  if (!inner) return false;
  // a parameter without a type written is a literal
  const kind = type?.kind === 'string' ? type.value : 'PF_TYPE_LITERAL';
  if (kind === 'PF_TYPE_LITERAL') return scale(kv, inner, 'm_flLiteralValue', k);
  if (kind === 'PF_TYPE_RANDOM_UNIFORM') return [scale(kv, inner, 'm_flRandomMin', k), scale(kv, inner, 'm_flRandomMax', k)].some(Boolean);
  return false;
}

/** A vector of numbers scaled, the speed a noise or a local velocity rolls. */
function scaleVector(kv: Kv3Block, n: Kv3Node | undefined, k: number): boolean {
  if (n?.kind !== 'array') return false;
  n.items.forEach((x, i) => { if (x.kind === 'number') put(kv, x, (numberOf(kv, x) ?? 0) * k, (y) => { n.items[i] = y; }, false); });
  return true;
}

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** A colour array moved to `rgb`, each keeping its own brightness. */
function tint(kv: Kv3Block, n: Kv3Node | undefined, rgb: [number, number, number]): boolean {
  if (n?.kind !== 'array' || n.items.length < 3) return false;
  const cells = n.items.slice(0, 3);
  if (cells.some((c) => c.kind !== 'number')) return false;
  const old = cells.map((c) => numberOf(kv, c as Extract<Kv3Node, { kind: 'number' }>) ?? 0);
  const bright = Math.max(...old) / 255;
  const top = Math.max(...rgb, 1);
  cells.forEach((c, i) => {
    put(kv, c as Extract<Kv3Node, { kind: 'number' }>, Math.min(255, Math.round((rgb[i] / top) * 255 * bright)), (y) => { (n as Extract<Kv3Node, { kind: 'array' }>).items[i] = y; }, true);
  });
  return true;
}

/** A parameter of the file that is this number. */
const literal = (v: number): Kv3Node => ({ kind: 'object', members: new Map<string, Kv3Node>([['m_nType', { kind: 'string', value: 'PF_TYPE_LITERAL' }], ['m_flLiteralValue', made(v, false)]]) });

/** The changes on one system's tree, made in place; whether any field took one. */
export function editTree(kv: Kv3Block, edit: EffectEdit): boolean {
  const root = members(kv.root);
  if (!root) return false;
  const inits = items(root.get('m_Initializers'));
  const emits = items(root.get('m_Emitters'));
  const ops = items(root.get('m_Operators'));
  const did: boolean[] = [];
  const fields = (nodes: Kv3Node[], cls: RegExp, keys: string[], k: number) => {
    for (const n of nodes) if (cls.test(classOf(n))) for (const key of keys) did.push(scale(kv, members(n), key, k));
  };
  if (edit.size) {
    const k = edit.size / 100;
    did.push(scale(kv, root, 'm_flConstantRadius', k));
    fields(inits, /^C_INIT_RandomRadius$/, ['m_flRadiusMin', 'm_flRadiusMax'], k);
  }
  if (edit.count) {
    const k = edit.count / 100;
    did.push(scale(kv, root, 'm_nMaxParticles', k), scale(kv, root, 'm_nInitialParticles', k));
    fields(emits, /^C_OP_ContinuousEmitter$/, ['m_flEmitRate'], k);
    fields(emits, /^C_OP_InstantaneousEmitter$/, ['m_nParticlesToEmit'], k);
  }
  if (edit.life) {
    const k = edit.life / 100;
    did.push(scale(kv, root, 'm_flConstantLifespan', k));
    fields(inits, /^C_INIT_RandomLifeTime$/, ['m_fLifetimeMin', 'm_fLifetimeMax'], k);
  }
  if (edit.speed) {
    const k = edit.speed / 100;
    fields(inits, /^C_INIT_CreateWithinSphere|^C_INIT_CreateOnModel$|^C_INIT_RingWave$/, ['m_fSpeedMin', 'm_fSpeedMax', 'm_flInitialSpeedMin', 'm_flInitialSpeedMax'], k);
    for (const n of inits) {
      if (!/^C_INIT_(InitialVelocityNoise|VelocityRandom|CreateWithinSphere)/.test(classOf(n))) continue;
      const m = members(n);
      for (const key of ['m_vecOutputMin', 'm_vecOutputMax', 'm_LocalCoordinateSystemSpeedMin', 'm_LocalCoordinateSystemSpeedMax']) did.push(scaleVector(kv, m?.get(key), k));
    }
  }
  if (edit.tint) {
    const rgb = hex(edit.tint);
    did.push(tint(kv, root.get('m_ConstantColor'), rgb));
    for (const n of [...inits, ...ops]) {
      const m = members(n);
      if (classOf(n) === 'C_INIT_RandomColor') did.push(tint(kv, m?.get('m_ColorMin'), rgb), tint(kv, m?.get('m_ColorMax'), rgb));
      if (classOf(n) === 'C_OP_ColorInterpolate') did.push(tint(kv, m?.get('m_ColorFade'), rgb));
    }
    // a system with no colour of its own is white, and white takes no hue
    if (!root.has('m_ConstantColor')) { root.set('m_ConstantColor', { kind: 'array', items: [...rgb, 255].map((v) => made(v, true)) }); did.push(true); }
    for (const r of items(root.get('m_Renderers'))) {
      const m = members(r);
      if (!m || !DRAWN.test(classOf(r))) continue;
      m.set('m_flDesaturation', literal(1));
      did.push(true);
    }
  }
  return did.some(Boolean);
}

/** The changes that fall on one system: its own over those on the whole effect. */
function falling(edits: EffectEdits, path: string): EffectEdit | null {
  const all = edits[WHOLE] ?? {};
  const own = edits[pathOf(path)] ?? {};
  const out: EffectEdit = {};
  for (const k of SCALES) {
    const v = Math.round(((all[k] ?? 100) * (own[k] ?? 100)) / 100);
    if (v !== 100) out[k] = v;
  }
  const hue = own.tint ?? all.tint;
  if (hue) out.tint = hue;
  return Object.keys(out).length ? out : null;
}

/** The paths of a system and all under it, each once, root first. */
export function systemsOf(read: (p: string) => Buffer | null | undefined, root: string): { path: string; depth: number }[] {
  const out: { path: string; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (path: string, depth: number) => {
    const p = pathOf(path);
    if (seen.has(p) || seen.size >= 60 || depth > 5) return;
    seen.add(p);
    const bytes = read(`${p}_c`);
    if (!bytes) return;
    out.push({ path: p, depth });
    let kv: Kv3Block;
    try { kv = readKv3(resourceBlock(bytes, 'DATA').data); } catch { return; }
    for (const c of items(members(kv.root)?.get('m_Children'))) {
      const ref = members(c)?.get('m_ChildRef');
      if (ref?.kind === 'string' && ref.value) walk(ref.value, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** The changed files of an effect, under the paths they have in the game. */
export function editedEntries(read: (p: string) => Buffer | null | undefined, root: string, edits: EffectEdits): VpkEntry[] {
  const out: VpkEntry[] = [];
  for (const { path } of systemsOf(read, root)) {
    const edit = falling(edits, path);
    const bytes = read(`${path}_c`);
    if (!edit || !bytes) continue;
    const block = resourceBlock(bytes, 'DATA');
    const kv = readKv3(block.data);
    if (editTree(kv, edit)) out.push(entryAt(`${path}_c`, block.replace(writeKv3(kv))));
  }
  return out;
}
