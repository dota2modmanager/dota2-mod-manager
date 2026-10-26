/**
 * `modkit sounds`: a hero's sound events, read, changed and compiled again with sounds of your own.
 *
 *   modkit sounds necrolyte                                   every event: type and sound files
 *   modkit sounds necrolyte --show Hero_Necrolyte.DeathPulse  one event, every key
 *   modkit sounds necrolyte --addon my_mod --out work/mod \
 *     --replace Hero_Necrolyte.Attack=work/knife.wav          the event plays your sound instead
 *     --layer Hero_Necrolyte.DeathPulse=work/scream.wav@0.9   and Valve's, yours on top (volume 0.9)
 *     --add Hero_Necrolyte.Scream.ring=work/ring.wav          a new event, for a clip's AE_CL_PLAYSOUND
 *     --like Hero_Necrolyte.DeathPulse                        the event to copy for --add, and for an
 *                                                             event with no sound of its own
 *   --vo works on the hero's voice file instead (soundevents/voscripts/game_sounds_vo_<hero>):
 *   the hero picker loads only that one, so sounds of the picker's entrance go there.
 *
 * The events file is written as KV3 text into the addon and compiled by Valve's resourcecompiler,
 * as Valve's own are (the compile also lists the sounds each event uses); the .wav files go next to
 * it and compile to .vsnd. The compiled files land in --out, ready for `modkit pack`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runCompiler } from './commands.mjs';
import { pak01, src } from './game.mjs';
import { heroId, listOf } from './lib.mjs';

/** KV3 text of a node, the way Valve's own sources are written. A {kind:'literal'} prints as is. */
export function kvText(n, numberOf, ind = 0) {
  const t = '\t'.repeat(ind);
  if (n.kind === 'literal') return n.text;
  if (n.kind === 'object') {
    return `{\n${[...n.members].map(([k, v]) => `${t}\t${/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : JSON.stringify(k)} = ${kvText(v, numberOf, ind + 1)}\n`).join('')}${t}}`;
  }
  if (n.kind === 'array') return `[\n${n.items.map((v) => `${t}\t${kvText(v, numberOf, ind + 1)},\n`).join('')}${t}]`;
  if (n.kind === 'string') return JSON.stringify(n.value);
  if (n.kind === 'number') {
    const v = numberOf(n);
    return n.cell?.float ? (Number.isInteger(v) ? v.toFixed(1) : String(+v.toFixed(6))) : String(v);
  }
  if (n.kind === 'other' && n.type === 2) return n.value ? 'true' : 'false';
  if (n.kind === 'other' && n.type === 1) return 'null';
  throw new Error(`no KV3 text for a ${n.kind} of type ${n.type}`);
}

const literal = (text) => ({ kind: 'literal', text });
const str = (value) => ({ kind: 'string', value });

/** "Event=file.wav@0.9" -> {event, file, volume} */
export function soundSpec(text) {
  const m = /^([^=]+)=(.+?)(?:@([\d.]+))?$/.exec(text);
  if (!m) throw new Error(`"${text}": write Event.Name=path/to/sound.wav, with @volume at the end if you like`);
  return { event: m[1], file: m[2], volume: m[3] ? Number(m[3]) : null };
}

/** The sound files an event plays, whether it lists them or names one. */
export function filesOf(ev) {
  const f = ev.members.get('vsnd_files');
  if (!f) return [];
  return f.kind === 'array' ? f.items.map((x) => x.value) : [f.value];
}

/** An event playing only this sound, made from a template event (its type, level, mix group...). */
export function eventFor(template, vsnd, volume) {
  const m = new Map(template.members);
  const files = m.get('vsnd_files');
  m.set('vsnd_files', files && files.kind === 'string' ? str(vsnd) : { kind: 'array', items: [str(vsnd)] });
  for (const k of [...m.keys()]) if (k === 'vsnd_duration' || k.startsWith('soundevent_layer')) m.delete(k);
  if (volume != null) m.set('volume', literal(volume.toFixed(6).replace(/0+$/, '0')));
  return { ...template, members: m };
}

/** The event with another event played on top of it, in its first free layer (Valve's own start at 2). */
export function withLayer(ev, layerName) {
  let n = 2;
  while (ev.members.has(`soundevent_layer${n}`)) n++;
  const m = new Map(ev.members);
  m.set(`soundevent_layer${n}`, str(layerName));
  m.set(`soundevent_layer${n}_on`, literal('1'));
  return { ...ev, members: m };
}

/** Format of a .wav, and what the compiler and the game expect of it. */
export function wavInfo(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return { ok: false, why: 'not a WAV file' };
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4), size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      const format = buf.readUInt16LE(at + 8), channels = buf.readUInt16LE(at + 10), rate = buf.readUInt32LE(at + 12), bits = buf.readUInt16LE(at + 22);
      const why = format !== 1 ? 'not plain PCM' : bits !== 16 ? `${bits}-bit, the compiler wants 16-bit` : ![44100, 48000, 22050].includes(rate) ? `${rate} Hz, use 44100` : null;
      return { ok: !why, why, channels, rate, bits };
    }
    at += 8 + size + (size & 1);
  }
  return { ok: false, why: 'no fmt chunk' };
}

export async function sounds(opts) {
  const { game, index } = await pak01(opts);
  const { HERO_DISPLAY } = await src('hero-names.ts');
  const { readKv3, numberOf } = await src('kv3.ts');
  const { dataBlock } = await src('resource.ts');
  const target = opts._[0];
  if (!target) throw new Error('usage: modkit sounds <hero or soundevents/...vsndevts_c> [--show Event] [--addon a --out dir --replace|--layer|--add Event=file.wav]');
  let rel = target;
  if (!/\.vsndevts_c$/.test(target)) {
    const hero = heroId(target, HERO_DISPLAY);
    rel = opts.vo ? `soundevents/voscripts/game_sounds_vo_${hero}.vsndevts_c` : `soundevents/game_sounds_heroes/game_sounds_${hero}.vsndevts_c`;
  }
  const raw = index.read(rel);
  if (!raw) throw new Error(`no ${rel} in pak01 (modkit find vsndevts ${target})`);
  const kv = readKv3(dataBlock(raw).data);
  const events = kv.root.members;
  const num = (n) => numberOf(kv, n);

  if (typeof opts.show === 'string') {
    const ev = events.get(opts.show);
    if (!ev) throw new Error(`no event ${opts.show} in ${rel}`);
    console.log(`${opts.show} = ${kvText(ev, num)}`);
    return;
  }
  const edits = [...listOf(opts.replace).map((s) => ['replace', soundSpec(s)]), ...listOf(opts.layer).map((s) => ['layer', soundSpec(s)]),
    ...listOf(opts.add).map((s) => ['add', soundSpec(s)])];
  if (!edits.length) {
    for (const [name, ev] of events) {
      const type = ev.members.get('type')?.value ?? '';
      console.log(`${name.padEnd(48)} ${type.padEnd(24)} ${filesOf(ev).join(', ')}`);
    }
    console.log(`\n${events.size} events in ${rel}`);
    return;
  }

  const addon = opts.addon;
  if (!addon || !/^[a-z0-9_]{1,64}$/.test(addon) || !opts.out) throw new Error('changing events needs --addon <name> (lower case, digits, _) and --out <dir>');
  const content = path.join(path.dirname(game), 'content', 'dota_addons', addon);
  const compiled = path.join(game, 'dota_addons', addon);
  const like = typeof opts.like === 'string' ? events.get(opts.like) : null;
  if (opts.like && !like) throw new Error(`no event ${opts.like} to copy`);
  const wavs = new Map();
  const soundPath = (file) => {
    const base = path.basename(file).replace(/\.(wav|mp3)$/i, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const vsnd = `sounds/mods/${addon}/${base}.vsnd`;
    if (!fs.existsSync(file)) throw new Error(`no sound file ${file}`);
    const info = file.toLowerCase().endsWith('.wav') ? wavInfo(fs.readFileSync(file)) : { ok: true };
    if (!info.ok) throw new Error(`${file}: ${info.why}`);
    wavs.set(vsnd, file);
    return { vsnd, base, info };
  };
  const template = (name) => {
    const ev = events.get(name);
    if (ev && filesOf(ev).length) return ev;
    if (like) return like;
    throw new Error(`${name} plays no sound of its own (${ev?.members.get('type')?.value ?? 'no such event'}): give --like <an event that does>`);
  };
  for (const [what, { event, file, volume }] of edits) {
    const { vsnd, base, info } = soundPath(file);
    if (what === 'replace') events.set(event, eventFor(template(event), vsnd, volume));
    if (what === 'add') {
      if (events.has(event)) throw new Error(`${event} is there already: use --replace`);
      if (!like) throw new Error('--add needs --like <event to copy>');
      events.set(event, eventFor(like, vsnd, volume));
    }
    if (what === 'layer') {
      const ev = events.get(event);
      if (!ev) throw new Error(`no event ${event} in ${rel}`);
      const name = `${event}.mod_${base}`;
      events.set(name, eventFor(template(event), vsnd, volume));
      events.set(event, withLayer(ev, name));
    }
    console.log(`${what} ${event}: ${vsnd}${info.channels === 2 ? ' (stereo: mono sounds right in the world, stereo only for the UI)' : ''}`);
  }

  const sources = [];
  for (const [vsnd, file] of wavs) {
    const dst = path.join(content, vsnd.replace(/\.vsnd$/, path.extname(file).toLowerCase()));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(file, dst);
    sources.push(dst);
  }
  const eventsSrc = path.join(content, rel.replace(/_c$/, ''));
  fs.mkdirSync(path.dirname(eventsSrc), { recursive: true });
  fs.writeFileSync(eventsSrc, `<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:generic:version{7412167c-06e9-4698-aff2-e63eb59037e7} -->\n${kvText(kv.root, num)}\n`);
  fs.mkdirSync(compiled, { recursive: true });
  const r = runCompiler(game, [...sources, eventsSrc]);
  if (!r.ok) throw new Error(`the compiler failed:\n${r.lines.filter((l) => /rror|failed/.test(l)).slice(-20).join('\n')}`);
  for (const p of [rel, ...[...wavs.keys()].map((v) => `${v}_c`)]) {
    const out = path.join(opts.out, p);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(compiled, p), out);
  }
  console.log(`compiled ${rel} and ${wavs.size} sound(s) into ${opts.out}`);
}
