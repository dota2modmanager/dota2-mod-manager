/* Combined packs: many mods merged into one pak slot, and taken apart again.
 *
 * The game mounts pakNN slots up to 99, so a library past that size can only grow by putting
 * several mods into one archive. That is what a pack is, and it is the one feature that holds
 * a user's mods twice: each member's bytes are copied into the app's own store, and the
 * deployed archive is rebuilt from those copies on every change. Both halves have to stay in
 * step. A rebuild that leaves a volume of the previous build behind hands the game a file the
 * index no longer describes, and a store that outlives its pack costs hundreds of megabytes
 * nobody can see or delete.
 *
 * Four hundred lines of src/installer.ts do this and no test touched any of it. These come
 * first, before that code moves into a module of its own, so the move has something to prove
 * itself against.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as vpk from '../src/vpk.ts';
import { entry } from './helpers/vpk-entry.ts';
import { Installer } from '../src/installer.ts';
import type { LibRecord } from '../src/types.ts';

/**
 * A game folder the installer accepts, with a language folder and an installer pointed at it.
 * Deploying needs a real game path (dota\pak01_dir.vpk is what validateGamePath looks for),
 * which is the difference from the stand in coverage.test.js.
 */
function stand(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-packs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), 'the game\'s own archive');
  const installer = new Installer({
    userDataDir: path.join(dir, 'userdata'),
    getGamePath: () => game,
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });

  /** An installed standalone mod: its file in the language folder, and its library record. */
  const put = (slot: string, name: string, files: [string, string | Buffer][]): LibRecord => {
    fs.writeFileSync(path.join(lang, `${slot}_dir.vpk`), vpk.buildVpk(files.map(([p, b]) => entry(p, b))));
    return {
      id: slot, name, categoryId: 'heroes', enabled: true,
      files: [{ root: 'lang', relPath: `${slot}_dir.vpk` }],
    };
  };

  /** What the game would find in a deployed pack: inner path -> bytes, volumes and all. */
  const deployed = (dirRelPath: string) => {
    const base = dirRelPath.replace(/_dir\.vpk$/i, '');
    const merged = vpk.mergeVpkToSingle(
      path.join(lang, dirRelPath),
      (i) => path.join(lang, `${base}_${String(i).padStart(3, '0')}.vpk`),
    );
    return new Map(vpk.readVpkEntries(merged, 'mem').map((e) => [vpk.entryPath(e), e.data.toString()]));
  };

  return { installer, lang, put, deployed };
}

const HOOK = 'models/items/pudge/hook/hook.vmdl_c';
const BLADE = 'models/items/juggernaut/blade/blade.vmdl_c';

/** A pack of the given mods, stored and ready to deploy, in the order the app would add them. */
function packOf(installer: InstanceType<typeof Installer>, recs: LibRecord[], id = 'pack-1') {
  const members = recs.map((rec, i) => installer.addPackMemberFromRecord(id, rec, `m${i + 1}`));
  const files: { root: string; relPath: string }[] = [];
  return { id, name: 'Pack', kind: 'pack', files, members };
}

test('two mods go into one slot, and every file of both is in it', (t) => {
  const { installer, lang, put, deployed } = stand(t);
  const hook = put('pak10', 'Pudge Hook', [[HOOK, 'the hook model']]);
  const blade = put('pak11', 'Jugg Blade', [[BLADE, 'the blade model']]);

  const pack = packOf(installer, [hook, blade]);
  const { files, conflicts } = installer.deployPack(pack);

  assert.deepEqual(conflicts, [], 'two mods touching different heroes have nothing to fight over');
  const index = files.filter((f) => /_dir\.vpk$/i.test(f.relPath));
  assert.equal(index.length, 1, 'a pack is one archive, whatever it was built from');
  assert.ok(files.length > 1, 'and its data volumes travel with the index');
  for (const f of files) {
    assert.equal(f.root, 'lang');
    assert.ok(fs.existsSync(path.join(lang, f.relPath)), `${f.relPath} is recorded and not on disk`);
  }

  const inside = deployed(index[0].relPath);
  assert.deepEqual([...inside.keys()].sort(), [BLADE, HOOK].sort());
  assert.equal(inside.get(HOOK), 'the hook model');
  assert.equal(inside.get(BLADE), 'the blade model');
});

test('the pack takes a slot no mod is sitting in', (t) => {
  /* Deploying over an occupied slot would replace somebody else's mod with the pack, and the
     library would go on showing the mod that is no longer there. */
  /* 30 and 31 are the first two slots a pack can be given (src/slot-zones.ts): mods sitting in
     02-29 would be skipped whether or not deployPack looked at the folder, so the test would pass
     against a pack that never did. That is what it did from 2026-09-24 to 2026-09-26. */
  const { installer, put } = stand(t);
  const a = put('pak30', 'A', [[HOOK, 'a']]);
  const b = put('pak31', 'B', [[BLADE, 'b']]);

  const { files } = installer.deployPack(packOf(installer, [a, b]));
  const base = files[0].relPath.replace(/_dir\.vpk$/i, '');
  assert.ok(!['pak30', 'pak31'].includes(base), `the pack took ${base}, where a mod already is`);
  assert.match(base, /^pak\d+$/);
});

test('a rebuild stays in the slot the pack already has', (t) => {
  /* The slot is the mod's priority: the game mounts pak10 before pak20 and the first copy of a
     file wins. A pack that moved slots on every member toggle would reorder itself against the
     rest of the library behind the user's back. */
  const { installer, lang, put } = stand(t);
  const pack = packOf(installer, [
    put('pak30', 'A', [[HOOK, 'a']]),
    put('pak31', 'B', [[BLADE, 'b']]),
  ]);

  pack.files = installer.deployPack(pack).files;
  const first = installer.packBase(pack);

  /* The user then deletes the two mods the pack was built beside, which frees the slots below
     it. From here a pack that allocated a slot instead of reusing its own would drop to pak30,
     the first slot a pack can be given, and start mounting ahead of everything it used to sit
     behind. */
  for (const slot of ['pak30', 'pak31']) fs.rmSync(path.join(lang, `${slot}_dir.vpk`));
  assert.equal(fs.existsSync(path.join(lang, 'pak30_dir.vpk')), false);
  assert.notEqual(first, 'pak30', 'the pack has to be somewhere a fresh allocation would not land');

  pack.members[1].enabled = false;
  pack.files = installer.deployPack(pack).files;
  assert.equal(installer.packBase(pack), first, 'the rebuild moved the pack to another slot');
});

test('a rebuild leaves no part of the old build behind', (t) => {
  /* A build with fewer or smaller members writes fewer volumes than the one before it. Any
     volume of the previous build that stays is a file the new index does not describe, and it
     keeps its slot occupied. Switched off (.off) and master-off (.moff) copies count too. */
  const { installer, lang } = stand(t);
  for (const f of ['pak12_dir.vpk', 'pak12_000.vpk', 'pak12_001.vpk.off', 'pak12_002.vpk.moff']) {
    fs.writeFileSync(path.join(lang, f), 'an old build');
  }
  fs.writeFileSync(path.join(lang, 'pak13_dir.vpk'), 'somebody else\'s mod');

  installer.removePackDeployed({ id: 'p', files: [{ root: 'lang', relPath: 'pak12_dir.vpk' }], members: [] });

  assert.deepEqual(fs.readdirSync(lang), ['pak13_dir.vpk'], 'the neighbouring mod is not ours to touch');
});

test('a member switched off drops out of the archive and keeps its source', (t) => {
  /* Off is not gone: the user can switch it back on, and the only copy of that mod is the one
     the pack stored when it swallowed the standalone file. */
  const { installer, put, deployed } = stand(t);
  const pack = packOf(installer, [
    put('pak10', 'Hook', [[HOOK, 'the hook model']]),
    put('pak11', 'Blade', [[BLADE, 'the blade model']]),
  ]);
  pack.files = installer.deployPack(pack).files;

  pack.members[1].enabled = false;
  pack.files = installer.deployPack(pack).files;

  const inside = deployed(installer.packBase(pack) + '_dir.vpk');
  assert.deepEqual([...inside.keys()], [HOOK], 'the switched-off member is still in the archive');
  assert.ok(fs.existsSync(installer.packMemberFile(pack.id, pack.members[1].id)),
    'switching a member off threw away the only copy of that mod');
});

test('with nothing switched on the pack deploys no files', (t) => {
  const { installer, lang, put } = stand(t);
  const pack = packOf(installer, [put('pak10', 'Hook', [[HOOK, 'a']])]);
  pack.files = installer.deployPack(pack).files;
  const base = installer.packBase(pack);
  assert.ok(base, 'the pack has no slot');

  pack.members[0].enabled = false;
  const { files } = installer.deployPack(pack);

  assert.deepEqual(files, [], 'an empty pack has nothing to deploy');
  assert.equal(fs.readdirSync(lang).some((f) => f.startsWith(base)), false,
    'the archive of the previous build is still in the folder');
});

test('the first member wins a contested path, and the second one is named', (t) => {
  /* Two mods replacing the same file is ordinary. Inside one archive there is no order to
     fall back on, so the earlier member wins and the loser has to be reported: this is what
     the dialog tells the user after combining. */
  const { installer, put, deployed } = stand(t);
  const mine = put('pak10', 'Mine', [[HOOK, 'the hook you see']]);
  const theirs = put('pak11', 'Theirs', [[HOOK, 'the hook you do not']]);

  const pack = packOf(installer, [mine, theirs]);
  const { files, conflicts } = installer.deployPack(pack);

  assert.deepEqual(conflicts, [{ key: pack.members[1].id, path: HOOK }]);
  const index = files.find((f) => /_dir\.vpk$/i.test(f.relPath));
  assert.ok(index, 'the pack was deployed without an index');
  const inside = deployed(index.relPath);
  assert.equal(inside.get(HOOK), 'the hook you see', 'the member listed first supplies the file');
});

test('a member taken out of the pack becomes a mod of its own', (t) => {
  /* Extract and disband both run through this. What comes out has to be a working mod in a
     free slot, or the user loses it by taking it out of the pack. */
  const { installer, lang, put } = stand(t);
  const pack = packOf(installer, [
    put('pak10', 'Hook', [[HOOK, 'the hook model']]),
    put('pak11', 'Blade', [[BLADE, 'the blade model']]),
  ]);
  pack.files = installer.deployPack(pack).files;

  const { files } = installer.deployMemberAsMod(pack, pack.members[0]);

  assert.equal(files.length, 1, 'a member comes out as one self-contained file');
  assert.equal(files[0].root, 'lang');
  assert.notEqual(files[0].relPath.replace(/_dir\.vpk$/i, ''), installer.packBase(pack),
    'the extracted mod was written over the pack it came out of');
  const buf = fs.readFileSync(path.join(lang, files[0].relPath));
  const inside = new Map(vpk.readVpkEntries(buf, 'mem').map((e) => [vpk.entryPath(e), e.data.toString()]));
  assert.deepEqual([...inside.keys()], [HOOK]);
  assert.equal(inside.get(HOOK), 'the hook model');
});

test('deleting a pack takes its stored member sources with it', (t) => {
  /* Every member is a full copy of a mod. A pack of ten skins left behind in userData is
     hundreds of megabytes the user cannot see, name or delete. */
  const { installer, lang, put } = stand(t);
  const pack = packOf(installer, [
    put('pak10', 'Hook', [[HOOK, 'a']]),
    put('pak11', 'Blade', [[BLADE, 'b']]),
  ]);
  pack.files = installer.deployPack(pack).files;
  const base = installer.packBase(pack);
  assert.ok(base, 'the pack has no slot');
  assert.ok(fs.existsSync(installer.packFolder(pack.id)));

  installer.removePackFully(pack);

  assert.equal(fs.existsSync(installer.packFolder(pack.id)), false, 'the member store outlived the pack');
  assert.equal(fs.readdirSync(lang).some((f) => f.startsWith(base)), false,
    'the deployed archive outlived the pack');
});

test('a mod with no _dir.vpk is refused instead of half-added', (t) => {
  /* Fonts and cursors are mods the library holds but a pack cannot swallow: there is no
     archive to merge. Failing here, before anything is written, is what keeps the pack's
     member list and its store in step. */
  const { installer } = stand(t);
  const fontMod = { id: 'f', name: 'A font', categoryId: 'fonts', files: [{ root: 'fonts', relPath: 'x.vfont_c' }] };

  assert.throws(() => installer.addPackMemberFromRecord('pack-1', fontMod, 'm1'), /_dir\.vpk/);
  assert.equal(fs.existsSync(installer.packMemberFile('pack-1', 'm1')), false);
});

test('the member descriptor fingerprints the bytes that were actually stored', (t) => {
  /* The fingerprint is how the library recognises a mod it already has. Taken from anything
     other than the stored copy it would name a file that is no longer what it describes. */
  const { installer, put } = stand(t);
  const rec = put('pak10', 'Pudge Hook', [[HOOK, 'the hook model']]);

  const [member] = packOf(installer, [rec]).members;

  assert.equal(member.name, 'Pudge Hook');
  assert.equal(member.enabled, true);
  assert.equal(member.fp, vpk.fingerprintVpk(fs.readFileSync(installer.packMemberFile('pack-1', member.id))));
});
