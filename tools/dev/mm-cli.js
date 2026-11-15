/* mm-cli, the Rust core on the command line (crates/mm-cli), for the tools that need the app's own
 * code: reading and writing VPKs, the catalog, the gameinfo patch. Built with cargo the first time
 * a tool asks for it, and its answer read as JSON. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const MM_CLI = path.join(ROOT, 'target', 'debug', process.platform === 'win32' ? 'mm-cli.exe' : 'mm-cli');

/** mm-cli built, if it is not yet. */
function ensureMmCli() {
  if (fs.existsSync(MM_CLI)) return MM_CLI;
  console.error('building mm-cli (cargo build -p mm-cli)');
  execFileSync('cargo', ['build', '-p', 'mm-cli'], { cwd: ROOT, stdio: ['ignore', 2, 2] });
  return MM_CLI;
}

/** One mm-cli command and its JSON answer. */
function mm(...args) {
  let out;
  try {
    out = execFileSync(ensureMmCli(), args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // what mm-cli said, not the command line it was started with
    throw new Error(String(e.stderr || '').trim() || e.message);
  }
  return JSON.parse(out);
}

/** A scratch folder for one tool run, removed when the process ends. */
let scratch = null;
function tmpDir() {
  if (!scratch) {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-tool-'));
    process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
  }
  return scratch;
}
let n = 0;
/** A JSON file in the scratch folder. */
function jsonFile(value) {
  const file = path.join(tmpDir(), `${n++}.json`);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

/**
 * One function of the Rust core by its name (the names test/rust-calls.test.ts uses), and its
 * answer; an error it answers with is thrown. An argument {$file: path} hands it that file.
 */
function call(name, ...args) {
  const [r] = mm('call', jsonFile([[name, ...args]]));
  if (r && 'error' in r) throw new Error(r.error);
  return r.ok;
}

/** Bytes in a file in the scratch folder. */
function binFile(bytes) {
  const file = path.join(tmpDir(), `${n++}.bin`);
  fs.writeFileSync(file, bytes);
  return file;
}

/** One file out of a VPK (the game's pak01, say), copied into the scratch folder: its path there. */
function vpkFile(vpk, rel) {
  const dir = fs.mkdtempSync(path.join(tmpDir(), 'x-'));
  const got = mm('vpk-extract', vpk, dir, jsonFile([rel]));
  if (!got.length) throw new Error(`${rel} is not in ${vpk}`);
  return path.join(dir, ...rel.split('/'));
}

/** The game folder the app's settings name, for the tools that default to it. */
function appGame() {
  const base = process.env.APPDATA || path.join(os.homedir(), '.config');
  try { return JSON.parse(fs.readFileSync(path.join(base, 'Dota 2 Mod Manager', 'settings.json'), 'utf8')).dotaGamePath || null; } catch { return null; }
}

module.exports = { MM_CLI, ensureMmCli, mm, call, tmpDir, jsonFile, binFile, vpkFile, appGame };
