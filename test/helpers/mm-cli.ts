// mm-cli, the Rust core on the command line (crates/mm-cli), for the tests that check the app's
// answers against it. On a developer's machine a test skips when it is not built yet; under CI
// (the CI variable every runner sets) a missing binary fails the file, since a skip there would
// leave the Rust side unchecked while every check reads green. test.yml builds it first.
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const CLI = path.join(ROOT, 'target', 'debug', process.platform === 'win32' ? 'mm-cli.exe' : 'mm-cli');

/** False when mm-cli is there, the reason to skip when it is not; under CI it throws instead. */
export function cliSkip(): false | string {
  if (fs.existsSync(CLI)) return false;
  if (process.env.CI) throw new Error(`mm-cli is not built at ${CLI}: CI has to run cargo build -p mm-cli before the tests`);
  return 'mm-cli is not built (cargo build -p mm-cli)';
}
