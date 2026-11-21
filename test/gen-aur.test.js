'use strict';
// The Arch package (tools/release/gen-aur.js): the release's .deb on Arch's own libraries.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pkgbuild, srcinfo, debSum, DEPENDS } = require('../tools/release/gen-aur.js');

const SUM = 'a'.repeat(64);

test("the .deb's digest is read from SHA256SUMS, and a release without one has none", () => {
  const sums = `${'b'.repeat(64)}  Dota-2-Mod-Manager.AppImage\n${SUM}  Dota-2-Mod-Manager-amd64.deb\n`;
  assert.equal(debSum(sums), SUM);
  assert.equal(debSum(`${'b'.repeat(64)}  Dota-2-Mod-Manager.AppImage\n`), null);
});

test('the package runs on Arch\'s WebKitGTK and GStreamer, and leaves updates to pacman', () => {
  const text = pkgbuild({ version: '4.7.0', sha256: SUM });
  for (const dep of ['webkit2gtk-4.1', 'gst-plugins-base', 'gst-plugins-good']) assert.ok(DEPENDS.includes(dep), dep);
  assert.match(text, /^pkgname=dota2-mod-manager-bin$/m);
  assert.match(text, /releases\/download\/v\$\{pkgver\}\/Dota-2-Mod-Manager-amd64\.deb/);
  assert.match(text, new RegExp(`^sha256sums=\\('${SUM}'\\)$`, 'm'));
  // the mark src-tauri/src/main.rs reads (PACKAGE_MANAGER_MARK)
  assert.match(text, /\/package-manager"/);
  assert.doesNotMatch(text, /@/, 'no address in the package');
});

test('.SRCINFO says what the PKGBUILD says', () => {
  const v = { version: '4.7.0', sha256: SUM };
  const info = srcinfo(v);
  const lines = info.split('\n');
  for (const dep of DEPENDS) assert.ok(lines.includes(`\tdepends = ${dep}`), dep);
  assert.match(info, /^\tpkgver = 4\.7\.0$/m);
  assert.match(info, new RegExp(`^\\tsha256sums = ${SUM}$`, 'm'));
  assert.match(info, /^pkgname = dota2-mod-manager-bin$/m);
});
