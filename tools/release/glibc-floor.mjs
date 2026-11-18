#!/usr/bin/env node
/**
 * The newest glibc an unpacked AppImage asks for, refused past a ceiling.
 *
 *   node tools/release/glibc-floor.mjs <squashfs-root> [2.39]
 *
 * The AppImage carries WebKitGTK and the libraries under it from the machine that built it, and
 * each asks for the glibc of that machine. 4.0.0 was built on ubuntu-latest, Ubuntu 26.04 with
 * glibc 2.43, and on Linux Mint 22 (glibc 2.39) it stopped at "GLIBC_2.43 not found" before a
 * window opened (reported 2026-11-18). The system's own libc is never bundled, so what the
 * image needs is the highest GLIBC_x.y any of its ELF files names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [root, ceiling = '2.39'] = process.argv.slice(2);
if (!root) {
  console.error('usage: node tools/release/glibc-floor.mjs <squashfs-root> [max glibc]');
  process.exit(2);
}

/** "2.39" -> [2, 39], for comparing. */
const parts = (v) => v.split('.').map(Number);
export const newer = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

function* elves(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* elves(p);
    else if (e.isFile()) {
      const fd = fs.openSync(p, 'r');
      const head = Buffer.alloc(4);
      fs.readSync(fd, head, 0, 4, 0);
      fs.closeSync(fd);
      if (head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) yield p;
    }
  }
}

let top = '0';
const over = [];
for (const file of elves(root)) {
  let text = '';
  try { text = execFileSync('objdump', ['-T', file], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch { continue; }
  let mine = '0';
  for (const m of text.matchAll(/GLIBC_(\d+\.\d+(?:\.\d+)?)/g)) if (newer(m[1], mine)) mine = m[1];
  if (newer(mine, top)) top = mine;
  if (newer(mine, ceiling)) over.push(`${path.relative(root, file)} needs GLIBC_${mine}`);
}
console.log(`newest glibc the image asks for: ${top} (ceiling ${ceiling})`);
if (over.length) {
  console.error(over.join('\n'));
  console.error(`::error::the AppImage needs a glibc newer than ${ceiling}: build it on an older Ubuntu`);
  process.exit(1);
}
