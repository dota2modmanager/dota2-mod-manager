/* Electron's main-process API, asked for at the moment it is used.
 *
 * A module that imported electron at its top would take whatever it got the first time it was
 * loaded, and an ES module is loaded once. The tests stand a small fake Electron under the IPC
 * modules (test/load-order.test.js); read at load, every test after the first would register
 * its channels into the first test's fake. Asked for through require on each use, it is whatever
 * is standing there now: the real one in the app, the fake in a test, and under plain node, where
 * the electron package is only a path to the binary, nothing that anything here calls.
 */
import { createRequire } from 'node:module';

const load = createRequire(import.meta.url);

/** The electron module, as it stands when this is called. */
export function electron(): typeof import('electron') {
  return load('electron') as typeof import('electron');
}
