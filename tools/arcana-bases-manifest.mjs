/* Writes manifest.json and manifest.json.sig into a checkout of the bases' repository
   (src/arcana-base-store.ts): each base under src/<id>/ with git's hash of each of its files, the
   VPK of them left out, and the signature of exactly those bytes.

   The app takes no other list of the bases, and takes this one only with a good signature against
   BASES_PUBLIC_KEY: so it is written from the files and not by hand, and signed in the same step,
   so the two cannot go up in different commits. Run it before each push, and commit both.

   The key is the private half of the pair whose public half is BASES_PUBLIC_KEY. It never goes
   into either repository. `tools/sign-catalog.js --keygen` makes a pair.

   Usage: node tools/arcana-bases-manifest.mjs <checkout of hero-base-fixes> <key.pem> */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { blobSha, signedListing } from '../src/arcana-base-store.ts';

const [root, keyFile] = process.argv.slice(2);
if (!root || !fs.existsSync(path.join(root, 'src')) || !keyFile || !fs.existsSync(keyFile)) {
  console.error('usage: node tools/arcana-bases-manifest.mjs <checkout with a src/ folder of bases> <private key .pem>');
  process.exit(1);
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

const bases = {};
for (const id of fs.readdirSync(path.join(root, 'src')).sort()) {
  const dir = path.join(root, 'src', id);
  if (!fs.statSync(dir).isDirectory()) continue;
  const files = {};
  for (const rel of walk(dir).sort()) {
    if (!rel.includes('/') && rel.toLowerCase().endsWith('.vpk')) continue;
    files[rel] = blobSha(fs.readFileSync(path.join(dir, rel)));
  }
  bases[id] = files;
  console.log(`${id}: ${Object.keys(files).length} files`);
}

const manifest = `${JSON.stringify({ bases }, null, 1)}\n`;
const sig = crypto.sign(null, Buffer.from(manifest), crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8'))).toString('base64');
// checked as the app will check it: a key that is not the pinned one's pair is caught here, not by
// every user's app refusing the push
const listing = signedListing(manifest, sig);
if (!listing) {
  console.error(`\n${keyFile} is not the key the app checks against (BASES_PUBLIC_KEY). Nothing written.`);
  process.exit(1);
}
const dropped = Object.keys(bases).filter((id) => Object.keys(bases[id]).length !== Object.keys(listing[id] || {}).length);
if (dropped.length) console.warn(`\nthe app will leave files of these out (only models/, materials/, particles/): ${dropped.join(', ')}`);
fs.writeFileSync(path.join(root, 'manifest.json'), manifest);
fs.writeFileSync(path.join(root, 'manifest.json.sig'), `${sig}\n`);
console.log(`\nwrote and signed ${path.join(root, 'manifest.json')}`);
