/* The half of FileTx that outlives the process.
 *
 * A transaction undoes itself when a step throws. It cannot when the process is gone: killed
 * from Task Manager, closed by Windows Update, cut by a power failure halfway through moving
 * a pak. Until 2026-10-10 the next start had only the parked .mmtx files to go on
 * (sweepStaged in src/installer-folder.ts), and a parked file cannot say which transaction it
 * belonged to or what else that transaction had already written. An install killed after its
 * second pak left those two paks in the folder with no library record.
 *
 * So every step is written here before it is taken, one JSON line each, flushed to the disk
 * first. A journal that ends in a commit line belonged to a change that finished: the next
 * start drops what it parked. One that does not is undone, every step from the last to the
 * first, and the folder is back to the moment before the change began.
 *
 * A step is written before it is taken, so its undo cannot know how far the step got. Each one
 * below is written to be right from any point inside its step - not started, half done, done -
 * and to be right a second time, because recovery can be killed too and simply runs again on
 * the start after that.
 */
import fs from 'node:fs';
import path from 'node:path';

/** A step about to be taken, and how to take it back. */
export type Undo =
  | { what: 'unwrite'; dest: string; parked: string | null }
  | { what: 'unmove'; from: string; to: string; parked: string | null }
  | { what: 'unremove'; target: string; parked: string }
  | { what: 'rmdir'; dir: string };

/** The journal's own extension, in the folder FileTx.journalDir names. */
export const JOURNAL_EXT = '.txlog';

/** Is anything at this path, a dangling link included. existsSync follows links and says no. */
const there = (p: string): boolean => {
  try { fs.lstatSync(p); return true; } catch { return false; }
};

/**
 * Take one step back.
 *
 * unwrite: no original means whatever is at dest, whole or half written, is ours to delete. An
 *   original that was parked goes back over it. An original that was never parked is still at
 *   dest, untouched, because parking is the first thing the step does.
 * unmove: the source is gone only once the rename happened, so that is when it is renamed back.
 *   The rename refuses a missing source, so FileTx.move checks for one before it writes this.
 * unremove: the parked copy goes back, unless the target is somehow there again.
 * rmdir: only an empty folder, and only if it exists.
 *
 * Answers what it could not bring back: an original that is neither parked nor in its place,
 * because something deleted it in between (an antivirus, a cleaner, the user). Nothing can
 * restore that, but the log should say so.
 */
export function undoStep(op: Undo): string | null {
  if (op.what === 'unwrite') {
    if (op.parked === null) { fs.rmSync(op.dest, { recursive: true, force: true }); return null; }
    if (!there(op.parked)) return there(op.dest) ? null : `${op.dest} is gone, and so is its parked copy`;
    fs.rmSync(op.dest, { recursive: true, force: true });
    fs.renameSync(op.parked, op.dest);
  } else if (op.what === 'unmove') {
    if (there(op.to) && !there(op.from)) fs.renameSync(op.to, op.from);
    if (op.parked && there(op.parked) && !there(op.to)) fs.renameSync(op.parked, op.to);
  } else if (op.what === 'unremove') {
    if (there(op.target)) return null;
    if (!there(op.parked)) return `${op.target} is gone, and so is its parked copy`;
    fs.renameSync(op.parked, op.target);
  } else {
    try { fs.rmdirSync(op.dir); } catch { /* not empty, or not there: not ours to delete */ }
  }
  return null;
}

/** Where a step parked an original, if it did. */
export function parkedBy(op: Undo): string | null {
  return op.what === 'rmdir' ? null : op.parked;
}

/** One transaction's journal: opened on its first step, so a change that takes none leaves no file. */
export class Journal {
  file: string;
  #fd: number | null = null;

  constructor(file: string) {
    this.file = file;
  }

  /** Append one line, and make sure it is on the disk before the step it describes is taken. */
  add(entry: Undo | { commit: true }): void {
    if (this.#fd === null) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.#fd = fs.openSync(this.file, 'a');
    }
    fs.writeSync(this.#fd, `${JSON.stringify(entry)}\n`);
    fs.fsyncSync(this.#fd);
  }

  /** Done with it: the change committed or was undone in this process, so nothing is left to recover. */
  close(): void {
    if (this.#fd !== null) {
      try { fs.closeSync(this.#fd); } catch { /* already closed */ }
      this.#fd = null;
    }
    fs.rmSync(this.file, { force: true });
  }
}

const isUndo = (e: unknown): e is Undo => {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  const str = (v: unknown) => typeof v === 'string' && v.length > 0;
  const parked = (v: unknown) => v === null || str(v);
  if (o.what === 'unwrite') return str(o.dest) && parked(o.parked);
  if (o.what === 'unmove') return str(o.from) && str(o.to) && parked(o.parked);
  if (o.what === 'unremove') return str(o.target) && str(o.parked);
  if (o.what === 'rmdir') return str(o.dir);
  return false;
};

/**
 * What a journal says: its steps in order, and whether the change got as far as committing.
 * Reading stops at the first line that is not whole: a power cut can cut the last line short,
 * and the step it was describing was never started, because a step starts after its line is
 * on the disk.
 */
export function readJournal(file: string): { steps: Undo[]; committed: boolean } {
  const steps: Undo[] = [];
  let committed = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { break; }
    if (entry && typeof entry === 'object' && (entry as { commit?: unknown }).commit === true) committed = true;
    else if (isUndo(entry)) steps.push(entry);
    else break;
  }
  return { steps, committed };
}

/**
 * Finish whatever a killed process left in `dir`. Runs once at start, before anything opens the
 * library or touches the game folder (src/services.ts); the app holds a single-instance lock, so
 * every journal found here belongs to a process that is gone.
 *
 * A step that cannot be undone - Dota holding the pak - is logged and the rest still run, the
 * same bargain as rollback in a live process. The journal is dropped either way: kept, it would
 * replay those steps on a later start over changes made in between. A parked file it could not
 * put back is still next to its original, where sweepStaged finds it.
 */
export function recoverJournals(dir: string | null, log: (msg: string) => void = () => {}): { undone: number; finished: number } {
  const out = { undone: 0, finished: 0 };
  if (!dir) return out;
  let names: string[];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(JOURNAL_EXT)); } catch { return out; }
  // newest first, so two left behind come apart in the reverse of the order they were made in
  for (const name of names.sort().reverse()) {
    const file = path.join(dir, name);
    let read: ReturnType<typeof readJournal>;
    try { read = readJournal(file); } catch (err) { log(`tx recovery: unreadable ${name}: ${(err as Error).message}`); continue; }
    if (read.committed) {
      for (const op of read.steps) {
        const parked = parkedBy(op);
        if (!parked) continue;
        try { fs.rmSync(parked, { recursive: true, force: true }); } catch (err) { log(`tx recovery: leftover ${parked}: ${(err as Error).message}`); }
      }
      out.finished++;
    } else {
      for (let i = read.steps.length - 1; i >= 0; i--) {
        try {
          const lost = undoStep(read.steps[i]);
          if (lost) log(`tx recovery: ${lost}`);
        } catch (err) { log(`tx recovery: could not undo ${read.steps[i].what} in ${name}: ${(err as Error).message}`); }
      }
      out.undone++;
    }
    fs.rmSync(file, { force: true });
  }
  return out;
}
