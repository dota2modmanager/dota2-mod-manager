/* Packs every arcana base under the "to compile" folder into a VPK with VPKTool, one at a time:
   copies the base's folders (models, materials, particles) next to VPKTool.exe, runs it, and moves
   the pakNN_dir.vpk it leaves into the base's own folder, replacing the one from the last run.

   VPKTool packs whatever folders sit beside it and deletes them, so the tool's folder has to hold
   nothing but the exe when a base goes in, or one base's VPK would carry another's files. It is a
   Python program that prints through rich, and rich crashes on a cp1251 console whenever its
   output is redirected, so it runs in a console window of its own, as a double click would.

   Each VPK is checked against the folder it was made from: the same number of files, or the run
   stops before anything is replaced.

   Usage: node tools/mods/pack-arcana-vpks.mjs [--src <dir>] [--tool <dir>] [name...]
     With no names, every folder under --src. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// the app's own VPK reader, through mm-cli (tools/dev/mm-cli.js)
const { mm } = createRequire(import.meta.url)('../dev/mm-cli.js');

const TIMEOUT_MS = 10 * 60 * 1000;
const isPak = (name) => /^pak\d+_dir\.vpk$/i.test(name);

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

function runTool(exe, cwd) {
  return new Promise((resolve, reject) => {
    // Start-Process gives it a console of its own with real handles; spawning it from Node hands it
    // ours, or NUL, which rich takes for a redirect and crashes on. The path goes in through the
    // environment and the script is a constant: `cmd /c start` parsed the path as a command line,
    // so a folder with an & in its name would have run what came after it.
    const script = '$p = Start-Process -FilePath $env:VPKTOOL_EXE -WorkingDirectory $env:VPKTOOL_DIR -PassThru -Wait; exit $p.ExitCode';
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      cwd, stdio: 'ignore', windowsHide: true, env: { ...process.env, VPKTOOL_EXE: exe, VPKTOOL_DIR: cwd },
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`VPKTool still running after ${TIMEOUT_MS / 60000} min`)); }, TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
}

async function packOne(srcDir, toolDir, exe) {
  const folders = fs.readdirSync(srcDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  if (!folders.length) throw new Error('no folders to pack');
  const files = folders.reduce((n, f) => n + countFiles(path.join(srcDir, f)), 0);
  for (const f of folders) fs.cpSync(path.join(srcDir, f), path.join(toolDir, f), { recursive: true });

  const code = await runTool(exe, toolDir);
  const left = fs.readdirSync(toolDir).filter((n) => n !== path.basename(exe));
  const paks = left.filter(isPak);
  const leftovers = left.filter((n) => !isPak(n));
  if (code !== 0 || paks.length !== 1 || leftovers.length) {
    // put the tool's folder back to just the exe, so the next base starts clean
    for (const n of leftovers) fs.rmSync(path.join(toolDir, n), { recursive: true, force: true });
    for (const n of paks) fs.rmSync(path.join(toolDir, n));
    throw new Error(`VPKTool exited ${code}, left ${left.join(', ') || 'nothing'}`);
  }

  const made = path.join(toolDir, paks[0]);
  const entries = mm('vpk-entries', made).length;
  if (entries !== files) {
    fs.rmSync(made);
    throw new Error(`the VPK has ${entries} files, the folder ${files}`);
  }
  for (const old of fs.readdirSync(srcDir).filter(isPak)) fs.rmSync(path.join(srcDir, old));
  fs.renameSync(made, path.join(srcDir, paks[0]));
  return { pak: paks[0], files };
}

async function main(argv) {
  let src = 'C:/Apps/to compile';
  let toolDir = 'C:/Apps/VPKTool-Win';
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src') src = argv[++i];
    else if (argv[i] === '--tool') toolDir = argv[++i];
    else names.push(argv[i]);
  }
  const exe = path.join(toolDir, 'VPKTool.exe');
  if (!fs.existsSync(exe)) throw new Error(`no VPKTool.exe in ${toolDir}`);
  const stray = fs.readdirSync(toolDir).filter((n) => n !== 'VPKTool.exe');
  if (stray.length) throw new Error(`${toolDir} must hold only VPKTool.exe; move these out first: ${stray.join(', ')}`);

  const bases = names.length ? names : fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  let failed = 0;
  for (const name of bases) {
    try {
      const { pak, files } = await packOne(path.join(src, name), toolDir, exe);
      console.log(`${name}: ${pak}, ${files} files`);
    } catch (err) {
      failed++;
      console.log(`${name}: FAILED, ${err.message}`);
    }
  }
  console.log(failed ? `\n${failed} of ${bases.length} failed` : `\nall ${bases.length} packed`);
  process.exitCode = failed ? 1 : 0;
}

await main(process.argv.slice(2));
