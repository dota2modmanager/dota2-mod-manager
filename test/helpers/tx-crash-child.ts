/* One change to a game folder, run in a process of its own so that it can be killed halfway.
 *
 * Every call that changes the disk - a rename, a write, a delete, a folder made, a journal line
 * flushed - is a point, once before the call and once after it. The points are counted here, at
 * the fs module, not reported by the code under test: a write that bypassed the transaction is a
 * point like any other, so a library record saved outside the change gets killed between itself
 * and the commit and shows up as a mismatch. test/file-tx-crash.test.ts runs this once per point
 * and has it kill itself there with SIGKILL: no finally block, no rollback, nothing after that
 * point runs, which is what a process ended from Task Manager or by a power cut looks like from
 * the disk. The test then recovers the folder the way the next start would and compares it with
 * the folder before the change and after it.
 *
 *   node test/helpers/tx-crash-child.ts seed <root>
 *   node test/helpers/tx-crash-child.ts <scenario> <root> <crashAt>        crashAt 0: never
 *   node test/helpers/tx-crash-child.ts recover <root> <crashAt>
 *
 * A run that is not killed prints one JSON line: how many points it passed and at which one the
 * change committed: the point right after the journal's commit line was written. A killed process
 * loses nothing it already handed the system, so from there the change is finished on the next
 * start; the flush after it is for a power cut, which this cannot stage. Ids and clocks are fixed, so two runs of a scenario write the same bytes and
 * "after" can be compared byte for byte.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';

import { FileTx } from '../../src/file-tx.ts';
import { recoverJournals } from '../../src/file-tx-journal.ts';
import { Installer } from '../../src/installer.ts';
import { Library } from '../../src/library.ts';
import type { LibRecord } from '../../src/types.ts';

let ids = 0;
crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
Date.now = () => 1790000000000;

const [mode, root, crashArg] = process.argv.slice(2);
const crashAt = Number(crashArg || 0);

const game = path.join(root, 'game');
const lang = path.join(game, 'dota_russian');
const userData = path.join(root, 'userdata');
const raw = path.join(root, 'raw');

let points = 0;
let commitAt = 0;
const passing = () => {
  points++;
  if (points === crashAt) process.kill(process.pid, 'SIGKILL');
};

/** Every fs call that changes the disk becomes two points, one on each side of it. */
function countPoints(): void {
  const mutating = ['renameSync', 'writeFileSync', 'appendFileSync', 'copyFileSync', 'cpSync', 'rmSync',
    'rmdirSync', 'unlinkSync', 'mkdirSync', 'writeSync', 'fsyncSync', 'truncateSync', 'utimesSync'] as const;
  const live = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const name of mutating) {
    const real = live[name];
    live[name] = (...args: unknown[]) => {
      passing();
      const out = real.apply(fs, args);
      if (name === 'writeSync' && !commitAt && typeof args[1] === 'string' && args[1].includes('"commit":true')) commitAt = points + 1;
      passing();
      return out;
    };
  }
}

const put = (p: string, body: string) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

function open() {
  const installer = new Installer({
    userDataDir: userData,
    getGamePath: () => game,
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });
  const library = new Library(userData);
  const named = (name: string) => library.list().find((r) => r.name === name) as LibRecord;
  return { installer, library, named };
}

/** The folder every scenario starts from: three mods in the library, one off, plus a raw tree. */
function seed(): void {
  put(path.join(game, 'dota', 'pak01_dir.vpk'), "the game's own archive");
  const { library } = open();
  const placed = (base: string, categoryId: string, name: string, { suffix = '', volumes = 0 } = {}) => {
    put(path.join(lang, `${base}_dir.vpk${suffix}`), `${name} index`);
    const files = [{ root: 'lang', relPath: `${base}_dir.vpk` }];
    for (let v = 0; v < volumes; v++) {
      const part = `${base}_${String(v).padStart(3, '0')}.vpk`;
      put(path.join(lang, part + suffix), `${name} volume ${v}`);
      files.push({ root: 'lang', relPath: part });
    }
    const rec = library.add({ name, categoryId, fileRef: name, files });
    if (suffix) library.setEnabled(rec.id, false);
  };
  // a hero mod sitting in the front part, where the layout scenario has to move it from
  placed('pak02', 'heroes', 'alpha', { volumes: 1 });
  placed('pak10', 'heroes', 'beta', { suffix: '.off' });
  placed('pak11', 'river', 'gamma');
  // a cached two-volume archive, so the install scenario needs no network
  const zip = new AdmZip();
  zip.addFile('pak01_dir.vpk', Buffer.from('delta index'));
  zip.addFile('pak01_000.vpk', Buffer.from('delta volume 0'));
  fs.mkdirSync(path.join(userData, 'downloads', 'heroes'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'downloads', 'heroes', 'delta.zip'), zip.toBuffer());

  put(path.join(raw, 'overwrite.vpk'), 'original');
  put(path.join(raw, 'move-me.vpk'), 'moving');
  put(path.join(raw, 'remove-me.vpk'), 'removing');
  put(path.join(raw, 'tool', 'tool.exe'), 'a program');
  put(path.join(raw, 'tool', 'data', 'x.txt'), 'its data');
  put(path.join(raw, 'copied-over.vpk'), 'about to be replaced');
  put(path.join(raw, 'incoming.vpk'), 'the copy');
  put(path.join(raw, 'onto-src.vpk'), 'moved over another');
  put(path.join(raw, 'onto-dst.vpk'), 'was in the way');
}

const scenarios: Record<string, () => Promise<void> | void> = {
  /** every kind of step FileTx takes, and one file written twice */
  steps: () => FileTx.run((tx) => {
    tx.write(path.join(raw, 'overwrite.vpk'), 'first new version');
    tx.write(path.join(raw, 'deep', 'er', 'fresh.vpk'), 'fresh');
    tx.move(path.join(raw, 'move-me.vpk'), path.join(raw, 'move-me.vpk.off'));
    tx.remove(path.join(raw, 'remove-me.vpk'));
    tx.remove(path.join(raw, 'tool'));
    tx.copy(path.join(raw, 'incoming.vpk'), path.join(raw, 'copied-over.vpk'));
    tx.move(path.join(raw, 'onto-src.vpk'), path.join(raw, 'onto-dst.vpk'));
    tx.write(path.join(raw, 'overwrite.vpk'), 'second new version');
  }),
  /** a catalog install, the record written in the same change (src/ipc-mods.ts) */
  install: async () => {
    const { installer, library } = open();
    await installer.install({
      categoryId: 'heroes', modName: 'delta', fileRef: 'delta.zip',
      record: (files) => { library.add({ name: 'delta', categoryId: 'heroes', fileRef: 'delta.zip', files }); },
    });
  },
  /** switching a mod off and on (src/ipc-library.ts mods:setEnabled) */
  disable: () => {
    const { installer, library, named } = open();
    const rec = named('alpha');
    FileTx.run(() => { installer.setEnabled(rec.files, false, rec.id); library.setEnabled(rec.id, false); });
  },
  enable: () => {
    const { installer, library, named } = open();
    const rec = named('beta');
    FileTx.run(() => { installer.setEnabled(rec.files, true, rec.id); library.setEnabled(rec.id, true); });
  },
  /** removing a mod (src/ipc-library.ts removeOne) */
  remove: () => {
    const { installer, library, named } = open();
    const rec = named('alpha');
    FileTx.run(() => { installer.remove(rec.files, { recId: rec.id, deployed: true }); library.removeRecord(rec.id); });
  },
  /** trading two mods' slots (src/ipc-library.ts mods:move) */
  swap: () => {
    const { installer, library, named } = open();
    FileTx.run(() => {
      for (const m of installer.swapSlots(named('alpha'), named('beta'))) library.update(m.id, { files: m.files });
    });
  },
  /** laying the library out into its two parts (src/slot-zones.ts) */
  layout: () => {
    const { installer, library } = open();
    installer.migrateSlotZones(library);
  },
};

async function main(): Promise<void> {
  if (mode === 'seed') { seed(); return; }
  if (mode === 'recover') {
    countPoints();
    recoverJournals(path.join(userData, 'tx'));
  } else {
    const run = scenarios[mode];
    if (!run) throw new Error(`no scenario ${mode}`);
    FileTx.journalDir = path.join(userData, 'tx');
    countPoints();
    await run();
  }
  process.stdout.write(`${JSON.stringify({ done: true, points, commitAt })}\n`);
}

main().catch((err) => { process.stderr.write(`${err.stack || err}\n`); process.exit(2); });
