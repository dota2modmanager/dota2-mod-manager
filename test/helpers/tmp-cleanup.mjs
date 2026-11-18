// Loaded before every test file (`node --import`, see package.json). Each folder a test makes with
// mkdtemp is removed when its process ends. Tests made their scratch folders and left them: on
// 2026-11-15 a day of runs had left about 330 GB of them in the temp folder and filled the disk.
// Removing them here, rather than in each test, holds for a test that throws before its own
// clean-up line and for one written tomorrow without one.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const made = new Set();
const remember = (dir) => { made.add(dir); return dir; };

const mkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = (...a) => remember(mkdtempSync(...a));
const mkdtemp = fs.promises.mkdtemp;
fs.promises.mkdtemp = async (...a) => remember(await mkdtemp(...a));
const mkdtempCb = fs.mkdtemp;
fs.mkdtemp = (prefix, ...rest) => {
  const cb = rest.pop();
  return mkdtempCb(prefix, ...rest, (err, dir) => { if (!err) remember(dir); cb(err, dir); });
};
syncBuiltinESMExports();

export function removeMade() {
  for (const dir of made) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* a file still open on Windows; the next run's temp sweep is not ours to do */ }
  }
  made.clear();
}
process.on('exit', removeMade);
