/* The manifest: what is installed, and the builds somebody named.
 *
 * This file exists because both bugs this module has produced were about the same thing -
 * a preset outliving the installation of its mods - and neither was caught by anything.
 * A preset used to hold install ids, so deleting a mod cut it out of every build that named
 * it, and reinstalling did not put it back because a reinstall is a new record with a new id.
 * A build survived exactly as long as its installation, which is the opposite of what people
 * keep them for.
 *
 * So the cases below are mostly about identity: what a preset remembers, what still matches
 * after the mod is gone and comes back, and what a preset is not allowed to touch.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Library, type NewRecord } from '../src/library.ts';

/** A library in a throwaway folder, cleaned up when the test ends. */
function lib(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-lib-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { store: new Library(dir), dir };
}

const modFields = (name: string, over: Partial<NewRecord> = {}): NewRecord => ({
  name,
  categoryId: 'heroes',
  styleLabel: null,
  fileRef: `${name}.vpk`,
  preview: null,
  files: [{ root: 'lang', relPath: 'pak11_dir.vpk' }],
  ...over,
});

test('a record comes back by id, by key, and in the list', (t) => {
  const { store } = lib(t);
  const rec = store.add(modFields('Crystal Maiden'));
  assert.equal(store.list().length, 1);
  assert.equal(store.find(rec.id)?.name, 'Crystal Maiden');
  assert.equal(store.findByKey('heroes', 'Crystal Maiden', null)?.id, rec.id);
  assert.equal(store.find('nobody'), null);
  assert.equal(store.findByKey('heroes', 'Nobody', null), null);
});

test('a style label is part of the key, and an absent one is null rather than undefined', (t) => {
  const { store } = lib(t);
  const plain = store.add(modFields('Juggernaut'));
  const styled = store.add(modFields('Juggernaut', { styleLabel: 'Red' }));
  assert.notEqual(plain.id, styled.id);
  assert.equal(store.findByKey('heroes', 'Juggernaut', null)?.id, plain.id);
  assert.equal(store.findByKey('heroes', 'Juggernaut', 'Red')?.id, styled.id);
  assert.equal(plain.styleLabel, null, 'stored as null, so a saved preset compares equal to it');
});

test('what is written survives a second Library over the same folder', (t) => {
  const { store, dir } = lib(t);
  store.add(modFields('Pudge'));
  store.savePreset('Build');
  const reopened = new Library(dir);
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.listPresets().length, 1);
  assert.equal(reopened.listPresets()[0].name, 'Build');
});

test('a manifest that is not JSON leaves a .bak and starts empty rather than throwing', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-lib-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, '{ this is not json');

  const store = new Library(dir);
  assert.deepEqual(store.list(), [], 'an unreadable manifest is not a crash');
  assert.equal(fs.existsSync(file + '.bak'), true, 'and the broken one is kept to look at');
  assert.equal(fs.readFileSync(file + '.bak', 'utf-8'), '{ this is not json');
});

// ---------- presets remember mods, not installations ----------

test('a preset holds what is switched on, and only that', (t) => {
  const { store } = lib(t);
  store.add(modFields('On'));
  const off = store.add(modFields('Off'));
  store.setEnabled(off.id, false);

  store.savePreset('Mine');
  const preset = store.listPresets()[0];
  assert.deepEqual(preset.mods?.map((m) => m.name), ['On']);
});

test('deleting every mod leaves the build intact, with its members marked absent', (t) => {
  /* The reported symptom was "clearing the Mods tab clears absolutely all presets". The data
   * was never touched; what the screen showed was a card that counted only the records it
   * could resolve. This is the half of that which belongs here: the preset keeps its members. */
  const { store } = lib(t);
  const a = store.add(modFields('A'));
  const b = store.add(modFields('B'));
  store.savePreset('Build');

  store.removeRecord(a.id);
  store.removeRecord(b.id);

  assert.equal(store.list().length, 0);
  const preset = store.listPresets()[0];
  assert.equal(preset.mods?.length, 2, 'the build still names both');
  const members = store.presetMembers(preset);
  assert.equal(members.length, 2);
  assert.equal(members.filter((m) => m.rec).length, 0, 'none of them installed');
  assert.deepEqual(members.map((m) => m.identity.name), ['A', 'B']);
  assert.deepEqual(store.presetModIds(preset), [], 'nothing to switch on');
});

test('a mod removed and installed again is the same member of the build', (t) => {
  /* The point of storing identities. A reinstall is a new record with a new id, and under the
   * old scheme that was a different mod as far as every preset was concerned. */
  const { store } = lib(t);
  store.add(modFields('Crystal Maiden'));
  store.savePreset('Build');
  const preset = store.listPresets()[0];

  store.removeRecord(store.list()[0].id);
  const again = store.add(modFields('Crystal Maiden'));

  const members = store.presetMembers(preset);
  assert.equal(members.length, 1);
  assert.equal(members[0].rec?.id, again.id, 'matched by identity, not by id');
  assert.deepEqual(store.presetModIds(preset), [again.id]);
});

test('a fingerprint decides when two identities disagree about their name', () => {
  // sameMod prefers the fingerprint when both sides carry one: same bytes, same mod, whatever
  // either of them is called
  const identity = { categoryId: 'heroes', name: 'Old Name', styleLabel: null, fp: 'fp-abc' };
  assert.equal(Library.sameMod(identity, { categoryId: 'heroes', name: 'New Name', fp: 'fp-abc' }), true);
  assert.equal(Library.sameMod(identity, { categoryId: 'heroes', name: 'Old Name', fp: 'fp-zzz' }), false);
});

test('add() does not keep a fingerprint, so a stored record never matches by one', (t) => {
  /* Pinning what is, not what was intended. `add()` takes a fixed set of fields and `fp` is not
   * among them, and nothing writes one afterwards - the installer computes it on demand from
   * the file instead (analyzeRecord). So Library.identityOf on anything read back from the
   * manifest always says fp: null, and sameMod's fingerprint branch never fires for it.
   *
   * Own presets do not care: they fall back to category, name and style, which is enough for a
   * mod that was reinstalled unchanged. A preset that ARRIVED as a .d2mm does care - the format
   * carries the sender's fingerprint precisely so a renamed mod still matches, and the
   * receiving side cannot use it. Worth closing, and not by editing this test. */
  const { store } = lib(t);
  const handed = { ...modFields('Named'), fp: 'fp-1' };
  const rec = store.add(handed);
  assert.equal(rec.fp, undefined, 'dropped on the way in');
  assert.equal(Library.identityOf(rec).fp, null);
  assert.equal(store.list()[0].fp, undefined);
});

test('free cosmetics are not part of a build', (t) => {
  /* A cosmetic owns no file and no pak slot: it is a pick written into the item table, and it
   * exists only while safe mode is off. Folding the two together made applying a build
   * silently strip somebody's courier - it was never in the preset, so the apply turned it
   * off. */
  const { store } = lib(t);
  store.add(modFields('A mod'));
  const courier = { ...modFields('A courier', { categoryId: 'cosmetic' }), slot: 'courier', itemId: 42 };
  store.add(courier);

  store.savePreset('Build');
  const preset = store.listPresets()[0];
  assert.deepEqual(preset.mods?.map((m) => m.name), ['A mod']);
  assert.equal(store.presetMembers(preset).length, 1);
  assert.equal(Library.inPreset({ categoryId: 'cosmetic' }), false);
  assert.equal(Library.inPreset({ categoryId: 'heroes' }), true);
  assert.equal(Library.inPreset(null), false);
});

test('a preset saved before builds stopped being lists of ids is still readable', (t) => {
  /* Reading is where the old shape is understood rather than rewritten, so a downgrade still
   * finds its presets. */
  const { store } = lib(t);
  const rec = store.add(modFields('Old Shape'));
  store.savePreset('Legacy');
  const preset = store.listPresets()[0];
  delete preset.mods;
  preset.modIds = [rec.id];

  const members = store.presetMembers(preset);
  assert.equal(members.length, 1);
  assert.equal(members[0].rec?.id, rec.id);
  assert.equal(members[0].identity.name, 'Old Shape', 'turned into an identity on the way out');
});

test('saving over a name updates that build, and a received one of the same name is left alone', (t) => {
  const { store } = lib(t);
  store.add(modFields('First'));
  store.savePreset('Same');
  store.add(modFields('Second'));
  store.savePreset('Same');
  assert.equal(store.listPresets().length, 1, 'one build, brought up to date');
  assert.equal(store.listPresets()[0].mods?.length, 2);

  store.addSharedPreset({ name: 'Same', wanted: [{ kind: 'catalog', categoryId: 'heroes', name: 'Theirs', styleLabel: null, fp: null }] });
  store.savePreset('Same');
  const own = store.listPresets().filter((p) => !p.wanted);
  const received = store.listPresets().filter((p) => p.wanted);
  assert.equal(own.length, 1);
  assert.equal(received.length, 1, "somebody else's build of the same name is a different thing");
  assert.equal(received[0].wanted?.length, 1, 'and today’s state was not folded into it');
});

test('updating a build by id needs no retyped name, and refuses to touch a received one', (t) => {
  const { store } = lib(t);
  store.add(modFields('One'));
  store.savePreset('Build');
  const preset = store.listPresets()[0];
  store.add(modFields('Two'));

  assert.equal(store.updatePresetMods(preset.id)?.mods?.length, 2);
  const shared = store.addSharedPreset({ name: 'Theirs', wanted: [] });
  assert.equal(store.updatePresetMods(shared.id), null, 'a received build is not ours to recapture');
  assert.equal(store.updatePresetMods('nobody'), null);
});

test('renaming and deleting a build', (t) => {
  const { store } = lib(t);
  store.savePreset('Before');
  const id = store.listPresets()[0].id;
  assert.equal(store.updatePreset(id, { name: 'After' })?.name, 'After');
  assert.equal(store.getPreset(id)?.name, 'After');
  store.deletePreset(id);
  assert.equal(store.listPresets().length, 0);
  assert.equal(store.getPreset(id), null);
  assert.equal(store.updatePreset('nobody', { name: 'x' }), null);
});

test('the same mod named twice in one build is one member', (t) => {
  const { store } = lib(t);
  store.add(modFields('Twice'));
  store.savePreset('Build');
  const preset = store.listPresets()[0];
  const mods = preset.mods ?? [];
  mods.push({ ...mods[0] });
  assert.equal(store.presetMembers(preset).length, 1);
});

// ---------- what the installer asks the manifest ----------

test('the paths in the language folder, and every file across all roots', (t) => {
  const { store } = lib(t);
  store.add(modFields('Lang only'));
  store.add(modFields('Mixed', {
    files: [
      { root: 'lang', relPath: 'pak12_dir.vpk' },
      { root: 'fonts', relPath: 'a.ttf' },
      { root: 'cursor', relPath: 'b.ani' },
    ],
  }));

  assert.deepEqual(store.knownLangRelPaths().sort(), ['pak11_dir.vpk', 'pak12_dir.vpk']);
  const all = store.knownFiles();
  assert.equal(all.length, 4);
  assert.deepEqual([...new Set(all.map((f) => f.root))].sort(), ['cursor', 'fonts', 'lang']);
});

test('identityOf and sameMod agree about what makes two records the same mod', (t) => {
  const { store } = lib(t);
  const rec = store.add(modFields('Named', { styleLabel: 'Blue' }));
  const identity = Library.identityOf(rec);
  assert.deepEqual(identity, { categoryId: 'heroes', name: 'Named', styleLabel: 'Blue', fp: null });

  assert.equal(Library.sameMod(identity, rec), true);
  assert.equal(Library.sameMod(identity, { ...rec, name: 'Other' }), false);
  assert.equal(Library.sameMod(identity, { ...rec, styleLabel: 'Red' }), false, 'a style is a different mod');
  assert.equal(Library.sameMod(null, rec), false);
  assert.equal(Library.sameMod(identity, null), false);

  // a record with no category is an import, and an identity says so rather than saying nothing
  assert.equal(Library.identityOf({ name: 'Imported' }).categoryId, 'imported');
});
