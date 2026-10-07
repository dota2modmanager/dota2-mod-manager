/* The search-path patch against a real directory, rather than against strings.
 *
 * test/patcher.test.ts pins the text transforms byte for byte and never calls apply(), state()
 * or revert(). That gap had a cost: apply() demanded `dota.signatures` before it would do
 * anything, and Valve's Linux build ships `bin/linuxsteamrt64/` without one. A Linux user
 * pressing "safe mode off" got "dota.signatures not found" and no way forward - reported on
 * 2026-09-11 with a photograph of that folder, holding the client, forty shared libraries and
 * no list.
 *
 * So: both shapes of installation, built in a temporary directory, patched and reverted.
 * `paths()` decides where the list belongs, so this reads the same on either platform.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as patcher from '../src/patcher.ts';
const { MARKER, FOLDER } = patcher;

const GAMEINFO = `"GameInfo"
{
	FileSystem
	{
		SearchPaths
		{
			Game_AudioLanguage	dota_*LANGUAGE*
			Game				dota
			Game				core
			Mod					dota
			Write				dota
		}
	}
}
`;

const BRANCH = '"GameInfo"\r\n{\r\n\tgame \t\t"Dota 2"\r\n\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t\t\t\t570\r\n\t}\r\n}\r\n';

/* A list with no entry for the branch file: `vanillaBranchHashes` finds nothing to compare
   against, which is the same answer it gives for a build whose list does not mention it. The
   point here is whether our own line goes in and comes out, not hash arithmetic. */
const SIGNATURES = 'somefile.dll~SHA1:' + 'A'.repeat(40) + ';CRC:' + 'B'.repeat(8) + '\r\nDIGEST:' + 'C'.repeat(40) + '\r\n';

/**
 * A throwaway game tree.
 * @param withList  give it a dota.signatures, the way Windows ships one
 */
function tree(t: TestContext, withList: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-patch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, 'game');
  const backupDir = path.join(root, 'backups');
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'gameinfo.gi'), GAMEINFO);
  fs.writeFileSync(path.join(game, 'dota', 'gameinfo_branchspecific.gi'), Buffer.from(BRANCH, 'latin1'));
  const sig = patcher.paths(game).signatures;
  if (withList) {
    fs.mkdirSync(path.dirname(sig), { recursive: true });
    fs.writeFileSync(sig, Buffer.from(SIGNATURES, 'latin1'));
  }
  return { game, backupDir, sig };
}

const branchOf = (game: string) => fs.readFileSync(patcher.paths(game).branch, 'latin1');

test('an install that ships no signature list is still patched', (t) => {
  const { game, backupDir, sig } = tree(t, false);
  assert.equal(fs.existsSync(sig), false, 'the tree really has no list');

  const st = patcher.apply({ gamePath: game, folder: FOLDER, backupDir });

  assert.ok(branchOf(game).includes(MARKER), 'the branch file carries the patch');
  assert.ok(branchOf(game).includes(FOLDER), 'and names the mod folder');
  assert.equal(st.patched, true);
  assert.equal(fs.existsSync(path.join(game, FOLDER)), true, 'the folder the patch registers exists');
  assert.equal(fs.existsSync(sig), false, 'and no list was invented for it');
});

test('an install with no list reports that, rather than reporting an unsigned patch', (t) => {
  // Both consumers of this - the status bar dot and schemaService.heal - treat "patched but
  // not signed" as something wrong. On Linux that would be permanent, and re-patching on every
  // check would be the app fighting itself.
  const { game, backupDir } = tree(t, false);
  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });

  const st = patcher.state(game, FOLDER);
  assert.equal(st.signable, false, 'there is nothing here to sign into');
  assert.equal(st.signed, false, 'so nothing was signed');
  assert.equal(st.patched, true, 'and the patch is on, which is the finished state here');
});

test('an install with a list gets the patch signed into it', (t) => {
  const { game, backupDir, sig } = tree(t, true);

  const st = patcher.apply({ gamePath: game, folder: FOLDER, backupDir });

  assert.equal(st.signable, true);
  assert.equal(st.signed, true, 'the patched branch file is accounted for in the list');
  const text = fs.readFileSync(sig, 'latin1');
  assert.ok(text.includes('gameinfo_branchspecific.gi~SHA1:'), 'our line is in the list');
  assert.ok(text.includes('DIGEST:'), "and Valve's own lines are still there");
});

test('a patch from before a gameinfo.gi change reads as outdated, and applying again brings it up to date', (t) => {
  const { game, backupDir } = tree(t, true);
  const gameinfo = patcher.paths(game).gameinfo;
  // build 6944: the language key was still Game_Language
  fs.writeFileSync(gameinfo, GAMEINFO.replace('Game_AudioLanguage\t', 'Game_Language\t\t'));
  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
  assert.equal(patcher.state(game, FOLDER).outdated, false, 'current against the file it was built from');

  // build 6946 rewrites gameinfo.gi and leaves the branch file and our signed line alone
  fs.writeFileSync(gameinfo, GAMEINFO);
  const st = patcher.state(game, FOLDER);
  assert.equal(st.patched, true);
  assert.equal(st.signed, true, 'nothing about the signature gives it away');
  assert.equal(st.outdated, true);

  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
  assert.equal(patcher.state(game, FOLDER).outdated, false);
  assert.match(branchOf(game), /Game_AudioLanguage/);
  assert.doesNotMatch(branchOf(game), /Game_Language/);
  assert.equal(patcher.state(game, FOLDER).signed, true, 'and the rebuilt file is signed in turn');
});

test('an unreadable gameinfo.gi does not make a patch look outdated', (t) => {
  const { game, backupDir } = tree(t, true);
  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
  fs.writeFileSync(patcher.paths(game).gameinfo, '"GameInfo"\n{\n}\n');
  assert.equal(patcher.state(game, FOLDER).outdated, false);
});

test('reverting puts both files back exactly as they were', (t) => {
  for (const withList of [true, false]) {
    const { game, backupDir, sig } = tree(t, withList);
    const branchBefore = fs.readFileSync(patcher.paths(game).branch);
    const sigBefore = withList ? fs.readFileSync(sig) : null;

    patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
    const st = patcher.revert({ gamePath: game, folder: FOLDER, backupDir });

    assert.deepEqual(fs.readFileSync(patcher.paths(game).branch), branchBefore,
      `the branch file came back byte for byte (list: ${withList})`);
    if (withList) assert.deepEqual(fs.readFileSync(sig), sigBefore, 'and so did the list');
    assert.equal(st.patched, false);
  }
});

test('applying twice does not stack, with a list or without one', (t) => {
  for (const withList of [true, false]) {
    const { game, backupDir } = tree(t, withList);
    patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
    const once = branchOf(game);
    patcher.apply({ gamePath: game, folder: FOLDER, backupDir });

    assert.equal(branchOf(game), once, `the second patch changed nothing (list: ${withList})`);
    // twice by design: the folder is registered on a Game line and on a Mod line, and each
    // carries the marker. The count is pinned so a third registration is a deliberate change.
    const marks = once.split(MARKER).length - 1;
    assert.equal(marks, 2, `the marker appears twice, not ${marks} times`);
  }
});

test('a tree with no gameinfo at all is still refused, and says which file', (t) => {
  const { game, backupDir } = tree(t, true);
  fs.rmSync(path.join(game, 'dota', 'gameinfo.gi'));

  assert.throws(
    () => patcher.apply({ gamePath: game, folder: FOLDER, backupDir }),
    /gameinfo\.gi/,
    'the file it cannot do without is named in the error',
  );
});

/*
 * The signature list belongs to the build of Dota that is installed right now.
 *
 * Valve ships a new dota.signatures with every build: the hash of every DLL it checks, and a
 * DIGEST over the lot. This app appends one line to it. Rebuilding that file from a copy taken
 * weeks ago puts an old build's hashes back, the client compares its real DLLs against them and
 * refuses matchmaking - while the app reports patched, signed and vanilla, because nothing here
 * ever looked at the rest of the list.
 *
 * Measured on a real installation on 2026-09-11: the backup was from 29 July and named
 * dota2.exe~SHA1:0A281119…, the game's own list said 72ED2906…, and the next apply() would have
 * written the July one back over it.
 */
const listFor = (build: string, branchBuf: Buffer) => {
  const h = patcher.fileHashes(branchBuf);
  const dll = (name: string, seed: string) => `...\\${name}~SHA1:${seed.repeat(40).slice(0, 40)};CRC:${seed.repeat(8).slice(0, 8)}`;
  return [
    `...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:${h.sha1};CRC:${h.crc}`,
    dll('client.dll', build), dll('dota2.exe', build),
    `DIGEST:${build.repeat(64).slice(0, 64)}`,
  ].join('\r\n') + '\r\n';
};
const exeHash = (text: string) => (text.match(/dota2\.exe~SHA1:(\w{40})/) || [])[1];

test('the patch is signed into the list the installed build shipped, not an older one', (t) => {
  const { game, backupDir, sig } = tree(t, true);
  const vanilla = fs.readFileSync(patcher.paths(game).branch);
  fs.writeFileSync(sig, Buffer.from(listFor('A', vanilla), 'latin1'));

  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
  assert.equal(exeHash(fs.readFileSync(sig, 'latin1')), 'A'.repeat(40), 'build A to start with');

  /* Dota updates to build B while our line is still in the file. The app's copy of the list
     stays at A, because a file that still carries our line is not taken as new ground truth. */
  const patchedBranch = fs.readFileSync(patcher.paths(game).branch);
  fs.writeFileSync(sig, Buffer.from(
    listFor('B', vanilla).replace(/\s+$/, '') + '\r\n' + patcher.signatureLine(patchedBranch) + '\r\n', 'latin1',
  ));

  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });

  const after = fs.readFileSync(sig, 'latin1');
  assert.equal(exeHash(after), 'B'.repeat(40),
    'the list still belongs to the build that is installed, not to the one that was');
  assert.ok(after.includes(patcher.signatureLine(fs.readFileSync(patcher.paths(game).branch))),
    'and our own line is in it exactly once');
  assert.equal(after.split('gameinfo_branchspecific').length - 1, 2, 'Valve\'s entry and ours, no more');
});

test('signing twice does not pile our line up in the list', (t) => {
  const { game, backupDir, sig } = tree(t, true);
  const vanilla = fs.readFileSync(patcher.paths(game).branch);
  fs.writeFileSync(sig, Buffer.from(listFor('A', vanilla), 'latin1'));

  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });

  const after = fs.readFileSync(sig, 'latin1');
  assert.equal(after.split('gameinfo_branchspecific').length - 1, 2, 'one Valve entry, one of ours');
  assert.equal(exeHash(after), 'A'.repeat(40), "and Valve's own lines are untouched");
});

test('a backup from an older build is replaced, or reverting would put the old build back', (t) => {
  /* backupOnce keeps the copy it took before patching, and revert() restores from that copy. A
     copy that no longer matches the list the game ships is worse than none: it loads, so nothing
     looks wrong until the client stops matchmaking. The check that replaces such a copy had no
     test - a mutation run on 2026-09-16 took it out and nothing noticed. */
  const { game, backupDir, sig } = tree(t, true);
  const { sha1, crc } = patcher.fileHashes(Buffer.from(BRANCH, 'latin1'));
  const listed = `...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:${sha1};CRC:${crc}\r\nDIGEST:${'C'.repeat(40)}\r\n`;
  fs.writeFileSync(sig, Buffer.from(listed, 'latin1'));

  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
  // the copy taken before an update: the same file, with a line Valve has since changed
  fs.writeFileSync(path.join(backupDir, 'gameinfo_branchspecific.gi.orig'), Buffer.from(BRANCH.replace('570', '569'), 'latin1'));

  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
  assert.ok(branchOf(game).includes('570'), 'the patch was rebuilt on top of the old build');
  patcher.revert({ gamePath: game, folder: FOLDER, backupDir });

  assert.equal(branchOf(game), BRANCH, 'reverting put the old build back');
  assert.equal(patcher.state(game, FOLDER).vanillaOk, true);
});

test('a file Steam holds open is still written, and the temporary copy does not stay behind', (t) => {
  /* Windows refuses to rename over a file another process has open, and Steam holds gameinfo
     while it runs. The write falls back to replacing the file in place; until this test nothing
     ran that path, so a mistake in it would have surfaced as a game folder with a stray .mmtmp
     beside a gameinfo that never changed. */
  const { game, backupDir } = tree(t, true);
  const busy = (code: string) => Object.assign(new Error(code), { code });
  const rename = t.mock.method(fs, 'renameSync', () => { throw busy('EPERM'); });

  patcher.apply({ gamePath: game, folder: FOLDER, backupDir });
  assert.ok(rename.mock.callCount() >= 2, 'the rename was tried, and tried again after clearing the way');
  assert.ok(branchOf(game).includes(MARKER), 'the file was replaced in place');
  assert.deepEqual(fs.readdirSync(path.join(game, 'dota')).filter((f) => f.endsWith('.mmtmp')), []);
  rename.mock.restore();
  assert.equal(patcher.state(game, FOLDER).signed, true, 'and the list written the same way names it');
});

test('a write that fails for any other reason stops the patch and leaves no temporary copy', (t) => {
  const { game, backupDir } = tree(t, true);
  const before = branchOf(game);
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });

  assert.throws(() => patcher.apply({ gamePath: game, folder: FOLDER, backupDir }), /disk full/);
  assert.equal(branchOf(game), before, 'the game file is as it was');
  assert.deepEqual(fs.readdirSync(path.join(game, 'dota')).filter((f) => f.endsWith('.mmtmp')), []);
});
