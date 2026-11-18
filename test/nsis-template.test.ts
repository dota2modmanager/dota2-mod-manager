// The Tauri installer is built from our own copy of tauri-bundler's NSIS template
// (src-tauri/windows/installer.nsi), changed in one place: the uninstaller's stock
// "Delete app data" check box is gone, because the app asks that in its own window.
// A copy that drifts from the CLI that builds it is an installer nobody tested, so the copy is
// held to the CLI's version and, where the CLI's Windows binary is installed, to its text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEMPLATE = path.join(ROOT, 'src-tauri', 'windows', 'installer.nsi');
// line endings follow the checkout (core.autocrlf), so they are not compared
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const ours = lf(fs.readFileSync(TEMPLATE, 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const cliVersion = lock.packages['node_modules/@tauri-apps/cli'].version;
const PAGE_PRE = '!define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipIfPassive';

test('tauri.conf.json builds the installer from our template', () => {
  const conf = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  assert.equal(conf.bundle.windows.nsis.template, 'windows/installer.nsi');
});

test('the template was taken from the CLI the lockfile installs', () => {
  const from = ours.match(/template of @tauri-apps\/cli (\d+\.\d+\.\d+)/)?.[1];
  assert.equal(from, cliVersion, `installer.nsi came from CLI ${from}, the lockfile has ${cliVersion}: take the template again`);
});

test('the uninstaller shows no check box of its own', () => {
  assert.doesNotMatch(ours, /un\.ConfirmShow|BM_GETCHECK|\$\(deleteAppData\)/);
  // the stock wipe reads this state; never set, it stays 0
  assert.match(ours, /^Var DeleteAppDataCheckboxState\r?$/m);
  assert.doesNotMatch(ours, /StrCpy \$DeleteAppDataCheckboxState/);
});

const cliBinary = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli-win32-x64-msvc', 'cli.win32-x64-msvc.node');
test('apart from the check box, the template is the CLI\'s own', { skip: !fs.existsSync(cliBinary) && 'no Windows CLI binary here' }, () => {
  const bin = fs.readFileSync(cliBinary);
  const at = bin.indexOf('DeleteAppDataCheckboxState');
  assert.ok(at > 0, 'the CLI still ships the template with the check box');
  const start = bin.lastIndexOf('Unicode true', at);
  const end = bin.indexOf(0, at);
  const stock = lf(bin.subarray(start, end).toString('utf8'));
  const cut = (s: string, from: string) => s.slice(0, s.indexOf(from)) + s.slice(s.indexOf(PAGE_PRE));
  const mine = ours.slice(ours.indexOf('Unicode true'));
  assert.equal(cut(mine, '; Dota 2 Mod Manager: no'), cut(stock, 'Var DeleteAppDataCheckbox\n'));
});
