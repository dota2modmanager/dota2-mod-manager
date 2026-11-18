// The installer's hooks (src-tauri/windows/hooks.nsh) call Tauri's CheckIfAppIsRunning, which
// keeps a Restart Manager session in $R0 and its messages in $R1-$R3. A hook that stored
// something there before the check reads garbage after it: the takeover of the Electron install
// once looked for the old uninstaller under the session handle instead of the folder, found
// nothing, and left the whole Electron build beside the new exe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HOOKS = fs.readFileSync(path.join(ROOT, 'src-tauri', 'windows', 'hooks.nsh'), 'utf8').replace(/\r\n/g, '\n');
const CLOBBERED = /\$R[0-3]\b/;

/** Each `!macro ... !macroend` body, comments dropped, with the macro's name. */
function macros(text: string) {
  const out: { name: string; lines: string[] }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*;.*$/, '').trim();
    const start = /^!macro\s+(\S+)/.exec(line);
    if (start) { cur = { name: start[1], lines: [] }; continue; }
    if (/^!macroend\b/.test(line)) { if (cur) out.push(cur); cur = null; continue; }
    if (cur && line) cur.lines.push(line);
  }
  return out;
}

test('the hooks call CheckIfAppIsRunning (the check this guards against)', () => {
  assert.ok(macros(HOOKS).some((m) => m.lines.some((l) => l.includes('CheckIfAppIsRunning'))));
});

test('no hook reads $R0-$R3 after CheckIfAppIsRunning has overwritten them', () => {
  for (const m of macros(HOOKS)) {
    const at = m.lines.findIndex((l) => l.includes('CheckIfAppIsRunning'));
    if (at < 0) continue;
    const bad = m.lines.slice(at + 1).filter((l) => CLOBBERED.test(l));
    assert.deepEqual(bad, [], `${m.name} reads a register the check overwrote`);
  }
});

test('the takeover runs the Electron uninstaller from the folder it moved into', () => {
  const pre = macros(HOOKS).find((m) => m.name === 'NSIS_HOOK_PREINSTALL');
  assert.ok(pre);
  const run = pre.lines.find((l) => l.startsWith('ExecWait'));
  assert.ok(run && run.includes('$INSTDIR\\${D2MM_ELECTRON_UNINSTALLER}') && run.includes('_?=$INSTDIR'), run);
});

test('the takeover removes the Electron layout itself, whatever its uninstaller managed', () => {
  const pre = macros(HOOKS).find((m) => m.name === 'NSIS_HOOK_PREINSTALL');
  assert.ok(pre);
  const after = pre.lines.slice(pre.lines.findIndex((l) => l.startsWith('ExecWait')));
  for (const want of ['RMDir /r "$INSTDIR\\resources"', 'RMDir /r "$INSTDIR\\locales"',
    'Delete "$INSTDIR\\ffmpeg.dll"', 'Delete "$INSTDIR\\LICENSE.electron.txt"']) {
    assert.ok(after.includes(want), `no ${want} after the uninstaller runs`);
  }
  // this build's own files are never on that list
  const own = after.filter((l) => /^(Delete|RMDir)/.test(l) && /\$INSTDIR\\(app\b|uninstall\.exe|\$\{MAINBINARYNAME\})/.test(l));
  assert.deepEqual(own, []);
});
