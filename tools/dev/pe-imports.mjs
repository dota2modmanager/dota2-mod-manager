#!/usr/bin/env node
// The DLLs a Windows exe imports the plain way, the ones the loader resolves before main.
//   node tools/dev/pe-imports.mjs <exe> [--refuse comctl32.dll ...]
// With --refuse it exits 1 when one of those is a plain import. CI runs it on the shell's exe:
// comctl32 has to stay delay-loaded (src-tauri/build.rs), or a Windows without the version 6
// assembly refuses to start the app over TaskDialogIndirect.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function plainImports(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a PE file');
  const sections = buf.readUInt16LE(pe + 6);
  const optSize = buf.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt);
  const dirs = opt + (magic === 0x20b ? 112 : 96);
  const importRva = buf.readUInt32LE(dirs + 8);
  if (!importRva) return [];
  const table = opt + optSize;
  const toOffset = (rva) => {
    for (let i = 0; i < sections; i++) {
      const s = table + i * 40;
      const va = buf.readUInt32LE(s + 12);
      const size = Math.max(buf.readUInt32LE(s + 8), buf.readUInt32LE(s + 16));
      if (rva >= va && rva < va + size) return rva - va + buf.readUInt32LE(s + 20);
    }
    throw new Error(`rva ${rva.toString(16)} is in no section`);
  };
  const names = [];
  for (let d = toOffset(importRva); ; d += 20) {
    const nameRva = buf.readUInt32LE(d + 12);
    if (!nameRva) break;
    const at = toOffset(nameRva);
    names.push(buf.toString('latin1', at, buf.indexOf(0, at)));
  }
  return names;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [exe, ...rest] = process.argv.slice(2);
  const refuse = [];
  for (let i = 0; i < rest.length; i++) if (rest[i] === '--refuse') refuse.push(rest[++i].toLowerCase());
  const names = plainImports(readFileSync(exe));
  const bad = names.filter((n) => refuse.includes(n.toLowerCase()));
  console.log(names.join('\n'));
  if (bad.length) {
    console.error(`${exe} imports ${bad.join(', ')} before main; it has to be delay-loaded (src-tauri/build.rs)`);
    process.exit(1);
  }
}
