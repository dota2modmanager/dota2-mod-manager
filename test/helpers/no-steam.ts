/* No Steam on this machine, for the length of a test file that describes a whole one.
 *
 * A game on a second drive keeps no userdata beside it, so src/gamelang.ts launchLanguage() also
 * looks where Steam installs by default, which on a developer's machine is a real Steam with real
 * launch options. Import this first in a test file that builds its own game folder: the default
 * locations then point at an empty directory until the process exits. Without it the suite passes
 * or fails depending on whether whoever runs it has -language set in their own Dota.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The empty directory Program Files points at while the file runs. */
export const NO_STEAM = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-nosteam-'));

const REAL = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles];
process.env['ProgramFiles(x86)'] = NO_STEAM;
process.env.ProgramFiles = NO_STEAM;
process.on('exit', () => {
  [process.env['ProgramFiles(x86)'], process.env.ProgramFiles] = REAL;
  try { fs.rmSync(NO_STEAM, { recursive: true, force: true }); } catch { /* going away anyway */ }
});
