/* The window's half of a sound of the user's own (src/ability-sounds-service.ts, issue #423): one
 * record per hero in My mods, a second sound added into it and the pak built again in its place,
 * the last one taken off with the record, and a file the compiler would not take refused before
 * anything is staged. On a game folder made here; the compiler is a fake that answers with the
 * files Valve's makes of the sources (a .wav into a .vsnd_c), so what is checked is what the app
 * hands it and keeps of it. The real compile was run on Valve's resourcecompiler: the events file
 * came back pointing at the sound, with the length the compiler measured. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryAt, listVpkPathsFile } from '../src/vpk.ts';
import { compiledOf, type CompileJob } from '../src/resource-compiler.ts';
import { createAbilitySounds } from '../src/ability-sounds-service.ts';
import { encodeWav } from '../renderer/catalog/sounds/wav.ts';
import { heroesWithSounds, soundHero, wavProblem } from '../src/ability-sounds.ts';
import { encodeKv3, resource, type V } from './helpers/kv3-build.ts';

const event = (file: string): V => ({ obj: [['type', { str: 'dota_src1_3d' }], ['volume', { dbl: 1 }], ['vsnd_files', { arr: [{ str: file }] }]] });
const EVENTS = resource([['RED2', Buffer.from('editor')], ['DATA', encodeKv3({ obj: [
  ['Hero_Lion.Voodoo', event('sounds/weapons/hero/lion/voodoo.vsnd')],
  ['Hero_Lion.FingerOfDeath', event('sounds/weapons/hero/lion/finger.vsnd')],
] })]]);

function world(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-ability-sounds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([entryAt('soundevents/game_sounds_heroes/game_sounds_lion.vsndevts_c', EVENTS)]));
  const userdata = path.join(dir, 'userdata');
  const installer = new Installer({ userDataDir: userdata, getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(userdata);
  const jobs: CompileJob[] = [];
  const compile = async (job: CompileJob) => {
    jobs.push(job);
    return job.compile.map((rel) => entryAt(compiledOf(rel), Buffer.from(`compiled ${rel}`)));
  };
  const service = createAbilitySounds({ gamePath: () => game, userDataDir: userdata, installer, library, compile });
  const paths = (rec: { files: { relPath: string }[] }) => listVpkPathsFile(path.join(lang, rec.files[0].relPath)).sort();
  return { lang, library, service, jobs, paths };
}

test('an events file names its hero without underscores, and an event’s own file is not a hero', () => {
  const ix = { paths: () => ['crystalmaiden', 'lion', 'muerta_release_event'].map((h) => `soundevents/game_sounds_heroes/game_sounds_${h}.vsndevts_c`) };
  assert.deepEqual(heroesWithSounds(ix), ['crystalmaiden', 'lion']);
  assert.equal(soundHero('crystalmaiden'), 'crystal_maiden', 'her portrait and name are under crystal_maiden');
  assert.equal(soundHero('lion'), 'lion');
});

const tone = (hz: number) => Buffer.from(encodeWav(Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 44100 * 2 * Math.PI * hz))));

test('the window is offered the heroes and their events', (t) => {
  const { service } = world(t);
  assert.deepEqual(service.heroes(), [{ id: 'lion', hero: 'lion', name: 'Lion' }]);
  const h = service.hero('lion');
  assert.deepEqual(h.events.map((e) => e.name), ['Hero_Lion.Voodoo', 'Hero_Lion.FingerOfDeath']);
  assert.deepEqual(h.edits, []);
  assert.equal(h.recId, null);
});

test('a hero is one record; a second sound goes into it and the pak is built again in its place', async (t) => {
  const w = world(t);
  const first = (await w.service.add('lion', 'Hero_Lion.FingerOfDeath', 'replace', 0.8, tone(440), 'boom.mp3'))!;
  assert.equal(first.categoryId, 'hero-sounds');
  assert.match(first.name, /Lion$/);
  const job = w.jobs[0];
  assert.equal(job.id, 'snd_lion');
  const events = job.files.find((f) => f.path.endsWith('.vsndevts'))!;
  assert.match(events.data.toString(), /"Hero_Lion\.FingerOfDeath" = \{[^}]*sounds\/mods\/d2mm\/lion\//, 'the events go to the compiler as text');
  assert.equal(job.files.filter((f) => f.path.endsWith('.wav')).length, 1);
  assert.equal(w.paths(first).length, 2, 'the events file and the sound');

  const second = (await w.service.add('lion', 'Hero_Lion.Voodoo', 'layer', 1, tone(880), 'ring.wav'))!;
  assert.equal(second.id, first.id);
  assert.equal(w.library.list().length, 1);
  assert.equal(w.paths(second).length, 3, 'both sounds and the events file');
  assert.equal(fs.readdirSync(w.lang).filter((f) => /_dir\.vpk$/.test(f)).length, 1, 'the old pak went');
  assert.deepEqual(w.service.hero('lion').edits.map((e) => [e.event, e.mode, e.name]),
    [['Hero_Lion.FingerOfDeath', 'replace', 'boom.mp3'], ['Hero_Lion.Voodoo', 'layer', 'ring.wav']]);
});

test('taking off a sound builds the hero without it, and the last one off removes the record', async (t) => {
  const w = world(t);
  await w.service.add('lion', 'Hero_Lion.FingerOfDeath', 'replace', 1, tone(440), 'a.wav');
  await w.service.add('lion', 'Hero_Lion.Voodoo', 'replace', 1, tone(880), 'b.wav');
  const left = (await w.service.remove('lion', 'Hero_Lion.Voodoo'))!;
  assert.deepEqual((left.generated as { edits: { event: string }[] }).edits.map((e) => e.event), ['Hero_Lion.FingerOfDeath']);
  assert.equal(await w.service.remove('lion', 'Hero_Lion.FingerOfDeath'), null);
  assert.equal(w.library.list().length, 0);
  assert.equal(fs.readdirSync(w.lang).filter((f) => /_dir\.vpk$/.test(f)).length, 0);
});

test('a file the compiler would not take, or an event the hero has not got, is refused before anything is compiled', async (t) => {
  const w = world(t);
  await assert.rejects(w.service.add('lion', 'Hero_Lion.FingerOfDeath', 'replace', 1, Buffer.from('ID3 not a wav'), 'x.mp3'), /WAV/);
  await assert.rejects(w.service.add('lion', 'Hero_Lion.Gone', 'replace', 1, tone(440), 'x.wav'), /такого звука|no such sound/i);
  assert.throws(() => w.service.hero('axe'), /файла звуков|sounds file/i);
  assert.equal(w.jobs.length, 0);
});

test("the window's WAV is one the compiler takes, brought down to Valve's peak", () => {
  const loud = encodeWav(Float32Array.from({ length: 1000 }, (_, i) => (i % 2 ? 2 : -2)));
  assert.equal(wavProblem(Buffer.from(loud)), null);
  const peak = Math.max(...Array.from({ length: 900 }, (_, i) => Math.abs(new DataView(loud.buffer).getInt16(44 + i * 2, true))));
  assert.ok(peak <= Math.round(0.89 * 32767) && peak > 28000, `peak ${peak}`);
  assert.ok(Math.abs(new DataView(loud.buffer).getInt16(44 + 999 * 2, true)) < 100, 'faded out at the end');
});
