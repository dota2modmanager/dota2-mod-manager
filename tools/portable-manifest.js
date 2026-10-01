/*
 * Write portable.yml beside the built portable exe.
 *
 * The portable build cannot install over itself, so the app downloads the new one and leaves
 * it next to the old one (src/portable-update.ts). That download needs something to be checked
 * against, and this is it: the name, the size and the SHA-256 of the exe this release built.
 * CI uploads it to the release, the app fetches it from GitHub directly and refuses anything
 * that does not match.
 *
 * usage: node tools/portable-manifest.js [distDir] [version]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'Dota-2-Mod-Manager-Portable.exe';

function build(distDir, version, file = FILE) {
  const exe = path.join(distDir, file);
  const buf = fs.readFileSync(exe);
  const lines = [
    `version: ${String(version).replace(/^v/, '')}`,
    `file: ${file}`,
    `size: ${buf.length}`,
    `sha256: ${crypto.createHash('sha256').update(buf).digest('hex')}`,
    '',
  ];
  const out = path.join(distDir, 'portable.yml');
  fs.writeFileSync(out, lines.join('\n'));
  return { path: out, text: lines.join('\n') };
}

if (require.main === module) {
  const distDir = process.argv[2] || 'dist';
  const version = process.argv[3] || require('../package.json').version;
  const { path: out, text } = build(distDir, version);
  console.log(`${out}\n${text}`);
}

module.exports = { build, FILE };
