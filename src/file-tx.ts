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
import fs from 'node:fs';
import path from 'node:path';

let counter = 0;

/** A step already taken, and how to take it back. */
type Undo =
  | { what: 'unwrite'; dest: string; parked: string | null }
  | { what: 'unmove'; from: string; to: string; parked: string | null }
  | { what: 'unremove'; target: string; parked: string }
  | { what: 'rmdir'; dir: string };

/** Something to write a file through: a transaction, or nothing, which writes directly. */
export type Writer = FileTx | null | undefined;

export class FileTx {
  log: (msg: string) => void;
  id: string;
  /** in order; rollback walks it backwards */
  undo: Undo[];
  /** displaced originals, deleted on commit */
  staged: string[];
  done: boolean;

  constructor(log: (msg: string) => void = () => {}) {
    this.log = log;
    this.id = `${Date.now().toString(36)}${(counter++).toString(36)}`;
    this.undo = [];
    this.staged = [];
    this.done = false;
  }

  #stagedName(target: string): string {
    return `${target}.${this.id}.mmtx`;
  }

  // Move whatever is at `target` out of the way, so the step that follows starts from an
  // empty spot and can be undone by putting the original back.
  #displace(target: string): string | null {
    if (!fs.existsSync(target)) return null;
    const parked = this.#stagedName(target);
    fs.renameSync(target, parked);
    this.staged.push(parked);
    return parked;
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
    fs.mkdirSync(dir, { recursive: true });
    // shallowest first: rollback walks the list backwards, so it empties a tree from the
    // bottom up and every folder is already empty by the time its turn comes
    for (const d of made) this.undo.push({ what: 'rmdir', dir: d });
  }

  /** Write a file, over an existing one or not. */
  write(dest: string, buf: string | NodeJS.ArrayBufferView): string {
    this.#ensureDir(path.dirname(dest));
    const parked = this.#displace(dest);
    fs.writeFileSync(dest, buf);
    this.undo.push({ what: 'unwrite', dest, parked });
    return dest;
  }

  /** Copy a file in, over an existing one or not. */
  copy(src: string, dest: string): string {
    this.#ensureDir(path.dirname(dest));
    const parked = this.#displace(dest);
    fs.copyFileSync(src, dest);
    this.undo.push({ what: 'unwrite', dest, parked });
    return dest;
  }

  /** Rename, which is how a mod is switched on and off. */
  move(from: string, to: string): string {
    this.#ensureDir(path.dirname(to));
    const parked = this.#displace(to);
    fs.renameSync(from, to);
    this.undo.push({ what: 'unmove', from, to, parked });
    return to;
  }

  /** Delete a file or a whole folder. Nothing is actually gone until commit. */
  remove(target: string): boolean {
    const parked = this.#displace(target);
    if (parked) this.undo.push({ what: 'unremove', target, parked });
    return !!parked;
  }

  /** Everything worked: drop the displaced originals and stop being undoable. */
  commit(): void {
    if (this.done) return;
    this.done = true;
    for (const parked of this.staged) {
      try { fs.rmSync(parked, { recursive: true, force: true }); } catch (err) { this.log(`tx ${this.id}: leftover ${parked}: ${(err as Error).message}`); }
    }
    this.staged = [];
    this.undo = [];
  }

  /**
   * Put the folder back the way it was. Best effort by design: this runs while another error
   * is already on its way up, so a step that cannot be undone is logged and the rest still
   * runs. Throwing here would replace the real error with a worse one.
   */
  rollback(): void {
    if (this.done) return;
    this.done = true;
    for (let i = this.undo.length - 1; i >= 0; i--) {
      const op = this.undo[i];
      try {
        if (op.what === 'unwrite') {
          fs.rmSync(op.dest, { force: true });
          if (op.parked) fs.renameSync(op.parked, op.dest);
        } else if (op.what === 'unmove') {
          if (fs.existsSync(op.to)) fs.renameSync(op.to, op.from);
          if (op.parked) fs.renameSync(op.parked, op.to);
        } else if (op.what === 'unremove') {
          fs.renameSync(op.parked, op.target);
        } else if (op.what === 'rmdir') {
          // only if we left it as empty as we found it: something else may have moved in
          try { fs.rmdirSync(op.dir); } catch { /* not empty, not ours to delete */ }
        }
      } catch (err) {
        const where = op.what === 'unwrite' ? op.dest : op.what === 'unremove' ? op.target : op.what === 'unmove' ? op.to : op.dir;
        this.log(`tx ${this.id}: could not undo ${op.what} ${where}: ${(err as Error).message}`);
      }
    }
    this.undo = [];
    this.staged = [];
  }

  /**
   * Run a block as one change: it commits when the block returns and rolls back if it throws.
   * `log` hears what could not be put back.
   */
  static run<T>(body: (tx: FileTx) => T, log?: (msg: string) => void): T {
    const tx = new FileTx(log);
    try {
      const out = body(tx);
      tx.commit();
      return out;
    } catch (err) {
      tx.rollback();
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

