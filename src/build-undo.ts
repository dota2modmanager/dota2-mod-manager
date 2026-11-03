/* Cancel on the item table's bar (issue #425): the build stops, and the change that started it goes
 * back too.
 *
 * The table is what makes the game match My mods, so a build dropped halfway would leave the
 * library saying a look is on while the game still wears the old one. Instead the app keeps a
 * picture of the library as of the last table written (mark, after every write and at a start
 * with nothing pending), and Cancel puts the records the table reads back the way that picture
 * has them: a pick taken off again, a switched mod switched back, a look put back on. One change,
 * all of it or none (src/file-tx.ts): a preset of thirty looks goes back whole. */
import { FileTx } from './file-tx.ts';
import { touchesSchema } from './preset-install.ts';
import type { Installer } from './installer.ts';
import type { Library } from './library.ts';
import type { Settings } from './settings.ts';
import type { LibRecord } from './types.ts';

/** What Cancel did: how many records went back, and the names of those that could not. */
export type Undone = { ok: true; undone: number; left: string[] } | { ok: false; reason: 'nothing' | 'unknown' };

/** The one setting besides the records that the table is built from. */
const EVERYONE = 'everyoneWearsMine' as const;

/** Cancel for the item table: a picture of what the game has, and the way back to it. */
export function createBuildUndo({ library, installer, settings, schema, log = () => {} }: {
  library: Library;
  installer: Pick<Installer, 'setEnabled' | 'masterIsOff' | 'setMasterEnabled'>;
  settings: Pick<Settings, 'get' | 'set'>;
  schema: { cancel: () => boolean };
  log?: (msg: string) => void;
}) {
  let shot: { records: Map<string, LibRecord>; everyone: boolean; off: boolean } | null = null;
  // no game folder yet (a first start) says nothing is switched off, rather than throwing
  const off = () => { try { return installer.masterIsOff(); } catch { return false; } };

  /** What the game wears now: called once a table is written, or dropped. */
  function mark(): void {
    const records = new Map(library.list().filter(touchesSchema).map((r) => [r.id, structuredClone(r)] as const));
    shot = { records, everyone: !!settings.get(EVERYONE), off: off() };
  }

  /** The records the table reads, put back the way the picture has them. */
  function putBack(): { undone: number; left: string[] } {
    let undone = 0;
    const left: string[] = [];
    const was = shot!.records;
    for (const rec of library.list().filter(touchesSchema)) {
      const old = was.get(rec.id);
      if (old && JSON.stringify(old) === JSON.stringify(rec)) continue;
      undone++;
      if (!old) {
        // new since the table: a pick has no files and goes; a mod is kept, switched off
        if (!rec.files.length) library.removeRecord(rec.id);
        else if (rec.enabled !== false) { installer.setEnabled(rec.files, false, rec.id); library.setEnabled(rec.id, false); }
        continue;
      }
      if ((old.enabled !== false) !== (rec.enabled !== false) && rec.files.length) installer.setEnabled(rec.files, old.enabled !== false, rec.id);
      // the record as it was: its effect, style and switch (a mod's files are the same files)
      Object.keys(rec).forEach((k) => { if (!(k in old)) delete (rec as unknown as Record<string, unknown>)[k]; });
      library.update(rec.id, { ...old, files: rec.files });
    }
    // gone since the table: a pick comes back, a mod's files are gone with it
    const now = new Set(library.list().map((r) => r.id));
    for (const [id, old] of was) {
      if (now.has(id)) continue;
      undone++;
      if (old.files.length) { left.push(old.name); continue; }
      library.list().push(structuredClone(old));
      library.save();
    }
    return { undone, left };
  }

  /** Stop the build and put back the change that started it. */
  function cancel(): Undone {
    if (!shot) return { ok: false, reason: 'unknown' };
    if (!schema.cancel()) return { ok: false, reason: 'nothing' };
    const r = FileTx.run(() => {
      if (off() !== shot!.off) installer.setMasterEnabled(!shot!.off);
      if (!!settings.get(EVERYONE) !== shot!.everyone) settings.set(EVERYONE, shot!.everyone);
      return putBack();
    }, log);
    // the game and the library agree again, unless a mod's files went for good
    if (!r.left.length) settings.set('schemaPending', false);
    log(`schema: build cancelled, ${r.undone} record(s) put back${r.left.length ? `, ${r.left.length} could not be` : ''}`);
    return { ok: true, ...r };
  }

  return { mark, cancel, marked: () => shot !== null };
}
