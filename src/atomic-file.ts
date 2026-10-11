/* Replace a small file so that whoever reads it next - this process, or the next start after
 * a crash - finds the old contents or the new ones, never half of either.
 *
 * manifest.json and settings.json were written in place. A process killed during that write
 * left a cut-off file; JSON.parse refused it on the next start, and the app went on with an
 * empty library (every installed mod shown as somebody else's file) or default settings (the
 * game looked for again, possibly finding another install). Writing beside the file and
 * renaming over it makes the change one step: the rename either happened or it did not.
 */
import fs from 'node:fs';
import path from 'node:path';

const pause = new Int32Array(new SharedArrayBuffer(4));
/** The codes Windows gives for a file somebody else has open for a moment. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Write `data` to `file` through a temporary file beside it. An antivirus or a backup tool
 * holding the old file makes Windows refuse the rename for a moment, so it is tried a few times;
 * if the file stays held, it is written in place as before rather than not written at all.
 */
export function writeFileAtomic(file: string, data: string | NodeJS.ArrayBufferView): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    if (typeof data === 'string') fs.writeSync(fd, data);
    else fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (!BUSY.has((err as NodeJS.ErrnoException).code || '')) { fs.rmSync(tmp, { force: true }); throw err; }
      if (attempt >= 4) break;
      Atomics.wait(pause, 0, 0, 25);
    }
  }
  try {
    fs.writeFileSync(file, data);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
