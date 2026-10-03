/* The app's own log: a small file every install keeps, so a support report (src/diagnostics.ts)
 * does not depend on reproducing the problem live.
 *
 * Past a megabyte the file moves aside to app.log.1 and a new one starts, so the two together
 * stay near two. MM_DIAG mirrors every line to a path of its own, which the screenshot harness
 * reads. Nothing here throws: logging is never the reason the app crashes.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Past this size the log moves to app.log.1 and starts again. */
export const LOG_MAX_BYTES = 1024 * 1024;

/** Where the log is, and the one call everything in the main process writes to it with. */
interface AppLog {
  /** the log file, placed on first use */
  file(): string;
  /** one line, stamped with the time, into the log and into the mirror when there is one */
  diag(msg: string): void;
}

/**
 * @param dir     the userData folder, asked for on first use: a portable copy moves it at start
 * @param mirror  a second file to copy every line to (MM_DIAG), or nothing
 */
export function createAppLog({ dir, mirror = null, now = () => new Date() }: {
  dir: () => string; mirror?: string | null; now?: () => Date;
}): AppLog {
  let file: string | null = null;
  const fileOf = () => (file ??= path.join(dir(), 'logs', 'app.log'));

  function append(line: string): void {
    try {
      const f = fileOf();
      fs.mkdirSync(path.dirname(f), { recursive: true });
      try { if (fs.statSync(f).size > LOG_MAX_BYTES) fs.renameSync(f, `${f}.1`); } catch { /* first write */ }
      fs.appendFileSync(f, line);
    } catch { /* logging must never be why the app crashes */ }
  }

  return {
    file: fileOf,
    diag(msg) {
      const line = `${now().toISOString()} ${msg}\n`;
      append(line);
      if (mirror) { try { fs.appendFileSync(mirror, line); } catch { /* noop */ } }
    },
  };
}
