/**
 * Tower looks as a file mod (issue #446). The game has thirteen items that dress the towers: five
 * pairs a player equips per side ("Guardians of the Lost Path Radiant Towers"), offered by the
 * free looks once safe mode is off, and three event items (New Bloom's dragon towers, The
 * International 2017's) nobody can equip any more. Each says in its visuals which model the tower
 * entity wears, which model stands in for each stage of its destruction, and which particles it
 * swaps. Those are files, so a pak can put them under the default tower's names, for one side or
 * both, with safe mode on.
 *
 * What a file cannot carry is left out and said: a particle the item creates (it needs a host),
 * its sounds, the TI7 tower's level activities and skins.
 */
import { itemVisuals, type AssetModifier } from './item-visuals.ts';
import { buildVpk, entryAt, sharedVpkIndex } from './vpk.ts';
import { numberOf, readKv3, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';
import { numberedAs } from './model-sequences.ts';
import { attachedAs } from './model-attachments.ts';

export type Side = 'radiant' | 'dire';

/** The model every tower of a side wears. The map's tower entities name it (maps/dota.vpk and hero
 * demo, 2026-11-03), and that wins over npc_units.txt, which says tower_good for Radiant. */
export const DEFAULT_TOWER: Record<Side, string> = {
  radiant: 'models/props_structures/radiant_tower002.vmdl',
  dire: 'models/props_structures/dire_tower002.vmdl',
};

/** One item that dresses the towers, with the sides it has something for. */
/** A look, the sides it dresses and the tower model it puts on each (the window draws a look the game has no picture of from it). */
export interface TowerLook { id: string; name: string; sides: Side[]; models: Partial<Record<Side, string>> }

/** What a look does to one side: files under the default names, and what it leaves out. */
export interface TowerPlan { files: { at: string; from: string }[]; skipped: string[] }

const TOWER_UNIT = /^npc_dota_(goodguys|badguys)_tower/;
const ENTITY = /^entity(_clientside)?_model$/;

/** The side an asset belongs to, by its name: the game names them for Radiant and Dire. */
function sideOf(asset: string): Side | null {
  const m = TOWER_UNIT.exec(asset);
  if (m) return m[1] === 'goodguys' ? 'radiant' : 'dire';
  if (/radiant|_good|good_|goodguys/.test(asset)) return 'radiant';
  if (/dire|_bad|bad_|badguys/.test(asset)) return 'dire';
  return null;
}

/** The ids of the items whose visuals put a model on a tower, in the table's order. */
export function towerLookIds(text: string): string[] {
  const ids: string[] = [];
  const re = /"asset"\s+"npc_dota_(?:goodguys|badguys)_tower\w*"/g;
  const head = /\n\t\t"(\d+)"\s*\{/y;
  for (let m; (m = re.exec(text));) {
    // the item this modifier sits in: the nearest item key before it, two tabs in
    let id = '';
    for (let at = text.lastIndexOf('\n\t\t"', m.index); at > 0 && !id; at = text.lastIndexOf('\n\t\t"', at - 1)) {
      head.lastIndex = at;
      id = head.exec(text)?.[1] || '';
    }
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Every look the table has, with the sides each dresses. */
export function towerLooks(text: string): TowerLook[] {
  return towerLookIds(text).map((id) => {
    const v = itemVisuals(text, id);
    const sides = new Set<Side>();
    const models: Partial<Record<Side, string>> = {};
    for (const m of v?.modifiers || []) {
      if (!ENTITY.test(m.type)) continue;
      const s = sideOf(m.asset);
      if (s) sides.add(s);
      if (s && m.modifier && !models[s]) models[s] = m.modifier;
    }
    return { id, name: v?.name || id, sides: (['radiant', 'dire'] as Side[]).filter((s) => sides.has(s)), models };
  }).filter((l) => l.sides.length);
}

const compiled = (p: string) => `${p.replace(/\.(vmdl|vpcf)$/i, (x) => x.toLowerCase())}_c`;

/** What a look's visuals put under which name for one side. */
export function towerPlan(modifiers: AssetModifier[], side: Side): TowerPlan {
  const files = new Map<string, string>();
  const skipped: string[] = [];
  for (const m of modifiers) {
    if (ENTITY.test(m.type)) {
      // one model for all ten towers of the side: the last one named wins, as they are all the same
      if (sideOf(m.asset) === side && m.modifier) files.set(compiled(DEFAULT_TOWER[side]), compiled(m.modifier));
    } else if (m.type === 'model' || m.type === 'particle' || m.type === 'particle_clientside') {
      if (m.asset && m.modifier && sideOf(m.asset) === side) files.set(compiled(m.asset), compiled(m.modifier));
    } else if ((sideOf(m.asset || m.modifier) ?? side) === side) {
      // named for the other side: that side's pak says it
      skipped.push(`${m.type}${m.modifier ? ` ${m.modifier}` : ''}`);
    }
  }
  return { files: [...files].map(([at, from]) => ({ at, from })), skipped: [...new Set(skipped)] };
}

/** A look for one side or both as one VPK, out of the game's pak01. A file the game lacks is left out and named. */
export function buildTowerLook({ pak01, text, id, sides }: { pak01: string; text: string; id: string; sides: Side[] }): {
  vpk: Buffer; name: string; files: number; missing: string[]; skipped: string[];
} {
  const r = buildTowers({ pak01, text, radiant: sides.includes('radiant') ? id : null, dire: sides.includes('dire') ? id : null });
  return { ...r, name: r.names[0] };
}

/** Each side's towers in a look of its own, or as they are where its id is null: one VPK out of pak01. */
export function buildTowers({ pak01, text, radiant, dire }: { pak01: string; text: string; radiant?: string | null; dire?: string | null }): {
  vpk: Buffer; names: string[]; files: number; missing: string[]; skipped: string[];
} {
  const files: TowerPlan['files'] = [];
  const skipped = new Set<string>();
  const names: string[] = [];
  for (const [side, id] of [['radiant', radiant], ['dire', dire]] as const) {
    if (!id) continue;
    const v = itemVisuals(text, id);
    if (!v) throw new Error(`towers: no item ${id}`);
    const plan = towerPlan(v.modifiers, side);
    if (!plan.files.some((f) => f.at === compiled(DEFAULT_TOWER[side]))) throw new Error(`towers: ${v.name} has no ${side} tower`);
    files.push(...plan.files);
    for (const s of plan.skipped) skipped.add(s);
    if (!names.includes(v.name)) names.push(v.name);
  }
  if (!files.length) throw new Error('towers: pick a look for Radiant or Dire');
  const index = sharedVpkIndex(pak01);
  const entries = [];
  const missing: string[] = [];
  const towers = new Set(Object.values(DEFAULT_TOWER).map(compiled));
  for (const f of files) {
    const data = index.read(f.from);
    const plain = towers.has(f.at) ? index.read(f.at) : null;
    if (data) entries.push(entryAt(f.at, plain ? asTower(data, plain) : data));
    else missing.push(f.from);
  }
  return { vpk: buildVpk(entries), names, files: entries.length, missing, skipped: [...skipped] };
}

const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);
const items = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);
const text = (n: Kv3Node | undefined) => (n?.kind === 'string' ? n.value : '');

/** The activities a look's tower plays while the item is on, and the plain tower's for each. */
const PLAIN_ACT: Record<string, string> = {
  ACT_DOTA_CUSTOM_TOWER_IDLE: 'ACT_DOTA_IDLE', ACT_DOTA_CUSTOM_TOWER_IDLE_RARE: 'ACT_DOTA_IDLE_RARE',
  ACT_DOTA_CUSTOM_TOWER_ATTACK: 'ACT_DOTA_ATTACK', ACT_DOTA_CUSTOM_TOWER_DIE: 'ACT_DOTA_DIE',
};

/**
 * A look's tower model made to play as the plain tower (Discord, Stoneclaw Scavengers: the crab
 * stood turned away and moved only its claws). The item's towers play activities of their own
 * (ACT_DOTA_CUSTOM_TOWER_IDLE), which the tower asks for only while the item is on, and each of
 * them is an aim matrix that turns the crab by a pose parameter the plain tower never sets. So the
 * plain activity goes on the matrix's middle part (@idle_neutral, facing forward), the sequences are
 * numbered as the plain tower's (the server sends the number), and so are the attachments its
 * projectile leaves from. A model with none of those activities is only numbered.
 */
export function asTower(model: Buffer, plain: Buffer): Buffer {
  const acted = plainActivities(model);
  return attachedAs(numberedAs(acted, plain) ?? acted, plain);
}

function plainActivities(model: Buffer): Buffer {
  try {
    if (!resourceBlocks(model).some((b) => b.name === 'ASEQ')) return model;
    const block = resourceBlock(model, 'ASEQ');
    const kv = readKv3(block.data);
    const names = items(member(kv.root, 'm_localSequenceNameArray')).map(text);
    const descs = items(member(kv.root, 'm_localS1SeqDescArray'));
    const byName = new Map(descs.map((d) => [text(member(d, 'm_sName')), d]));
    let changed = false;
    for (const d of descs) {
      const acts = member(d, 'm_activityArray');
      const first = items(acts).find((a) => Object.hasOwn(PLAIN_ACT, text(member(a, 'm_name'))));
      if (acts?.kind !== 'array' || first?.kind !== 'object') continue;
      const refs = items(member(member(d, 'm_fetch'), 'm_localReferenceArray'))
        .map((r) => (r.kind === 'number' ? names[numberOf(kv, r)] ?? '' : ''));
      const part = refs.length > 1 ? byName.get(refs.find((n) => /neutral/i.test(n)) ?? refs[Math.floor(refs.length / 2)]) : d;
      if (part?.kind !== 'object') continue;
      const act = { ...first, members: new Map(first.members).set('m_name', { kind: 'string', value: PLAIN_ACT[text(member(first, 'm_name'))] }) };
      part.members.set('m_activityArray', { ...acts, items: [act] });
      changed = true;
    }
    return changed ? block.replace(writeKv3(kv)) : model;
  } catch {
    return model;
  }
}
