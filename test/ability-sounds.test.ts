/* A sound of the user's own on a hero's event (src/ability-sounds.ts, issue #423): which events the
 * window offers, what replacing and layering write into the events file the compiler reads, and
 * which WAVs it takes. The events here are the shape Valve's are: a type, files, a volume, a layer. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { editedEvents, eventsFile, heroEvents, heroesWithSounds, soundPath, wavProblem, type SoundEdit } from '../src/ability-sounds.ts';
import type { Kv3Block, Kv3Node } from '../src/kv3.ts';

const s = (value: string): Kv3Node => ({ kind: 'string', value });
const obj = (o: Record<string, Kv3Node>): Kv3Node => ({ kind: 'object', members: new Map(Object.entries(o)) });
const files = (...f: string[]): Kv3Node => ({ kind: 'array', items: f.map(s) });

const KV = {
  root: obj({
    'Hero_Lion.Voodoo': obj({ type: s('dota_src1_3d'), vsnd_files: files('sounds/weapons/hero/lion/voodoo.vsnd'), soundevent_layer2: s('Hero_Lion.Voodoo.Immortal'), soundevent_layer2_on: s('1') }),
    'Hero_Lion.FingerOfDeath': obj({ type: s('dota_src1_3d'), vsnd_files: files('sounds/weapons/hero/lion/finger.vsnd') }),
    'Hero_Lion.Death': obj({ type: s('dota_null_start') }),
  }),
} as unknown as Kv3Block;

const edit = (event: string, mode: SoundEdit['mode']): SoundEdit => ({ event, mode, volume: 0.9, sound: 'a1b2c3d4e5f6a7b8c9d0', name: 'boom.mp3' });

test('the window is offered the events that play a sound, and the heroes that have a file of them', () => {
  assert.deepEqual(heroEvents(KV).map((e) => e.name), ['Hero_Lion.Voodoo', 'Hero_Lion.FingerOfDeath'], 'an event that plays nothing has no sound to change');
  const ix = { paths: () => [eventsFile('lion'), eventsFile('axe'), 'soundevents/voscripts/game_sounds_vo_lion.vsndevts_c', 'scripts/items/items_game.txt'] };
  assert.deepEqual(heroesWithSounds(ix), ['axe', 'lion']);
});

test('replacing makes the event play only the sound of the user, without the layers it had', () => {
  const { text, gone } = editedEvents(KV, 'lion', [edit('Hero_Lion.Voodoo', 'replace')]);
  assert.deepEqual(gone, []);
  assert.match(text, /^<!-- kv3 encoding:text/);
  const voodoo = /"Hero_Lion\.Voodoo" = \{([^}]*)\}/.exec(text)![1];
  assert.match(voodoo, new RegExp(`"${soundPath('lion', 'a1b2c3d4e5f6a7b8c9d0')}"`));
  assert.doesNotMatch(voodoo, /voodoo\.vsnd|soundevent_layer/);
  assert.match(voodoo, /type = "dota_src1_3d"/, "the template's type stays");
  assert.match(voodoo, /volume = 0\.90/);
});

test("layering keeps Valve's sound and plays the user's on top, in the first free layer", () => {
  const { text } = editedEvents(KV, 'lion', [edit('Hero_Lion.FingerOfDeath', 'layer'), edit('Hero_Lion.Voodoo', 'layer')]);
  assert.match(text, /"Hero_Lion\.FingerOfDeath\.d2mm_a1b2c3d4" = \{[^}]*mods\/d2mm\/lion\//);
  const finger = /"Hero_Lion\.FingerOfDeath" = \{([^}]*)\}/.exec(text)![1];
  assert.match(finger, /finger\.vsnd/);
  assert.match(finger, /soundevent_layer2 = "Hero_Lion\.FingerOfDeath\.d2mm_a1b2c3d4"/);
  const voodoo = /"Hero_Lion\.Voodoo" = \{([^}]*)\}/.exec(text)![1];
  assert.match(voodoo, /soundevent_layer2 = "Hero_Lion\.Voodoo\.Immortal"/, "Valve's own layer is left where it was");
  assert.match(voodoo, /soundevent_layer3 = "Hero_Lion\.Voodoo\.d2mm_a1b2c3d4"/);
});

test('an event the game no longer has, or one that plays nothing, is passed over and named', () => {
  const { gone } = editedEvents(KV, 'lion', [edit('Hero_Lion.Gone', 'replace'), edit('Hero_Lion.Death', 'layer')]);
  assert.deepEqual(gone, ['Hero_Lion.Gone', 'Hero_Lion.Death']);
});

function wav({ format = 1, rate = 44100, bits = 16 } = {}): Buffer {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(format, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(bits, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(0, 40);
  return b;
}

test('the compiler is handed 16-bit PCM WAV at a rate the game plays, and nothing else', () => {
  assert.equal(wavProblem(wav()), null);
  assert.equal(wavProblem(wav({ rate: 48000 })), null);
  assert.match(wavProblem(wav({ bits: 24 }))!, /16-bit/);
  assert.match(wavProblem(wav({ rate: 8000 }))!, /44100/);
  assert.match(wavProblem(wav({ format: 3 }))!, /PCM/);
  assert.match(wavProblem(Buffer.from('ID3 an mp3'))!, /not a WAV/);
});
