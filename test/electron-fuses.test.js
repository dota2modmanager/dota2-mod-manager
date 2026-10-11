/* The packaged app cannot be borrowed as a general-purpose runtime.
 *
 * An Electron executable starts as plain Node when ELECTRON_RUN_AS_NODE is set, takes code from
 * NODE_OPTIONS, and opens a debugger on --inspect. For an app people download and run, every one of
 * those is a way for anything else on the machine to run its own code under this app's name and
 * signature. Electron's fuses switch them off inside the binary, where a setting in the app cannot be
 * changed back; electron-builder flips them at packaging time (package.json, build.electronFuses).
 * Integrity validation makes the app refuse an app.asar that was changed after the build, and
 * onlyLoadAppFromAsar stops it loading a loose folder put beside it instead.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('the packaged app has the ways in that it does not use switched off', () => {
  const fuses = pkg.build.electronFuses;
  assert.ok(fuses, 'package.json build.electronFuses is missing');
  assert.equal(fuses.runAsNode, false, 'ELECTRON_RUN_AS_NODE would turn the exe into node');
  assert.equal(fuses.enableNodeOptionsEnvironmentVariable, false, 'NODE_OPTIONS would load code into it');
  assert.equal(fuses.enableNodeCliInspectArguments, false, '--inspect would open a debugger on it');
  assert.equal(fuses.enableEmbeddedAsarIntegrityValidation, true, 'a changed app.asar would still load');
  assert.equal(fuses.onlyLoadAppFromAsar, true, 'a loose app folder could stand in for app.asar');
});

test('nothing in the app relies on what the fuses take away', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|js|mjs|cjs)$/.test(e.name) && /ELECTRON_RUN_AS_NODE|NODE_OPTIONS|--inspect/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'))) offenders.push(rel);
    }
  };
  walk('src');
  walk('renderer');
  assert.deepEqual(offenders, [], 'these would stop working in the packaged app');
  assert.notEqual(pkg.build.asar, false, 'the fuses above assume the app is packed into app.asar');
});
