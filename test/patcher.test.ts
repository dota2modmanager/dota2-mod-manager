// Search-path patch: the part of the app that edits files the game checks its own hashes
// against. Two releases in a row shipped a matchmaking break from here (v1.14.3, v1.15.0),
// both times because writing the patch and taking it back off were not exact inverses. These
// tests pin that down byte for byte, which is the only standard that matters: a file that is
// one tab short still loads, so nothing looks wrong until the client stops finding matches.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as patcher from '../src/patcher.ts';
const { MARKER, FOLDER } = patcher;

// Valve's real gameinfo_branchspecific.gi, byte for byte (615 bytes, CRLF). Note the lone
// tab before the FileSystem closing brace - that tab is what the round trip kept losing.
const VANILLA_BRANCH = '"GameInfo"\r\n{\r\n\t//\r\n\t// Branch-varying info, such as the game/title and app IDs, is in gameinfo_branchspecific.gi.\r\n\t// gameinfo.gi is the non-branch-varying content and can be integrated between branches.\r\n\t//\r\n\r\n\tgame \t\t"Dota 2"\r\n\ttitle \t\t"Dota 2"\r\n\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t\t\t\t570\r\n\t\tBreakpadAppId\t\t\t373300\t// Report crashes under beta DLC, not the S1 game.  Delete this when all clients are switched to S2\r\n\t\tBreakpadAppId_Tools\t\t375360  // Use a separate bucket of buckets for "-tools" crashes so that they don\'t get drowned out by game crashes. Falls back to BreakpadAppId/SteamAppId if missing\r\n\t}\r\n}\r\n';

// Valve's SearchPaths block, trimmed to the lines the patcher actually reasons about.
const VANILLA_GAMEINFO = `"GameInfo"
{
	FileSystem
	{
		SearchPaths
		{
			Game_Language		dota_*LANGUAGE*
			Game_LowViolence	dota_lv

			Game				dota
			Game				core

			Mod					dota

			Write				dota

			AddonRoot			dota_addons
		}
	}
}
`;

const patchedBlock = () => patcher.withModFolder(patcher.searchPathsBlock(VANILLA_GAMEINFO), FOLDER);

// The signature list Valve ships: one entry per checked file, closed by DIGEST. Their own
// entry for gameinfo_branchspecific.gi is already in there, which is exactly what made a
// pristine list look patched in v1.14.3.
function vanillaSignatures(text = VANILLA_BRANCH) {
  const { sha1, crc } = patcher.fileHashes(Buffer.from(text, 'latin1'));
  return [
    '...\\..\\..\\dota\\gameinfo.gi~SHA1:1111111111111111111111111111111111111111;CRC:AAAAAAAA',
    `...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:${sha1};CRC:${crc}`,
    'DIGEST:2222222222222222222222222222222222222222',
    '',
  ].join('\r\n');
}

test('patching the branch file then stripping it returns the original byte for byte', () => {
  const patched = patcher.patchedBranch(VANILLA_BRANCH, patchedBlock());

  assert.ok(patched.includes(MARKER), 'the patch should be marked as ours');
  assert.ok(patched.includes(FOLDER), 'our folder should be registered');
  assert.notEqual(patched, VANILLA_BRANCH);

  assert.equal(patcher.stripPatch(patched), VANILLA_BRANCH);
});

test('stripping is idempotent and survives a doubly applied patch', () => {
  const once = patcher.patchedBranch(VANILLA_BRANCH, patchedBlock());
  const twice = patcher.patchedBranch(once, patchedBlock());

  assert.equal(patcher.stripPatch(twice), VANILLA_BRANCH);
  assert.equal(patcher.stripPatch(patcher.stripPatch(once)), VANILLA_BRANCH);
});

test('stripping a file that was never patched leaves it alone', () => {
  assert.equal(patcher.stripPatch(VANILLA_BRANCH), VANILLA_BRANCH);
});

test('the stripped file still hashes to what Valve signed', () => {
  const want = patcher.vanillaBranchHashes(vanillaSignatures());
  const patched = patcher.patchedBranch(VANILLA_BRANCH, patchedBlock());

  assert.ok(want, 'the vanilla hashes should be readable from the list');
  assert.equal(patcher.matchesVanilla(patcher.stripPatch(patched), want), true);
  assert.equal(patcher.matchesVanilla(patched, want), false, 'a patched file must not pass');
});

test('restoreBranch reports a verified original when the hash agrees', () => {
  const want = patcher.vanillaBranchHashes(vanillaSignatures());
  const patched = patcher.patchedBranch(VANILLA_BRANCH, patchedBlock());

  const restored = patcher.restoreBranch(patched, want);
  assert.equal(restored.text, VANILLA_BRANCH);
  assert.equal(restored.verified, true);
});

test('restoreBranch repairs the one-tab-short file older versions produced', () => {
  // What the old stripPatch left behind: correct content, missing the indent ahead of the
  // FileSystem closing brace. It loads, so only the hash gives it away.
  const short = VANILLA_BRANCH.replace('\r\n\t}\r\n}\r\n', '\r\n}\r\n}\r\n');
  assert.notEqual(short, VANILLA_BRANCH);

  const want = patcher.vanillaBranchHashes(vanillaSignatures());
  assert.equal(patcher.matchesVanilla(short, want), false, 'the short file must not pass as vanilla');

  const restored = patcher.restoreBranch(short, want);
  assert.equal(restored.text, VANILLA_BRANCH);
  assert.equal(restored.verified, true);
});

test('restoreBranch admits when it cannot verify', () => {
  const stranger = VANILLA_BRANCH.replace('570', '571');
  const want = patcher.vanillaBranchHashes(vanillaSignatures());

  const restored = patcher.restoreBranch(stranger, want);
  assert.equal(restored.verified, false);
});

test("Valve's own signature entry is not mistaken for ours", () => {
  // The v1.14.3 bug: a substring check found gameinfo_branchspecific.gi in the pristine list,
  // decided the file was already patched, and froze the backup at a pre-update build.
  assert.equal(patcher.hasSignaturePatch(vanillaSignatures()), false);
});

test('our signature entry is recognised only after the DIGEST line', () => {
  const ours = patcher.signatureLine(Buffer.from('anything', 'latin1'));
  const signed = `${vanillaSignatures()}${ours}\r\n`;

  assert.equal(patcher.hasSignaturePatch(signed), true);
});

test('stripping signatures removes our line and keeps the list the game shipped', () => {
  const ours = patcher.signatureLine(Buffer.from('anything', 'latin1'));
  const signed = `${vanillaSignatures()}${ours}\r\n`;

  const stripped = patcher.stripSignatures(signed);
  assert.equal(patcher.hasSignaturePatch(stripped), false);
  assert.ok(stripped.includes('DIGEST:'), 'the DIGEST line stays');
  assert.ok(
    patcher.vanillaBranchHashes(stripped),
    "Valve's own entry for the branch file stays readable"
  );
  assert.equal(stripped.includes(ours), false);
});

test('the vanilla hashes come from before DIGEST, never from our appended line', () => {
  const other = VANILLA_BRANCH.replace('570', '999');
  const decoy = patcher.fileHashes(Buffer.from(other, 'latin1'));
  const signed =
    `${vanillaSignatures()}...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:${decoy.sha1};CRC:${decoy.crc}\r\n`;

  const want = patcher.vanillaBranchHashes(signed);
  assert.equal(patcher.matchesVanilla(VANILLA_BRANCH, want), true);
  assert.notEqual(want?.sha1, decoy.sha1);
});

test('a signature line is the path, SHA1 and little-endian CRC the game expects', () => {
  /* The expectation comes from outside this code. "123456789" is the standard check input: its
     CRC-32 is 0xCBF43926, which the list stores low byte first, as 2639F4CB. Checked against an
     installed game on 2026-09-16: its list names gameinfo.gi with CRC C42BAA0F, and that file's
     CRC-32 is 0x0FAA2BC4. The earlier version of this test matched only the shape of the line,
     and the helpers here compute hashes through the same function, so it passed with the bytes
     the wrong way round - which is a list the client rejects. */
  assert.equal(
    patcher.signatureLine(Buffer.from('123456789', 'latin1')),
    '...\\..\\..\\dota\\gameinfo_branchspecific.gi~SHA1:F7C3BC1D808E04732ADF679965CCC34CA7AE3441;CRC:2639F4CB',
  );
});

test('withModFolder puts our folder ahead of the game as both Game and Mod', () => {
  const block = patchedBlock();
  const lines = block.split('\r\n').map((l) => l.trim()).filter(Boolean);

  const game = lines.findIndex((l) => l.startsWith(`Game\t\t\t\t${FOLDER}`) || l.startsWith('Game') && l.includes(FOLDER));
  const gameDota = lines.findIndex((l) => /^Game\s+dota$/.test(l));
  const mod = lines.findIndex((l) => /^Mod\s/.test(l) && l.includes(FOLDER));
  const modDota = lines.findIndex((l) => /^Mod\s+dota$/.test(l));

  assert.ok(game !== -1 && mod !== -1, 'both entries are added');
  assert.ok(game < gameDota, 'our Game path comes first, so it becomes the MOD path');
  assert.ok(mod < modDota, 'our Mod path comes first');
});

test('withModFolder refuses a block with no Game/Mod dota lines to anchor to', () => {
  assert.throws(() => patcher.withModFolder('SearchPaths\r\n{\r\n\tGame\tcore\r\n}', FOLDER));
});

test('searchPathsBlock rejects a gameinfo with no SearchPaths', () => {
  assert.throws(() => patcher.searchPathsBlock('"GameInfo"\r\n{\r\n}\r\n'));
});

test('patchedBranch rejects a branch file with no FileSystem section', () => {
  assert.throws(() => patcher.patchedBranch('"GameInfo"\r\n{\r\n}\r\n', patchedBlock()));
});
