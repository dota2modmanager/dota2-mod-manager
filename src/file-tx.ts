// All of it, or none of it.
//
// Installing one mod is five or six writes into somebody else's game folder, removing one is
// as many deletes, and switching one off renames every file it owns. Until now a failure in
// the middle - a locked file because Dota just started, a full disk, an antivirus holding a
// handle - left the folder half-changed: three paks of a mod with no library record, or a mod
// with half its files renamed to .off, which is the worst of the two states because the game
// happily loads the half that is left.
//
// So the writes go through here. Every step records how to undo itself, and a failure walks
// that list backwards. What gets displaced is not copied anywhere: it is renamed next to
// itself with a .mmtx suffix, which is atomic, costs nothing for a 300 MB pak, and cannot hit
// the cross-volume copy that staging in %APPDATA% would (the game usually lives on another
// drive). Commit deletes those; rollback renames them back.
//
// A step's undo is recorded before the step is taken, never after. Recorded after, a write
// that failed halfway - the disk filled up on the new pak - had already parked the original
// and had no undo to bring it back, so the rollback meant for exactly that failure left the
// original under its .mmtx name. And with FileTx.journalDir set (src/services.ts) the same
// record goes to a journal on the disk first, so a process killed in the middle is undone on
// the next start: src/file-tx-journal.ts.
//
// FileTx.run inside FileTx.run joins the open transaction instead of starting a second one,
// so a library record written in the same block as the files commits or rolls back with
// them (src/library.ts). The inner block is a savepoint: if it throws, its own steps are
// undone before the error reaches the caller, which may catch it and carry on.
import fs from 'node:fs';
import path from 'node:path';

import { JOURNAL_EXT, Journal, undoStep, type Undo } from './file-tx-journal.ts';

let counter = 0;

/** Something to write a file through: a transaction, or nothing, which writes directly. */
export type Writer = FileTx | null | undefined;

export class FileTx {
  /** Where journals go. Null writes none, which is what a unit test that is not about crashes wants. */
  static journalDir: string | null = null;
  static #open: FileTx | null = null;

  log: (msg: string) => void;
  id: string;
  /** in order; rollback walks it backwards */
  undo: Undo[];
  /** displaced originals, deleted on commit */
  staged: string[];
  done: boolean;
  #journal: Journal | null;
  #parked = 0;
  #afterUndo = new Set<() => void>();

  constructor(log: (msg: string) => void = () => {}) {
    this.log = log;
    this.id = `${Date.now().toString(36)}${(counter++).toString(36)}`;
    this.undo = [];
    this.staged = [];
    this.done = false;
    this.#journal = FileTx.journalDir ? new Journal(path.join(FileTx.journalDir, `${this.id}${JOURNAL_EXT}`)) : null;
  }

  /** The transaction a FileTx.run block is running in, if any: what a library save joins. */
  static open(): FileTx | null {
    return FileTx.#open;
  }

  /** Run `fn` after this transaction is undone, in full or back to a savepoint. */
  onUndo(fn: () => void): void {
    this.#afterUndo.add(fn);
  }

  // Every displacement gets a name of its own: the same file written twice in one change must
  // not park the second time over the original it parked the first time.
  #stagedName(target: string): string {
    return `${target}.${this.id}-${(this.#parked++).toString(36)}.mmtx`;
  }

  /** Record a step's undo - in memory, and in the journal on disk - before the step is taken. */
  #record(op: Undo): void {
    this.#journal?.add(op);
    this.undo.push(op);
    if (op.what !== 'rmdir' && op.parked) this.staged.push(op.parked);
  }

  /** Create every missing folder on the way to a file, remembering which ones are ours. */
  #ensureDir(dir: string): void {
    const made: string[] = [];
    let cur = path.resolve(dir);
    while (!fs.existsSync(cur)) {
      made.unshift(cur);
      const up = path.dirname(cur);
      if (up === cur) break;
      cur = up;
    }
    if (!made.length) return;
    // shallowest first: rollback walks the list backwards, so it empties a tree from the
    // bottom up and every folder is already empty by the time its turn comes
    for (const d of made) this.#record({ what: 'rmdir', dir: d });
    fs.mkdirSync(dir, { recursive: true });
  }

  /** The name the original at `target` will be parked under, or null when there is none to park. */
  #parkingFor(target: string): string | null {
    return fs.existsSync(target) ? this.#stagedName(target) : null;
  }

  /** Park whatever is at `target`, under the name the step already recorded. */
  #displace(target: string, parked: string | null): void {
    if (!parked) return;
    fs.renameSync(target, parked);
  }

  /** Write a file, over an existing one or not. */
  write(dest: string, buf: string | NodeJS.ArrayBufferView): string {
    this.#ensureDir(path.dirname(dest));
    const parked = this.#parkingFor(dest);
    this.#record({ what: 'unwrite', dest, parked });
    this.#displace(dest, parked);
    // dest is empty now, so the write creates it and fails rather than writes over something
    // that appeared in between: what the undo would then delete would not be ours
    // (js/file-system-race)
    fs.writeFileSync(dest, buf, { flag: 'wx' });
    return dest;
  }

  /** Copy a file in, over an existing one or not. */
  copy(src: string, dest: string): string {
    this.#ensureDir(path.dirname(dest));
    const parked = this.#parkingFor(dest);
    this.#record({ what: 'unwrite', dest, parked });
    this.#displace(dest, parked);
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    return dest;
  }

  /** Rename, which is how a mod is switched on and off. */
  move(from: string, to: string): string {
    // the undo tells "renamed already" from "not yet" by the source being gone, so a source
    // that was never there is refused here, before anything is recorded or parked
    if (!fs.existsSync(from)) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, rename '${from}' -> '${to}'`), { code: 'ENOENT', path: from });
    }
    this.#ensureDir(path.dirname(to));
    const parked = this.#parkingFor(to);
    this.#record({ what: 'unmove', from, to, parked });
    this.#displace(to, parked);
    fs.renameSync(from, to);
    return to;
  }

  /** Delete a file or a whole folder. Nothing is actually gone until commit. */
  remove(target: string): boolean {
    if (!fs.existsSync(target)) return false;
    const parked = this.#stagedName(target);
    this.#record({ what: 'unremove', target, parked });
    this.#displace(target, parked);
    return true;
  }

  /** Everything worked: drop the displaced originals and stop being undoable. */
  commit(): void {
    if (this.done) return;
    this.done = true;
    // the point of no return: from here a killed process is finished on the next start, not undone
    this.#journal?.add({ commit: true });
    for (const parked of this.staged) {
      try { fs.rmSync(parked, { recursive: true, force: true }); } catch (err) { this.log(`tx ${this.id}: leftover ${parked}: ${(err as Error).message}`); }
    }
    this.#journal?.close();
    this.staged = [];
    this.undo = [];
  }

  /** Undo the steps after `mark`, newest first. */
  #undoTo(mark: number): void {
    for (let i = this.undo.length - 1; i >= mark; i--) {
      const op = this.undo[i];
      try {
        const lost = undoStep(op);
        if (lost) this.log(`tx ${this.id}: ${lost}`);
      } catch (err) {
        const where = op.what === 'unwrite' ? op.dest : op.what === 'unremove' ? op.target : op.what === 'unmove' ? op.to : op.dir;
        this.log(`tx ${this.id}: could not undo ${op.what} ${where}: ${(err as Error).message}`);
      }
    }
    this.undo.length = mark;
    for (const fn of this.#afterUndo) {
      try { fn(); } catch (err) { this.log(`tx ${this.id}: after undo: ${(err as Error).message}`); }
    }
  }

  /**
   * Put the folder back the way it was. Best effort by design: this runs while another error
   * is already on its way up, so a step that cannot be undone is logged and the rest still
   * runs. Throwing here would replace the real error with a worse one.
   */
  rollback(): void {
    if (this.done) return;
    this.done = true;
    this.#undoTo(0);
    this.#journal?.close();
    this.staged = [];
  }

  /**
   * Run a block as one change: it commits when the block returns and rolls back if it throws.
   * `log` hears what could not be put back. Inside another FileTx.run it joins that change.
   */
  static run<T>(body: (tx: FileTx) => T, log?: (msg: string) => void): T {
    const outer = FileTx.#open;
    if (outer && !outer.done) return outer.#savepoint(body);
    const tx = new FileTx(log);
    FileTx.#open = tx;
    try {
      const out = body(tx);
      if (out && typeof (out as { then?: unknown }).then === 'function') {
        throw new Error('FileTx.run takes a synchronous block: the change would commit before its writes');
      }
      FileTx.#open = null;
      tx.commit();
      return out;
    } catch (err) {
      FileTx.#open = null;
      tx.rollback();
      throw err;
    } finally {
      FileTx.#open = null;
    }
  }

  #savepoint<T>(body: (tx: FileTx) => T): T {
    const mark = this.undo.length;
    try {
      return body(this);
    } catch (err) {
      this.#undoTo(mark);
      throw err;
    }
  }
}

/** Copy a file into place: through the transaction when there is one, directly when not. */
export function copyInto(src: string, dest: string, tx: Writer = null): void {
  if (tx) { tx.copy(src, dest); return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** Write bytes into place: through the transaction when there is one, directly when not. */
export function writeInto(buf: string | NodeJS.ArrayBufferView, dest: string, tx: Writer = null): void {
  if (tx) { tx.write(dest, buf); return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}
