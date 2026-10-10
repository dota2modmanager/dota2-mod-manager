/**
 * The mod doctor: what is wrong with a mod, found in its files and the game's, before anybody
 * starts the game to see it (issue #118).
 *
 * Every check here is a bug that reached the game once and took a person playing it to find:
 * - a model whose animations need an activity modifier only an item turns on ("abysm"): without
 *   the item an attack plays nothing, or the wrong one. Read from the animation clips (ANIM) as
 *   well as the sequences (ASEQ): the game picks by the clips, and a fix to the sequences alone
 *   changed nothing in the game;
 * - a model whose sequences are in another order than the game's model at that path: if the
 *   server online picks a sequence by number from its own model, the client plays another one;
 * - a particle that hangs more children on itself than it hands control points to: the extra
 *   ones are drawn at its first point (the arcana's chest glow at the right eye);
 * - a particle child that neither the mod nor the game has, or that its RERL block does not name.
 * Each finding names the file, says what happens in the game, and how sure it is. A model named
 * inside for another path than its own is only a note: the arcana mods in the catalog all are, and
 * the game plays them.
 */
import { readKv3, numberOf, type Kv3Node } from './kv3.ts';
import { dataBlock, references, resourceBlock, resourceBlocks } from './resource.ts';
import { listVpkPathsFile, openVpkIndex } from './vpk.ts';

export interface Finding {
  file: string;
  /** an error breaks something in the game, a warning may, a note is worth knowing */
  level: 'error' | 'warning' | 'note';
  what: string;
}

const member = (n: Kv3Node | undefined, key: string) => (n?.kind === 'object' ? n.members.get(key) : undefined);
const text = (n: Kv3Node | undefined) => (n?.kind === 'string' ? n.value : '');
const items = (n: Kv3Node | undefined) => (n?.kind === 'array' ? n.items : []);

type Playable = { name: string; acts: string[]; mods: string[] };

function playables(file: Buffer, block: string, listKey: string, nameKey: string): Playable[] {
  if (!resourceBlocks(file).some((b) => b.name === block)) return [];
  const kv = readKv3(resourceBlock(file, block).data);
  return items(member(kv.root, listKey)).map((x) => {
    // the first activity is the one played, every other entry a modifier: the game took the
    // activity named again in place of "abysm" for a modifier too, and played nothing
    const names = items(member(x, 'm_activityArray')).map((a) => text(member(a, 'm_name')));
    const at = names.findIndex((n) => n.startsWith('ACT_'));
    return { name: text(member(x, nameKey)), acts: at === -1 ? [] : [names[at]], mods: names.filter((_, i) => i !== at) };
  });
}

/** A model's sequences: name, the activities it plays and the modifiers it needs. */
export const sequencesOf = (file: Buffer) => playables(file, 'ASEQ', 'm_localS1SeqDescArray', 'm_sName');
/** A model's animation clips, the same way: the lists the game picks by. */
export const clipsOf = (file: Buffer) => playables(file, 'ANIM', 'm_animArray', 'm_name');

/** Activity modifiers the game itself turns on for a hero, with no item: these need no warning. */
const GAME_MODIFIERS = new Set(['injured', 'haste', 'loadout', 'run', 'walk', 'aggressive', 'odachi', 'fast', 'faster', 'fastest', 'slow', 'arcana_level_2']);

function checkModel(path: string, file: Buffer, game: Buffer | null): Finding[] {
  const out: Finding[] = [];
  const kv = readKv3(dataBlock(file).data);
  const name = text(member(kv.root, 'm_name'));
  const wanted = path.replace(/_c$/, '');
  if (name && name !== wanted) {
    out.push({ file: path, level: 'note', what: `named "${name}" inside, put under "${wanted}"` });
  }
  const seqs = sequencesOf(file);
  for (const [kind, list] of [['clips', clipsOf(file)], ['sequences', seqs]] as const) {
    for (const act of new Set(list.flatMap((s) => s.acts))) {
      const playing = list.filter((s) => s.acts.includes(act));
      // a hero standing healthy has no modifier on: one has to play with none at all
      // ("attack_injured" plays only below a share of health, so it is no attack)
      if (playing.some((s) => s.mods.length === 0)) continue;
      const need = [...new Set(playing.flatMap((s) => s.mods.filter((m) => !GAME_MODIFIERS.has(m))))];
      if (!need.length) continue; // only the game's own states ask for it, like a spawn in loadout
      out.push({ file: path, level: 'error', what: `${act} plays only with the modifier ${need.map((m) => `"${m}"`).join(' or ')} in its ${kind}, which an item turns on: without it, nothing or the wrong animation plays` });
    }
  }
  if (game) {
    const theirs = sequencesOf(game).map((s) => s.name);
    const ours = seqs.map((s) => s.name);
    const at = theirs.findIndex((n, i) => ours[i] !== n);
    if (at !== -1) {
      out.push({ file: path, level: 'warning', what: `sequence ${at} is "${ours[at] ?? 'none'}" here and "${theirs[at]}" in the game's model: if the server online picks by number from its own, from there on other animations play` });
    }
  }
  return out;
}

/** The attachment a particle's first configuration puts control point 0 on (its preview). */
function firstAttachment(file: Buffer): string {
  const kv = readKv3(dataBlock(file).data);
  const drivers = items(member(items(member(kv.root, 'm_controlPointConfigurations'))[0], 'm_drivers'));
  const first = drivers.find((d) => {
    const cp = member(d, 'm_iControlPoint');
    return !cp || (cp.kind === 'number' && numberOf(kv, cp) === 0);
  });
  return text(member(first, 'm_attachmentName'));
}

function checkParticle(path: string, file: Buffer, exists: (p: string) => boolean, read: (p: string) => Buffer | null): Finding[] {
  const out: Finding[] = [];
  const kv = readKv3(dataBlock(file).data);
  const children = items(member(kv.root, 'm_Children')).map((c) => text(member(c, 'm_ChildRef'))).filter(Boolean);
  if (!children.length) return out;
  const named = new Set(references(file));
  for (const c of new Set(children)) {
    if (!exists(`${c}_c`)) out.push({ file: path, level: 'error', what: `child ${c} is in neither the mod nor the game` });
    else if (!named.has(c)) out.push({ file: path, level: 'note', what: `child ${c} is not named in RERL, so the game may not load it ahead` });
  }
  const spread = items(member(kv.root, 'm_PreEmissionOperators'))
    .find((o) => text(member(o, '_class')) === 'C_OP_SetParentControlPointsToChildCP');
  const count = member(spread, 'm_nNumControlPoints');
  if (spread && count?.kind === 'number') {
    // children past the ones handed a point of their own share the parent's first point; Valve
    // does that on purpose all the time, so it is wrong only where the child is made for another
    // attachment than the one that point is on (the arcana's chest glow at the right eye)
    const n = numberOf(kv, count);
    const parentAt = firstAttachment(file);
    for (const c of children.slice(n)) {
      const child = read(`${c}_c`);
      const childAt = child ? firstAttachment(child) : '';
      if (parentAt && childAt && childAt !== parentAt) {
        out.push({ file: path, level: 'error', what: `child ${c} is made for ${childAt} but gets the parent's first point, on ${parentAt}: it is drawn there` });
      }
    }
  }
  return out;
}

/** Everything the doctor finds in a mod's VPK, against the game's pak01. */
export function examine({ mod, pak01 }: { mod: string; pak01: string }): Finding[] {
  const ours = openVpkIndex(mod);
  const game = openVpkIndex(pak01);
  const mine = new Set(listVpkPathsFile(mod));
  const theirs = new Set(listVpkPathsFile(pak01));
  const exists = (p: string) => mine.has(p) || theirs.has(p);
  // the mod's copy first, as the game mounts it
  const read = (p: string) => (mine.has(p) ? ours.read(p) as Buffer : theirs.has(p) ? game.read(p) as Buffer : null);
  const out: Finding[] = [];
  for (const p of mine) {
    try {
      const file = ours.read(p) as Buffer;
      if (p.endsWith('.vmdl_c')) out.push(...checkModel(p, file, theirs.has(p) ? game.read(p) as Buffer : null));
      else if (p.endsWith('.vpcf_c')) out.push(...checkParticle(p, file, exists, read));
    } catch (err) {
      out.push({ file: p, level: 'note', what: `not read: ${(err as Error).message}` });
    }
  }
  const rank = { error: 0, warning: 1, note: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.file.localeCompare(b.file));
}
