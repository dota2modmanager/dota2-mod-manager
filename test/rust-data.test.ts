// The tables in crates/mm-core/data/ are what the TypeScript modules export: one is changed in
// TypeScript and not written again for Rust (node tools/rust-data.mjs), and this fails. Line ends
// do not count: .gitattributes keeps the files LF, a working tree from before it may be CRLF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { tables } from '../tools/rust-data.mjs';

test('every table Rust reads is what its TypeScript module exports', async () => {
  const dir = path.resolve(import.meta.dirname, '..', 'crates', 'mm-core', 'data');
  for (const [file, text] of Object.entries(await tables())) {
    const at = path.join(dir, file);
    assert.ok(fs.existsSync(at), `${file} is missing: node tools/rust-data.mjs`);
    const has = fs.readFileSync(at, 'utf8').split('\r\n').join('\n');
    assert.equal(has, text, `${file} is out of date: node tools/rust-data.mjs`);
  }
});
