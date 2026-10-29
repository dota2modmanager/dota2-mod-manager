#!/usr/bin/env node
/**
 * Gives a release build the catalog download counter's token (src/download-stats.ts).
 *
 * The token lets the app add to the counter the catalog's author runs. It is not a secret in the
 * strong sense, since anybody can unpack it from an installed app, but it must not sit in a public
 * repository where every scraper reads it. So it lives in the repository secret STATS_APP_TOKEN, and
 * release.yml runs this just before electron-builder: it writes src/download-stats.token, which
 * .gitignore keeps out of git and electron-builder packs with the rest of src/.
 *
 * Without the secret (a fork, a local build) the file is not written and the build counts nothing.
 * That is a warning, not a failure: a build that cannot count is a working build. The token itself
 * is never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'download-stats.token');
const token = String(process.env.STATS_APP_TOKEN || '').trim();

if (!token) {
  console.log('::warning::STATS_APP_TOKEN is not set: this build will not count downloads');
} else if (!/^[\x21-\x7e]{16,512}$/.test(token)) {
  console.log('::error::STATS_APP_TOKEN does not look like a token (printable, 16 to 512 characters)');
  process.exit(1);
} else {
  fs.writeFileSync(out, token);
  console.log(`download counter token written (${token.length} characters)`);
}
