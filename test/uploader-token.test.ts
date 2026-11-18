/* The encrypted token a release build carries (tools/release/uploader-token.mjs): it must
 * decrypt to itself with the key crates/mm-core/src/tools/creator_upload.rs derives, hold no
 * readable copy, and be removed when the build has no secret. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const tool = path.join(root, 'tools', 'release', 'uploader-token.mjs');
const TOKEN = 'd2pfx_test_0123456789abcdef';
const MAGIC = Buffer.from('D2MMUP01');
const KEY = crypto.createHash('sha256').update(['d2pfx-uploader-token', 'v1', 'dota2-mod-manager'].join('\0')).digest();

function run(out, token) {
  return execFileSync(process.execPath, [tool, '--out', out], {
    cwd: root,
    env: { ...process.env, UPLOADER_APP_TOKEN: token },
    stdio: 'pipe',
  });
}

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-upload-token-')), 'uploader-token.bin');
}

test('an embedded token decrypts back, and its file holds no readable copy', () => {
  const out = tempFile();
  run(out, TOKEN);
  const raw = fs.readFileSync(out);
  assert.ok(raw.subarray(0, MAGIC.length).equals(MAGIC));
  assert.ok(!raw.toString('utf8').includes(TOKEN), 'the token is not readable with strings');
  const iv = raw.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = raw.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const data = raw.subarray(MAGIC.length + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  assert.equal(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'), TOKEN);
});

test('the fixture the Rust side reads is one this tool wrote, under the same key', () => {
  // crates/mm-core/src/tools/creator_upload.rs decodes this file too, so the two keys cannot drift
  const raw = fs.readFileSync(path.join(root, 'test', 'fixtures', 'uploader-token.bin'));
  assert.ok(raw.subarray(0, MAGIC.length).equals(MAGIC));
  const iv = raw.subarray(MAGIC.length, MAGIC.length + 12);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(raw.subarray(MAGIC.length + 12, MAGIC.length + 28));
  assert.equal(Buffer.concat([decipher.update(raw.subarray(MAGIC.length + 28)), decipher.final()]).toString('utf8'), TOKEN);
});

test('a changed byte is refused, not read as garbage', () => {
  const out = tempFile();
  run(out, TOKEN);
  const raw = fs.readFileSync(out);
  raw[raw.length - 1] ^= 1;
  const iv = raw.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = raw.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const data = raw.subarray(MAGIC.length + 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  assert.throws(() => Buffer.concat([decipher.update(data), decipher.final()]));
});

test('a build without the secret writes nothing to carry forward', () => {
  const out = tempFile();
  fs.writeFileSync(out, 'stale');
  run(out, '');
  assert.equal(fs.existsSync(out), false);
});

test('a secret that does not look like a token fails the build', () => {
  assert.throws(() => run(tempFile(), 'short'));
});
