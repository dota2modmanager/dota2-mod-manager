/* The removal window may open for exactly one reason: a person is removing the program.
 *
 * It opened for another one once. Updating to 2.6.1 replaced the version by running the old
 * uninstaller, the app was started with --uninstall as part of that, and everybody who updated
 * got "Remove Dota 2 Mod Manager" on screen with boxes ticked. The write-up is
 * docs/incidents/2026-08-31-uninstaller-during-update.md.
 *
 * Two things stop it now, and they only work while they agree: the NSIS script never starts the
 * app on an update's command line, and the app refuses to open the window on one. So the cases
 * below are real command lines, and the last test holds the two lists to each other - a flag
 * added on one side only is this bug coming back quietly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { UPDATE_FLAGS, isUpdateRun, isUninstallRun } from '../src/uninstall-args.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

test('a person removing the program gets the questions', () => {
  assert.equal(isUninstallRun(['C:\\App\\Dota 2 Mod Manager.exe', '--uninstall']), true);
});

test('the command line an update actually uses asks nothing', () => {
  // app-builder-lib/templates/nsis/include/installUtil.nsh, uninstallOldVersion
  const argv = ['C:\\App\\Dota 2 Mod Manager.exe', '--uninstall', '/S', '/KEEP_APP_DATA', '--updated', '_?=C:\\App'];
  assert.equal(isUpdateRun(argv), true);
  assert.equal(isUninstallRun(argv), false);
});

test('each flag stops it on its own', () => {
  for (const flag of UPDATE_FLAGS) {
    assert.equal(isUninstallRun(['--uninstall', flag]), false, `${flag} did not stop the window`);
  }
});

test('case does not let one through', () => {
  assert.equal(isUninstallRun(['--uninstall', '--UPDATED']), false);
  assert.equal(isUninstallRun(['--uninstall', '/s']), false);
  assert.equal(isUninstallRun(['--uninstall', '/keep_app_data']), false);
});

test('a flag has to be the whole argument, not part of a path', () => {
  // somebody's install directory is not a reason to skip the questions
  assert.equal(isUninstallRun(['C:\\--updated\\app.exe', '--uninstall']), true);
  assert.equal(isUpdateRun(['C:\\Program Files\\S\\app.exe']), false);
});

test('a plain start is neither', () => {
  assert.equal(isUninstallRun(['C:\\App\\Dota 2 Mod Manager.exe']), false);
  assert.equal(isUpdateRun(['C:\\App\\Dota 2 Mod Manager.exe']), false);
  assert.equal(isUninstallRun([]), false);
});

test('the installer script tests for the same flags as the app', () => {
  const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8');
  const inScript = [...nsh.matchAll(/\$\{GetOptions\}\s+\$R8\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...inScript].sort(),
    [...UPDATE_FLAGS].sort(),
    'build/installer.nsh and src/uninstall-args.ts no longer stop on the same command lines',
  );
});

test('nothing destructive is ticked for the person in advance', () => {
  /* Putting the game's files back is ticked, because that is the one thing they cannot do later
     without this program. Deleting mods and deleting settings are not, because a mis-click there
     is not undoable either - and during the incident these were the ticked boxes people saw. */
  const js = fs.readFileSync(path.join(ROOT, 'renderer', 'uninstall.js'), 'utf8');
  const options = [...js.matchAll(/id:\s*'(opt\w+)'[\s\S]{0,400}?checked:\s*(true|false)/g)]
    .map((m) => [m[1], m[2] === 'true']);
  const state = Object.fromEntries(options);
  assert.equal(state.optRevert, true, 'putting the game back should stay ticked');
  assert.equal(state.optMods, false, 'deleting mods must not be ticked in advance');
  assert.equal(state.optData, false, 'deleting settings must not be ticked in advance');
});
