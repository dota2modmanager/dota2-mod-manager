// `mm-cli vpk-build`: the sandbox, the window e2e and the test fixtures build their VPKs with it
// once the TypeScript writer is gone. A VPK it writes from a folder or a list has to hold every
// file at its path, read back byte for byte, and come out the same bytes on every run. Skipped
// where mm-cli is not built, like test/rust-parity.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { CLI as cli, cliSkip } from './helpers/mm-cli.ts';

const skip = cliSkip();
const mm = (...args: string[]) => JSON.parse(execFileSync(cli, args, { encoding: 'utf8' }));

const FILES: Record<string, Buffer> = {
  'scripts/items/items_game.txt': Buffer.from('"items_game" { }\n', 'latin1'),
  'materials/models/heroes/pudge/pudge_color.vtex_c': Buffer.from([0, 1, 2, 3, 255, 254]),
  'sounds/vo/announcer.vsnd_c': Buffer.alloc(0),
  'readme': Buffer.from('a file with no extension'),
  'panorama/images/Hero Big.png': Buffer.from('upper case and a space'),
  'particles/shared.vpcf_c': Buffer.from('same bytes'),
  'particles/other/shared_copy.vpcf_c': Buffer.from('same bytes'),
};

function folder(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-vpkbuild-'));
  for (const [rel, data] of Object.entries(FILES)) {
    fs.mkdirSync(path.join(dir, 'in', path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'in', rel), data);
  }
  return dir;
}

test('a folder becomes a VPK holding every file at its path, the game\'s lower case', { skip }, () => {
  const dir = folder();
  try {
    const out = path.join(dir, 'out', 'pak01_dir.vpk');
    const made = mm('vpk-build', out, path.join(dir, 'in'));
    assert.equal(made.entries, Object.keys(FILES).length);
    const bytes = fs.readFileSync(out);
    assert.equal(made.size, bytes.length);
    const entries = new Map<string, number>(mm('vpk-entries', out));
    assert.deepEqual([...entries.keys()].sort(), Object.keys(FILES).map((p) => p.toLowerCase()).sort());
    for (const [rel, data] of Object.entries(FILES)) {
      assert.equal(entries.get(rel.toLowerCase()), zlib.crc32(data) >>> 0, rel);
      assert.deepEqual(mm('vpk-read', out, rel.toLowerCase()), { size: data.length, crc: zlib.crc32(data) >>> 0 }, rel);
    }
    // the same folder, the same bytes: a sandbox seeded twice is the same sandbox
    const again = path.join(dir, 'again.vpk');
    mm('vpk-build', again, path.join(dir, 'in'));
    assert.ok(bytes.equals(fs.readFileSync(again)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a list names each file\'s path inside the VPK, relative to the list', { skip }, () => {
  const dir = folder();
  try {
    const list = [['scripts/items/items_game.txt', 'in/scripts/items/items_game.txt'], ['Moved/Here.TXT', 'in/readme']];
    fs.writeFileSync(path.join(dir, 'list.json'), JSON.stringify(list));
    const out = path.join(dir, 'list.vpk');
    assert.equal(mm('vpk-build', out, path.join(dir, 'list.json')).entries, 2);
    assert.deepEqual(new Map(mm('vpk-entries', out)), new Map([
      ['scripts/items/items_game.txt', zlib.crc32(FILES['scripts/items/items_game.txt']) >>> 0],
      ['moved/here.txt', zlib.crc32(FILES.readme) >>> 0],
    ]));
    // a file the list names and the disk lacks is an error, not an empty entry
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify([['a.txt', 'in/none']]));
    assert.throws(() => execFileSync(cli, ['vpk-build', path.join(dir, 'bad.vpk'), path.join(dir, 'bad.json')], { stdio: 'pipe' }));
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('bad.vpk')), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
