/**
 * An item's sounds and voice, as a mod gives them to a hero who does not own the item.
 *
 * The item builder's patch tells the game the stock item is the paid one, and the game draws it so.
 * It does not make the game sound like it. Which sound plays is the server's choice, made from
 * what the server knows the player owns: Bracers of the Cavern Luminar switch Hero_EarthShaker.Totem
 * to Hero_EarthShaker.Totem.Immortal, and Planetfall sets the response criterion "eartharc_cosmos"
 * that Earthshaker's response rules ask for before they speak an arcana line. A player who does not
 * own them hears the plain totem and the plain voice, offline as online.
 *
 * The client only gets the name of the event to play, and plays what its own soundevents files say
 * that event is. So the mod rewrites those files: the plain event becomes a copy of the item's.
 * - a sound swap (`sound` in the item's visuals) is one event copied over another;
 * - a voice (`response_criteria`) is every plain line of the hero's response rules made a copy of
 *   an arcana line said in the same situation: the rule asking for the item's criterion whose other
 *   requirements are the plain rule's, or failing that the one of the same concept that asks for
 *   the fewest more. Lines the item has no situation for keep the plain voice.
 * Two picks for one hero rewrite the same file, so every pick's changes go into one copy of it.
 */
import path from 'node:path';
import { dataBlock } from './resource.ts';
import { readKv3, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { entryAt, listVpkPathsFile, sharedVpkIndex, type VpkEntry, type VpkIndex } from './vpk.ts';

/** An event to play as another: the one the server names, and the one the player hears. */
export interface SoundSwap { sound: string; as: string }

/** A response criterion an item sets for a hero ("customresponse" = "eartharc_cosmos"). */
export interface VoiceCue { hero: string; key: string; value: string }

type Index = VpkIndex;
type Obj = Extract<Kv3Node, { kind: 'object' }>;

const str = (n: Kv3Node | undefined, key: string): string => {
  const v = n?.kind === 'object' ? n.members.get(key) : undefined;
  return v?.kind === 'string' ? v.value : '';
};
const list = (n: Kv3Node | undefined, key: string): Kv3Node[] => {
  const v = n?.kind === 'object' ? n.members.get(key) : undefined;
  return v?.kind === 'array' ? v.items : [];
};

/**
 * A node out of one block, to put into another: a number read from a block points into that
 * block's buffers, so it takes its bytes along (src/kv3-write.ts writes `raw` when it has it).
 */
export function detached(kv: Kv3Block, n: Kv3Node): Kv3Node {
  switch (n.kind) {
    case 'object': return { ...n, members: new Map([...n.members].map(([k, v]) => [k, detached(kv, v)])) };
    case 'array': return { ...n, items: n.items.map((x) => detached(kv, x)) };
    case 'number': {
      const raw = n.raw ?? (n.cell ? Buffer.from(kv.buffers[n.cell.buffer].subarray(n.cell.offset, n.cell.offset + n.cell.width)) : undefined);
      return { ...n, cell: null, typeAt: null, ...(raw ? { raw } : {}) };
    }
    default: return { ...n };
  }
}

/** The rules file of a hero: response_rules_<name>, spelt with or without its underscores (drowranger). */
function rulesOf(ix: Index, hero: string): Kv3Node | null {
  const name = hero.toLowerCase().replace(/^npc_dota_hero_/, '');
  for (const n of [name, name.replace(/_/g, '')]) {
    const file = ix.read(`scripts/talker/response_rules_${n}.vrr_c`);
    if (file) return readKv3(dataBlock(file).data).root;
  }
  return null;
}

/**
 * The plain lines of a hero, each as the item's line for the same situation (see the top of the
 * file). A plain line already given one keeps it: a line can be in several rules.
 */
export function voiceSwaps(rules: Kv3Node, cue: Pick<VoiceCue, 'key' | 'value'>): SoundSwap[] {
  const criteria = list(rules, 'm_Requirements');
  const named = (expr: string) => new Set(criteria
    .filter((c) => str(c, 'm_matchKey').toLowerCase() === cue.key.toLowerCase() && str(c, 'm_matchExpr') === expr)
    .map((c) => str(c, 'm_name')));
  const is = named(cue.value);
  const isNot = named(`!=${cue.value}`);
  if (!is.size) return [];
  const groups = list(rules, 'm_ResponseGroups').map((g) => {
    const req = list(g.kind === 'object' ? g.members.get('m_pEmbeddedRule') : undefined, 'm_Requirements')
      .map((r) => (r.kind === 'string' ? r.value : ''));
    const rest = req.filter((r) => !is.has(r) && !isNot.has(r));
    return {
      item: req.some((r) => is.has(r)), concept: req[0] || '', rest: new Set(rest), key: [...rest].sort().join('|'),
      lines: list(g, 'm_responses').filter((r) => str(r, 'm_type') === 'SPEAK').map((r) => str(r, 'm_value')).filter(Boolean),
    };
  }).filter((g) => g.lines.length);
  const own = groups.filter((g) => g.item);
  const out = new Map<string, string>();
  for (const plain of groups.filter((g) => !g.item)) {
    const twin = own.find((g) => g.key === plain.key)
      ?? own.filter((g) => g.concept === plain.concept && [...plain.rest].every((r) => g.rest.has(r)))
        .sort((a, b) => a.rest.size - b.rest.size)[0];
    if (!twin) continue;
    plain.lines.forEach((line, i) => { if (!out.has(line)) out.set(line, twin.lines[i % twin.lines.length]); });
  }
  return [...out].map(([sound, as]) => ({ sound, as }));
}

/**
 * The soundevents files that make these swaps and voices, each rewritten once with all of them.
 * An event the game no longer has is passed over: items_game names a few dozen of those.
 * @param gamePath  the game folder (…/dota 2 beta/game)
 */
export function soundEntries(gamePath: string, swaps: SoundSwap[], cues: VoiceCue[]): VpkEntry[] {
  if (!swaps.length && !cues.length) return [];
  const pak = path.join(gamePath, 'dota', 'pak01_dir.vpk');
  const ix = sharedVpkIndex(pak);
  const all = [...swaps];
  for (const cue of cues) {
    const rules = rulesOf(ix, cue.hero);
    if (rules) all.push(...voiceSwaps(rules, cue));
  }
  // every event, by the files that have it: 946 files, read in about 200 ms. An event can be in
  // more than one (Earthshaker's spawn lines are in his voice file and in the hero picker's), and
  // the one that plays is not ours to guess, so each copy is rewritten.
  const files = new Map<string, Kv3Block>();
  const homes = new Map<string, string[]>();
  for (const p of listVpkPathsFile(pak)) {
    if (!p.startsWith('soundevents/') || !p.endsWith('.vsndevts_c')) continue;
    try {
      const kv = readKv3(dataBlock(ix.read(p)!).data);
      files.set(p, kv);
      if (kv.root.kind === 'object') for (const k of kv.root.members.keys()) homes.set(k, [...(homes.get(k) || []), p]);
    } catch { /* a file the reader cannot open has no event anyone can swap */ }
  }
  // the item's events as the game has them, before any swap here writes over one of them
  const original = new Map<string, Kv3Node>();
  for (const { as } of all) {
    const from = homes.get(as)?.[0];
    if (from && !original.has(as)) original.set(as, detached(files.get(from)!, (files.get(from)!.root as Obj).members.get(as)!));
  }
  const changed = new Set<string>();
  for (const { sound, as } of all) {
    const event = original.get(as);
    if (!event || sound === as) continue;
    for (const at of homes.get(sound) || []) {
      (files.get(at)!.root as Obj).members.set(sound, event);
      changed.add(at);
    }
  }
  return [...changed].map((p) => entryAt(p, dataBlock(ix.read(p)!).replace(writeKv3(files.get(p)!))));
}
