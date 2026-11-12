/* A hero mod with its item pictures taken out (src/installer-repack.ts dropItemIcons).
 *
 * The promise: the shop's pictures go and everything else of the mod stays, switched off or on
 * as it was; a mod with no item pictures is not written at all. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildVpk, entryAt, listVpkPathsFile } from '../src/vpk.ts';
import { dropItemIcons } from '../src/item-icons-drop.ts';
import type { Installer } from '../src/installer.ts';

const inst = (lang: string) => ({ langFolder: () => lang }) as unknown as Installer;

test('the item pictures go, the hero stays, and a switched-off pack stays off', () => {
  const lang = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  try {
    fs.writeFileSync(path.join(lang, 'pak40_dir.vpk.off'), buildVpk([
      entryAt('models/heroes/shredder/shredder.vmdl_c', Buffer.from('body')),
      entryAt('panorama/images/items/blink_png.vtex_c', Buffer.from('blink')),
      entryAt('panorama/images/items/black_king_bar_png.vtex_c', Buffer.from('bkb')),
      entryAt('panorama/images/spellicons/shredder_whirling_death_png.vtex_c', Buffer.from('spell')),
    ]));
    const files = [{ root: 'lang', relPath: 'pak40_dir.vpk' }];
    assert.equal(dropItemIcons(inst(lang), files as never), 2);
    assert.deepEqual(listVpkPathsFile(path.join(lang, 'pak40_dir.vpk.off')).sort(), [
      'models/heroes/shredder/shredder.vmdl_c',
      'panorama/images/spellicons/shredder_whirling_death_png.vtex_c',
    ]);
    assert.equal(fs.existsSync(path.join(lang, 'pak40_dir.vpk')), false, 'not switched on by the rewrite');
    assert.equal(dropItemIcons(inst(lang), files as never), 0, 'nothing left to take');
  } finally {
    fs.rmSync(lang, { recursive: true, force: true });
  }
});

test('a mod with no item pictures is left untouched', () => {
  const lang = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  try {
    const file = path.join(lang, 'pak41_dir.vpk');
    fs.writeFileSync(file, buildVpk([entryAt('models/heroes/axe/axe.vmdl_c', Buffer.from('axe'))]));
    const before = fs.statSync(file).mtimeMs;
    assert.equal(dropItemIcons(inst(lang), [{ root: 'lang', relPath: 'pak41_dir.vpk' }] as never), 0);
    assert.equal(fs.statSync(file).mtimeMs, before);
  } finally {
    fs.rmSync(lang, { recursive: true, force: true });
  }
});
