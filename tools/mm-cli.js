/* mm-cli, the Rust core on the command line (crates/mm-cli), for the tools that need the app's own
 * code: reading and writing VPKs, the catalog, the gameinfo patch. Built with cargo the first time
 * a tool asks for it, and its answer read as JSON. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MM_CLI = path.join(ROOT, 'target', 'debug', process.platform === 'win32' ? 'mm-cli.exe' : 'mm-cli');

/** mm-cli built, if it is not yet. */
function ensureMmCli() {
  if (fs.existsSync(MM_CLI)) return MM_CLI;
  console.log('building mm-cli (cargo build -p mm-cli)');
  execFileSync('cargo', ['build', '-p', 'mm-cli'], { cwd: ROOT, stdio: 'inherit' });
  return MM_CLI;
}

/** One mm-cli command and its JSON answer. */
function mm(...args) {
  return JSON.parse(execFileSync(ensureMmCli(), args, { encoding: 'utf8', maxBuffer: 1 << 28 }));
}

module.exports = { MM_CLI, ensureMmCli, mm };
