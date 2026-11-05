/* A sound of the user's own on one of a hero's sound events (issue #423): the hero's events file
 * out of the game, each chosen event made to play the user's sound instead of Valve's or on top of
 * it, written back as KV3 text and compiled with the user's WAVs by Valve's resourcecompiler
 * (src/resource-compiler.ts). The window and the service are src/ability-sounds-service.ts.
 *
 * Text, not binary: a events file written back as binary KV3 is dropped by the game in silence,
 * every sound of the hero with it (skills/dota2-modding/references/sounds.md). Compiled from text,
 * the compiler also measures each sound and lists the files the events use.
 *
 * The same rules tools/modkit/sounds.mjs has used on the Scream set: a replaced event keeps its
 * template's type, level and mix group and loses its layers and length; a layered event gets a new
 * event of the user's sound in its first free soundevent_layer, the way Valve's immortals layer.
 */
import { numberOf, type Kv3Block, type Kv3Node } from './kv3.ts';
import type { VpkIndex } from './vpk.ts';

/** How the user's sound goes on an event: instead of Valve's, or played with it. */
export type SoundMode = 'replace' | 'layer';

/** One event given a sound of the user's own. `sound` names the stored WAV (its sha1). */
export interface SoundEdit { event: string; mode: SoundMode; volume: number; sound: string; name: string }

/** An event of the hero's, as the window lists it. */
export interface HeroEvent { name: string; type: string; files: number }

type Obj = Extract<Kv3Node, { kind: 'object' }>;

/** The hero's events file in pak01: abilities, attacks, death, everything heard in a match. */
export const eventsFile = (hero: string) => `soundevents/game_sounds_heroes/game_sounds_${hero}.vsndevts_c`;

/** Where a sound of the user's goes, compiled: one folder of ours per hero. */
export const soundPath = (hero: string, sound: string) => `sounds/mods/d2mm/${hero}/${sound.slice(0, 16)}.vsnd`;

/**
 * The hero an events file is for, where its name leaves out the underscores the hero's own id has
 * (game_sounds_crystalmaiden for crystal_maiden). Counted on the game of 2026-11-05: these nine.
 */
const SOUND_HERO: Record<string, string> = {
  crystalmaiden: 'crystal_maiden', doombringer: 'doom_bringer', drowranger: 'drow_ranger', nightstalker: 'night_stalker',
  sandking: 'sand_king', shadowshaman: 'shadow_shaman', skeletonking: 'skeleton_king', stormspirit: 'storm_spirit', witchdoctor: 'witch_doctor',
};
/** The hero's own id for an events file's name: "crystalmaiden" is "crystal_maiden". */
export const soundHero = (file: string): string => SOUND_HERO[file] || file;

/** The heroes that have an events file, by the file's name (an event's sounds of the release kind are not a hero's). */
export function heroesWithSounds(ix: Pick<VpkIndex, 'paths'>): string[] {
  const out: string[] = [];
  for (const p of ix.paths()) {
    const m = /^soundevents\/game_sounds_heroes\/game_sounds_([a-z0-9_]+)\.vsndevts_c$/.exec(p);
    if (m && !m[1].endsWith('_release_event')) out.push(m[1]);
  }
  return out.sort();
}

const filesOf = (ev: Kv3Node | undefined): string[] => {
  const f = ev?.kind === 'object' ? ev.members.get('vsnd_files') : undefined;
  if (f?.kind === 'array') return f.items.flatMap((x) => (x.kind === 'string' ? [x.value] : []));
  return f?.kind === 'string' ? [f.value] : [];
};
const typeOf = (ev: Kv3Node | undefined) => {
  const v = ev?.kind === 'object' ? ev.members.get('type') : undefined;
  return v?.kind === 'string' ? v.value : '';
};

/** The events a sound can be put on: those that play one. An event of ours made by a layer is left out. */
export function heroEvents(kv: Kv3Block): HeroEvent[] {
  if (kv.root.kind !== 'object') return [];
  return [...kv.root.members].filter(([name, ev]) => filesOf(ev).length && !name.includes('.d2mm_'))
    .map(([name, ev]) => ({ name, type: typeOf(ev), files: filesOf(ev).length }));
}

const str = (value: string): Kv3Node => ({ kind: 'string', value });
/** Text put in the file as it is: a number written the way Valve writes it. */
const literal = (text: string) => ({ kind: 'literal', text }) as unknown as Kv3Node;

/** An event playing only `vsnd`, made from `template` (its type, level, mix group...). */
function eventFor(template: Obj, vsnd: string, volume: number): Obj {
  const m = new Map(template.members);
  const files = m.get('vsnd_files');
  m.set('vsnd_files', files?.kind === 'string' ? str(vsnd) : { kind: 'array', items: [str(vsnd)] });
  for (const k of [...m.keys()]) if (k === 'vsnd_duration' || k.startsWith('soundevent_layer')) m.delete(k);
  m.set('volume', literal(volume.toFixed(2)));
  return { ...template, members: m };
}

/** `ev` with the event `layer` played on top of it, in its first free layer (Valve's start at 2). */
function withLayer(ev: Obj, layer: string): Obj {
  let n = 2;
  while (ev.members.has(`soundevent_layer${n}`)) n++;
  const m = new Map(ev.members);
  m.set(`soundevent_layer${n}`, str(layer));
  m.set(`soundevent_layer${n}_on`, literal('1'));
  return { ...ev, members: m };
}

/**
 * The hero's events with the user's sounds on them, as the KV3 text the compiler reads.
 * An event the game no longer has is passed over and named in `gone`.
 */
export function editedEvents(kv: Kv3Block, hero: string, edits: SoundEdit[]): { text: string; gone: string[] } {
  if (kv.root.kind !== 'object') throw new Error('the events file has no events');
  const events = new Map(kv.root.members);
  const gone: string[] = [];
  for (const e of edits) {
    const ev = events.get(e.event);
    if (ev?.kind !== 'object' || !filesOf(ev).length) { gone.push(e.event); continue; }
    const vsnd = soundPath(hero, e.sound);
    if (e.mode === 'replace') { events.set(e.event, eventFor(ev, vsnd, e.volume)); continue; }
    const name = `${e.event}.d2mm_${e.sound.slice(0, 8)}`;
    events.set(name, eventFor(ev, vsnd, e.volume));
    events.set(e.event, withLayer(ev, name));
  }
  const header = '<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->';
  return { text: `${header}\n${kvText(kv, { kind: 'object', members: events })}\n`, gone };
}

/** KV3 text of a node, the way Valve's own sources are written. */
export function kvText(kv: Kv3Block, n: Kv3Node, ind = 0): string {
  const t = '\t'.repeat(ind);
  const any = n as unknown as { kind: string; text?: string };
  if (any.kind === 'literal') return String(any.text);
  if (n.kind === 'object') {
    return `{\n${[...n.members].map(([k, v]) => `${t}\t${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k)} = ${kvText(kv, v, ind + 1)}\n`).join('')}${t}}`;
  }
  if (n.kind === 'array') return `[\n${n.items.map((v) => `${t}\t${kvText(kv, v, ind + 1)},\n`).join('')}${t}]`;
  if (n.kind === 'string') return JSON.stringify(n.value);
  if (n.kind === 'number') {
    const v = numberOf(kv, n);
    return n.cell?.float ? (Number.isInteger(v) ? v.toFixed(1) : String(+v.toFixed(6))) : String(v);
  }
  if (n.kind === 'other' && n.type === 2) return n.value ? 'true' : 'false';
  // the same two answers, as a type of their own and with no value (limiter_stop_oldest has them)
  if (n.kind === 'other' && n.type === 13) return 'true';
  if (n.kind === 'other' && n.type === 14) return 'false';
  if (n.kind === 'other' && n.type === 1) return 'null';
  throw new Error(`no KV3 text for a ${n.kind} of type ${n.kind === 'other' ? n.type : '?'}`);
}

/** Is this a WAV the compiler takes: plain 16-bit PCM at a rate the game plays. Null when it is. */
export function wavProblem(buf: Buffer): string | null {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return 'not a WAV file';
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ' && at + 24 <= buf.length) {
      const format = buf.readUInt16LE(at + 8);
      const rate = buf.readUInt32LE(at + 12);
      const bits = buf.readUInt16LE(at + 22);
      if (format !== 1) return 'not plain PCM';
      if (bits !== 16) return `${bits}-bit, the compiler wants 16-bit`;
      return [22050, 44100, 48000].includes(rate) ? null : `${rate} Hz, use 44100`;
    }
    at += 8 + size + (size & 1);
  }
  return 'no fmt chunk';
}
