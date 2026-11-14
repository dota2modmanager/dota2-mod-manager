// The uninstaller's window under Tauri is a copy of renderer/uninstall.html beside the app's page
// (tools/ui-build.mjs copyUninstallPage). A file the page links that the copy leaves out is a
// window without its styles or its script, on the one run nobody can repeat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyUninstallPage, UNINSTALL_PAGE } from '../tools/ui-build.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

test('the copy carries everything the uninstall page links, and lets it reach the shell', () => {
  const html = fs.readFileSync(path.join(ROOT, 'renderer', 'uninstall.html'), 'utf8');
  const linked = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(linked.includes('uninstall.js'));
  for (const rel of linked) assert.ok(UNINSTALL_PAGE.includes(rel), `${rel} is copied`);

  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-uninstall-page-'));
  try {
    copyUninstallPage(out);
    for (const rel of linked) assert.ok(fs.existsSync(path.join(out, rel)), rel);
    // the fonts the styles name sit where fonts.css looks for them
    const fonts = fs.readFileSync(path.join(out, 'styles', 'fonts.css'), 'utf8');
    for (const m of fonts.matchAll(/url\(\.\.\/fonts\/([^)]+)\)/g)) {
      assert.ok(fs.existsSync(path.join(out, 'fonts', m[1])), m[1]);
    }
    const copied = fs.readFileSync(path.join(out, 'uninstall.html'), 'utf8');
    assert.match(copied, /connect-src ipc: http:\/\/ipc\.localhost/);
    assert.doesNotMatch(copied, /connect-src 'none'/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
