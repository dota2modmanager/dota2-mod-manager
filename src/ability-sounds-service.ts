/* The window's half of a sound of the user's own on a hero's sound event (issue #423; the events
 * themselves are src/ability-sounds.ts). One record in My mods per hero, since a hero's sounds are
 * one events file and two paks of it would hide each other; each sound in it can be taken off on
 * its own, and taking off the last removes the record.
 *
 * The user's WAVs are kept in userData/ability-sounds by their sha1, so building the hero again (a
 * sound added or taken off, or after a Dota update rewrote his events file) needs nothing but what
 * the app has. The window decodes whatever the user dropped in (MP3, OGG, WAV) and hands over
 * 16-bit PCM; this side checks it again before anything is compiled.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { editedEvents, eventsFile, heroEvents, heroesWithSounds, soundPath, wavProblem, type HeroEvent, type SoundEdit, type SoundMode } from './ability-sounds.ts';
import { swapPak, writePak, type PakInstaller } from './generated-pak.ts';
import { buildVpk, sharedVpkIndex, type VpkEntry } from './vpk.ts';
import { readKv3 } from './kv3.ts';
import { dataBlock } from './resource.ts';
import { heroDisplayName } from './hero-names.ts';
import { t } from './i18n.ts';
import type { CompileJob } from './resource-compiler.ts';
import type { Library } from './library.ts';
import type { LibRecord } from './types.ts';

/** What a sounds record was built from. */
export interface SoundsGenerated { sounds: string; edits: SoundEdit[] }

/** What the window shows for a hero: his events, and the sounds already on them. */
export interface HeroSounds { hero: string; events: HeroEvent[]; edits: SoundEdit[]; recId: string | null }

/** The longest sound the window takes: 30 s of 48 kHz stereo is 5.5 MB. */
export const MAX_WAV = 8 * 1024 * 1024;

/** The service the sounds:* channels call. */
export function createAbilitySounds({ gamePath, userDataDir, installer, library, compile, log = () => {} }: {
  gamePath: () => string | null | undefined;
  userDataDir: string;
  installer: PakInstaller;
  library: Pick<Library, 'list' | 'add' | 'update' | 'removeRecord'>;
  compile: (job: CompileJob) => Promise<VpkEntry[]>;
  log?: (msg: string) => void;
}) {
  const store = path.join(userDataDir, 'ability-sounds');
  const pak01 = () => {
    const g = gamePath();
    if (!g) throw new Error(t('Не указана папка игры'));
    return sharedVpkIndex(path.join(g, 'dota', 'pak01_dir.vpk'));
  };
  const eventsOf = (hero: string) => {
    const raw = pak01().read(eventsFile(hero));
    if (!raw) throw new Error(t('У этого героя нет файла звуков'));
    return readKv3(dataBlock(raw).data);
  };
  const recordOf = (hero: string): LibRecord | null =>
    library.list().find((r) => (r.generated as SoundsGenerated | undefined)?.sounds === hero) ?? null;
  const editsOf = (hero: string) => ((recordOf(hero)?.generated as SoundsGenerated | undefined)?.edits ?? []);

  /** The hero's pak: his events with the user's sounds, and the sounds, compiled. */
  async function build(hero: string, edits: SoundEdit[]): Promise<Buffer> {
    const { text, gone } = editedEvents(eventsOf(hero), hero, edits);
    if (gone.length) log(`sounds: ${hero}: ${gone.length} events are not in the game any more, first ${gone[0]}`);
    const wavs = [...new Set(edits.map((e) => e.sound))].map((sound) => ({
      path: soundPath(hero, sound).replace(/\.vsnd$/, '.wav'),
      data: fs.readFileSync(path.join(store, `${sound}.wav`)),
    }));
    const events = { path: eventsFile(hero).replace(/_c$/, ''), data: Buffer.from(text) };
    const files = [...wavs, events];
    const out = await compile({ id: `snd_${hero}`.slice(0, 64), files, compile: files.map((f) => f.path) });
    const want = new Set([eventsFile(hero), ...wavs.map((w) => `${w.path.replace(/\.wav$/, '.vsnd')}_c`)]);
    const at = (e: VpkEntry) => `${e.folder}/${e.name}.${e.ext}`;
    const kept = out.filter((e) => want.has(at(e)));
    if (kept.length !== want.size) throw new Error(t('resourcecompiler.exe не собрал звуки'));
    return buildVpk(kept);
  }

  /** The hero built again with `edits`: in his record's slot, a new record, or none when empty. */
  async function apply(hero: string, edits: SoundEdit[]): Promise<LibRecord | null> {
    const old = recordOf(hero);
    if (!edits.length) {
      if (old) { installer.remove(old.files, { recId: old.id }); library.removeRecord(old.id); }
      return null;
    }
    const vpk = await build(hero, edits);
    const name = t('Свои звуки: {0}', heroDisplayName(hero));
    const generated: SoundsGenerated = { sounds: hero, edits };
    if (old) {
      const files = swapPak(installer, old, vpk, false);
      return library.update(old.id, { name, files, generated, enabled: true, updatedAt: Date.now() }) as LibRecord;
    }
    const rec = library.add({ name, categoryId: 'hero-sounds', styleLabel: null, fileRef: null, preview: null, files: writePak(installer, vpk) });
    return library.update(rec.id, { generated }) as LibRecord;
  }

  return {
    /** Every hero with an events file, game id and name. */
    heroes(): { id: string; name: string }[] {
      return heroesWithSounds(pak01()).map((id) => ({ id, name: heroDisplayName(id) }));
    },

    /** A hero's events and the sounds of the user's on them. */
    hero(hero: string): HeroSounds {
      return { hero, events: heroEvents(eventsOf(hero)), edits: editsOf(hero), recId: recordOf(hero)?.id ?? null };
    },

    /** The user's sound on `event`, in place of one already there. */
    async add(hero: string, event: string, mode: SoundMode, volume: number, wav: Buffer, label: string): Promise<LibRecord | null> {
      const why = wavProblem(wav);
      if (why) throw new Error(t('Этот звук не подходит: {0}', why));
      if (!heroEvents(eventsOf(hero)).some((e) => e.name === event)) throw new Error(t('У героя нет такого звука'));
      const sound = crypto.createHash('sha1').update(wav).digest('hex');
      fs.mkdirSync(store, { recursive: true });
      fs.writeFileSync(path.join(store, `${sound}.wav`), wav);
      const edits = [...editsOf(hero).filter((e) => e.event !== event), { event, mode, volume, sound, name: label.slice(0, 120) }];
      const rec = await apply(hero, edits);
      log(`sounds: ${hero}: ${event} ${mode} with ${sound.slice(0, 8)}, ${edits.length} in all`);
      return rec;
    },

    /** The user's sound off `event`; the last one off takes the record with it. */
    async remove(hero: string, event: string): Promise<LibRecord | null> {
      return apply(hero, editsOf(hero).filter((e) => e.event !== event));
    },

    /** The hero built again from the game's current events file, after a Dota update. */
    async rebuild(hero: string): Promise<LibRecord | null> {
      return apply(hero, editsOf(hero));
    },
  };
}
