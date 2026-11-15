// One function of the Rust core, run through `mm-cli call` by the name
// crates/mm-core/src/owner/calls.rs answers to (module.function).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CLI } from './mm-cli.ts';

/** What Rust answers; throws what it answers as an error. */
export function rust(name: string, ...args: unknown[]): unknown {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-rust-'));
  try {
    const file = path.join(dir, 'call.json');
    fs.writeFileSync(file, JSON.stringify([[name, ...args]]));
    const [a] = JSON.parse(execFileSync(CLI, ['call', file], { encoding: 'utf8', maxBuffer: 1 << 30 }));
    if ('error' in a) throw new Error(a.error);
    return a.ok;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
