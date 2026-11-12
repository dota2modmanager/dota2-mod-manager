/* The bench's item table (tools/dota-bench/schema.mjs): the game reads items_game only from the
 * folder the search-path patch registers, so a build that changes it is tried by putting the table
 * there for the run. Checked on a game tree made here: the refusal without the patch, the app's own
 * table kept and put back, and a run that died leaving the app's table aside. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as patcher from '../src/patcher.ts';
import { openVpkIndex } from '../src/vpk.ts';
import { placeSchema } from '../tools/dota-bench/schema.mjs';

const GAMEINFO = '"GameInfo"\n{\n\tFileSystem\n\t{\n\t\tSearchPaths\n\t\t{\n\t\t\tGame\t\t\t\tdota\n\t\t\tMod\t\t\t\t\tdota\n\t\t}\n\t}\n}\n';
const BRANCH = '"GameInfo"\r\n{\r\n\tFileSystem\r\n\t{\r\n\t\tSteamAppId\t\t\t\t570\r\n\t}\r\n}\r\n';
const TABLE = '"items_game"\n{\n\t"items"\n\t{\n\t}\n}\n';

function game(t: TestContext, patched: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-bench-schema-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'game');
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dota', 'gameinfo.gi'), GAMEINFO);
  fs.writeFileSync(path.join(dir, 'dota', 'gameinfo_branchspecific.gi'), Buffer.from(BRANCH, 'latin1'));
  const backupDir = path.join(root, 'backups');
  fs.mkdirSync(backupDir);
  if (patched) patcher.apply({ gamePath: dir, folder: patcher.FOLDER, backupDir });
  const table = path.join(root, 'items_game.txt');
  fs.writeFileSync(table, TABLE);
  return { dir, table, pak: path.join(dir, patcher.FOLDER, 'pak01_dir.vpk') };
}

test('without the search-path patch the bench says what to do and writes nothing', async (t) => {
  const g = game(t, false);
  await assert.rejects(placeSchema(g.table, g.dir), /safe mode off/);
  assert.equal(fs.existsSync(g.pak), false);
});

test("the table goes where the app deploys it, and the app's own comes back after", async (t) => {
  const g = game(t, true);
  fs.mkdirSync(path.dirname(g.pak), { recursive: true });
  fs.writeFileSync(g.pak, 'the app');
  const unplace = await placeSchema(g.table, g.dir);
  assert.equal(openVpkIndex(g.pak).read('scripts/items/items_game.txt')?.toString(), TABLE);
  unplace();
  assert.equal(fs.readFileSync(g.pak, 'utf8'), 'the app');
  assert.equal(fs.existsSync(`${g.pak}.bench-kept`), false);
});

test("a run that died left the app's table aside: the next one puts it back first", async (t) => {
  const g = game(t, true);
  fs.mkdirSync(path.dirname(g.pak), { recursive: true });
  fs.writeFileSync(g.pak, 'the dead run');
  fs.writeFileSync(`${g.pak}.bench-kept`, 'the app');
  const unplace = await placeSchema(g.table, g.dir);
  unplace();
  assert.equal(fs.readFileSync(g.pak, 'utf8'), 'the app');
  await assert.rejects(placeSchema(path.join(g.dir, 'dota', 'gameinfo.gi'), g.dir), /neither a VPK nor an items_game/);
});

test('a patch an update unsigned is signed again when the owner turned safe mode off, and refused when not', async (t) => {
  const g = game(t, true);
  const sig = patcher.paths(g.dir).signatures;
  fs.mkdirSync(path.dirname(sig), { recursive: true });
  fs.writeFileSync(sig, 'DIGEST:' + 'C'.repeat(40) + '\r\n');
  await assert.rejects(placeSchema(g.table, g.dir), /safe mode off/);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-bench-backup-'));
  t.after(() => fs.rmSync(backupDir, { recursive: true, force: true }));
  const unplace = await placeSchema(g.table, g.dir, { backupDir });
  assert.equal(patcher.state(g.dir, patcher.FOLDER).signed, true);
  unplace();
});
