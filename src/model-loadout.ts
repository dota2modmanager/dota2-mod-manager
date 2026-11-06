/* The animation a hero plays on the game's loadout screen, for the 3D preview (issue #417).
 *
 * A hero's model lists its sequences in its ASEQ block, each with the activities it answers to: the
 * first is an ACT_ name, the rest are modifiers an item can switch on. The loadout plays the
 * sequence for ACT_DOTA_LOADOUT; the names differ per hero (Abaddon's loadout_anim, Juggernaut's
 * loadout_default_anim, Pudge's pudge_loadout), so they are read out of the model, not guessed.
 *
 * An item can bring its own: Pudge's Dragonclaw Hook plays pudge_loadout under "whalehook". The
 * sequence picked is the one whose modifiers are all among the items worn, with the most of them;
 * with none worn, the plain one with no modifier at all. ACT_DOTA_LOADOUT_STATUE is a still pose
 * for statues and is not the loadout. */
import { readKv3, type Kv3Node } from './kv3.ts';
import { resourceBlock, resourceBlocks } from './resource.ts';

/** A sequence's name and every activity it answers to, the ACT_ one and its modifiers. */
export interface Sequence { name: string; acts: string[] }

const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);
const items = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);
const text = (n: Kv3Node | undefined) => (n?.kind === 'string' ? n.value : '');

/** The model's sequences, or none when the file has no sequence block or one this reader cannot take. */
export function modelSequences(model: Buffer | null): Sequence[] {
  try {
    if (!model || !resourceBlocks(model).some((b) => b.name === 'ASEQ')) return [];
    const kv = readKv3(resourceBlock(model, 'ASEQ').data);
    return items(member(kv.root, 'm_localS1SeqDescArray')).map((d) => ({
      name: text(member(d, 'm_sName')),
      acts: items(member(d, 'm_activityArray')).map((a) => text(member(a, 'm_name'))).filter(Boolean),
    })).filter((s) => s.name);
  } catch {
    return [];
  }
}

/** The kinds of motion the 3D preview's list goes by, in its order. */
const MOTION_GROUPS = ['stance', 'idle', 'run', 'attack', 'ability', 'emote', 'other'] as const;
/** A kind of motion in that list. */
export type MotionGroup = typeof MOTION_GROUPS[number];

const motionGroup = (act: string): MotionGroup => {
  if (/^ACT_DOTA_(LOADOUT|SPAWN)/.test(act)) return 'stance';
  if (act.startsWith('ACT_DOTA_IDLE')) return 'idle';
  if (/^ACT_DOTA_(RUN|WALK)/.test(act)) return 'run';
  if (act.startsWith('ACT_DOTA_ATTACK')) return 'attack';
  if (/^ACT_DOTA_(CAST|OVERRIDE_ABILITY|GENERIC_CHANNEL|CHANNEL)/.test(act)) return 'ability';
  if (/^ACT_DOTA_(TAUNT|VICTORY)/.test(act)) return 'emote';
  return 'other';
};

/**
 * What the body can be shown doing, by kind. A sequence with no activity is a layer of another one
 * ("@counter_helix") or the bind pose, and a statue's activity is the same motion again (Axe's
 * "attack_main" under his "attack_main_anim").
 */
export function motionList(seqs: Sequence[]): { name: string; group: MotionGroup }[] {
  const out = seqs.filter((s) => s.acts.length && !s.acts[0].includes('_STATUE')).map((s) => ({ name: s.name, group: motionGroup(s.acts[0]) }));
  return MOTION_GROUPS.flatMap((g) => out.filter((m) => m.group === g));
}

const LOADOUT = 'ACT_DOTA_LOADOUT';
const IDLE = 'ACT_DOTA_IDLE';

/** The plain idle: the sequence named "idle", else an idle with no modifier ("arcana_idle_anim"). */
export function idleSequence(seqs: Sequence[]): string | null {
  return seqs.find((s) => s.name === 'idle')?.name
    ?? seqs.find((s) => s.acts.length === 1 && s.acts[0] === IDLE)?.name ?? null;
}

/**
 * The loadout sequence for what the hero wears, or null for a model that has none.
 * @param modifiers  the activity modifiers of the items worn, as items_game names them
 */
export function loadoutSequence(seqs: Sequence[], modifiers: string[] = []): string | null {
  const worn = new Set(modifiers.map((m) => m.toLowerCase()));
  const mods = (s: Sequence) => s.acts.filter((a) => !a.startsWith('ACT_')).map((a) => a.toLowerCase());
  let loadouts = seqs.filter((s) => s.acts.includes(LOADOUT)).map((s) => ({ name: s.name, mods: mods(s) }));
  // a body of its own (Crystal Maiden's arcana) writes its loadout as an idle with the "loadout" modifier
  if (!loadouts.length) {
    loadouts = seqs.filter((s) => s.acts.includes(IDLE) && mods(s).includes('loadout'))
      .map((s) => ({ name: s.name, mods: mods(s).filter((m) => m !== 'loadout') }));
  }
  const fits = loadouts.filter((s) => s.mods.length && s.mods.every((m) => worn.has(m)))
    .sort((a, b) => b.mods.length - a.mods.length);
  return (fits[0] || loadouts.find((s) => !s.mods.length) || loadouts[0])?.name ?? null;
}

/** The activity modifiers an item's visuals switch on: Dragonclaw Hook's "whalehook". */
export function itemActivities(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/"asset_modifier\d*"\s*\{([^{}]*)\}/gi)) {
    const body = m[1];
    if (!/"type"\s+"activity"/i.test(body)) continue;
    const style = /"style"\s+"(\d+)"/i.exec(body)?.[1];
    const mod = /"modifier"\s+"([^"]+)"/i.exec(body)?.[1];
    if (mod && (!style || style === '0')) out.push(mod);
  }
  return out;
}
