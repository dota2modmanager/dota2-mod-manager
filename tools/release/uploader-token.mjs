#!/usr/bin/env node
/**
 * Gives a release build the catalog uploader's token (crates/mm-core/src/tools/creator_upload.rs),
 * so sending a mod works without asking its author to create a file first.
 *
 * The token is not a secret in the strong sense, since anybody can unpack a release and find the
 * key that decrypts it, but it must not sit in a public repository where every scraper reads it.
 * So it lives in the repository secret UPLOADER_APP_TOKEN, and release.yml runs this just before
 * the Tauri build: it writes build/stats/uploader-token.bin, which .gitignore keeps out of git
 * and tauri.conf.json bundles as app/build/stats. The name says nothing about the token, so it
 * does not stand out in an unpacked app. The bytes are AES-256-GCM encrypted with the key
 * creator_upload.rs derives, so the token is not readable with `strings`.
 *
 * Without the secret (a fork, a local build) the file is removed and the build carries no token:
 * sending from that build is unavailable. That is a warning, not a failure. The token itself is
 * never printed.
 *
 * The key and the file format here must match creator_upload.rs; a Rust test and
 * test/uploader-token.test.ts run this tool and read what it wrote, so a change to one without
 * the other fails.
 *
 *   UPLOADER_APP_TOKEN=... node tools/release/uploader-token.mjs
 *   ... node tools/release/uploader-token.mjs --out /tmp/uploader-token.bin
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultOut = path.join(here, '../..', 'build', 'stats', 'uploader-token.bin');
const outAt = process.argv.indexOf('--out');
const out = outAt >= 0 && process.argv[outAt + 1] ? path.resolve(process.argv[outAt + 1]) : defaultOut;
const token = String(process.env.UPLOADER_APP_TOKEN || '').trim();

// must match crates/mm-core/src/tools/creator_upload.rs
const MAGIC = Buffer.from('D2MMUP01');
const IV_BYTES = 12;
const KEY = crypto.createHash('sha256').update(['d2pfx-uploader-token', 'v1', 'dota2-mod-manager'].join('\0')).digest();

if (!token) {
  fs.rmSync(out, { force: true });
  console.log('::warning::UPLOADER_APP_TOKEN is not set: this build will not carry an upload token');
} else if (!/^[\x21-\x7e]{16,512}$/.test(token)) {
  console.log('::error::UPLOADER_APP_TOKEN does not look like a token (printable, 16 to 512 characters)');
  process.exit(1);
} else {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.concat([MAGIC, iv, cipher.getAuthTag(), data]));
  console.log(`uploader token written (${token.length} characters, encrypted)`);
}
