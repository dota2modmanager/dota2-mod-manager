#!/usr/bin/env node
/*
 * The Tauri build's files, under the names a release has always carried, and the feeds both
 * updaters read.
 *
 * A release keeps its old file names (Dota-2-Mod-Manager-Setup.exe, -Portable.exe, .AppImage), so
 * the site's download links, the mirror and tools/release-state.js stay as they are. Two kinds of
 * installed copy read a release:
 *
 *   - the Electron builds people have now, through electron-updater: latest.yml and
 *     latest-linux.yml name the Tauri installer and AppImage with their sha512, and the installer's
 *     hooks take the Electron install over (src-tauri/windows/hooks.nsh);
 *   - the Tauri builds, through tauri-plugin-updater: latest.json (and beta.json for the testers)
 *     carries each platform's minisign signature, made with TAURI_SIGNING_PRIVATE_KEY at build time.
 *
 * Usage:
 *   node tools/tauri-release.mjs windows <dist> <version>   Setup.exe and its .sig, Portable.exe, latest.yml, portable.yml
 *   node tools/tauri-release.mjs linux <dist> <version>     the AppImage and its .sig, latest-linux.yml
 *   node tools/tauri-release.mjs feeds <dir> <version> [notes.md]
 *                                                           latest.json and beta.json from the .sig files in <dir>
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const portableManifest = require('./portable-manifest.js');

export const REPO = 'dota2modmanager/dota2-mod-manager';
export const SETUP = 'Dota-2-Mod-Manager-Setup.exe';
export const PORTABLE = portableManifest.FILE;
export const APPIMAGE = 'Dota-2-Mod-Manager.AppImage';
/** tauri-plugin-updater's names for the two platforms a release carries */
const PLATFORMS = { [SETUP]: 'windows-x86_64', [APPIMAGE]: 'linux-x86_64' };

const root = path.resolve(import.meta.dirname, '..');

/** The download address of a file attached to release `version` (no leading v). */
export const releaseUrl = (version, file) => `https://github.com/${REPO}/releases/download/v${version}/${file}`;

/**
 * electron-updater's feed for one file: the shape electron-builder writes, without a blockmap, so
 * the update is a whole download rather than a differential one.
 * @param {{file: string, bytes: Buffer, version: string, date?: string}} o
 */
export function electronFeed({ file, bytes, version, date = new Date().toISOString() }) {
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    `    size: ${bytes.length}`,
    `path: ${file}`,
    `sha512: ${sha512}`,
    `releaseDate: '${date}'`,
    '',
  ].join('\n');
}

/**
 * tauri-plugin-updater's feed: every platform whose signature is here, pointing at its file.
 * @param {{version: string, notes?: string, date?: string, signatures: Record<string, string>, url: (file: string) => string}} o
 *   signatures by release file name (the .sig file's text)
 */
export function tauriFeed({ version, notes = '', date = new Date().toISOString(), signatures, url }) {
  const platforms = {};
  for (const [file, platform] of Object.entries(PLATFORMS)) {
    const signature = signatures[file];
    if (signature) platforms[platform] = { signature: signature.trim(), url: url(file) };
  }
  if (!Object.keys(platforms).length) throw new Error('no signature for any platform: was TAURI_SIGNING_PRIVATE_KEY set for the build?');
  return `${JSON.stringify({ version, notes, pub_date: date, platforms }, null, 2)}\n`;
}

/** A minisign key or signature as Tauri stores it: base64 of the text, whose second line is base64 again. */
const minisignLine = (b64, n) => Buffer.from(Buffer.from(String(b64).trim(), 'base64').toString('utf8').split('\n')[n] || '', 'base64');

/**
 * Whether `sig` (a .sig file as `tauri build` writes it) is a signature of `bytes` by the key whose
 * public half is `pubkey` (tauri.conf.json plugins.updater.pubkey). The plugin on every installed
 * copy makes this same check, so a build signed with any other key would be refused by all of
 * them: the release stops here instead.
 * @returns {string|null} what is wrong, or null
 */
export function checkSignature(pubkey, sig, bytes) {
  const pk = minisignLine(pubkey, 1);
  if (pk.length !== 42 || pk.subarray(0, 2).toString() !== 'Ed') return 'the public key is not a minisign Ed25519 key';
  const text = Buffer.from(String(sig).trim(), 'base64').toString('utf8').split('\n');
  const s = Buffer.from(text[1] || '', 'base64');
  if (s.length !== 74) return 'the signature is not a minisign signature';
  const alg = s.subarray(0, 2).toString();
  if (!s.subarray(2, 10).equals(pk.subarray(2, 10))) return 'the signature was made with another key than the one in tauri.conf.json';
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pk.subarray(10)]), format: 'der', type: 'spki' });
  // "ED" signs the BLAKE2b-512 of the file, "Ed" the file itself
  const message = alg === 'ED' ? crypto.createHash('blake2b512').update(bytes).digest() : bytes;
  if (!crypto.verify(null, message, key, s.subarray(10))) return 'the signature does not match the file';
  const trusted = (text[2] || '').replace(/^trusted comment: /, '');
  const global = Buffer.from(text[3] || '', 'base64');
  if (!crypto.verify(null, Buffer.concat([s.subarray(10), Buffer.from(trusted)]), key, global)) return "the signature's trusted comment does not match it";
  return null;
}

/** Stops the release when the file's signature would be refused by the installed copies. */
function verified(file, sigFile) {
  const { pubkey } = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')).plugins.updater;
  const wrong = checkSignature(pubkey, fs.readFileSync(sigFile, 'utf8'), fs.readFileSync(file));
  if (wrong) throw new Error(`${path.basename(file)}: ${wrong}`);
  console.log(`${path.basename(file)}: signed with the key tauri.conf.json names`);
}

/** The one file under `dir` whose name ends with `suffix`. */
function only(dir, suffix) {
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(suffix)) : [];
  if (found.length !== 1) throw new Error(`expected one *${suffix} in ${dir}, found ${found.length}`);
  return path.join(dir, found[0]);
}

function copy(from, to) {
  fs.copyFileSync(from, to);
  console.log(`${path.relative(root, to)}  ${(fs.statSync(to).size / 1024 ** 2).toFixed(1)} MB`);
}

function windows(dist, version) {
  const bundle = path.join(root, 'target', 'release', 'bundle', 'nsis');
  const setup = only(bundle, '-setup.exe');
  copy(setup, path.join(dist, SETUP));
  copy(`${setup}.sig`, path.join(dist, `${SETUP}.sig`));
  verified(path.join(dist, SETUP), path.join(dist, `${SETUP}.sig`));
  // the same exe the installer carries, bare: src-tauri/src/main.rs runs it as the portable build
  copy(path.join(root, 'target', 'release', 'Dota 2 Mod Manager.exe'), path.join(dist, PORTABLE));
  fs.writeFileSync(path.join(dist, 'latest.yml'), electronFeed({ file: SETUP, bytes: fs.readFileSync(path.join(dist, SETUP)), version }));
  portableManifest.build(dist, version);
}

function linux(dist, version) {
  const bundle = path.join(root, 'target', 'release', 'bundle', 'appimage');
  const image = only(bundle, '.AppImage');
  copy(image, path.join(dist, APPIMAGE));
  copy(`${image}.sig`, path.join(dist, `${APPIMAGE}.sig`));
  verified(path.join(dist, APPIMAGE), path.join(dist, `${APPIMAGE}.sig`));
  fs.writeFileSync(path.join(dist, 'latest-linux.yml'), electronFeed({ file: APPIMAGE, bytes: fs.readFileSync(path.join(dist, APPIMAGE)), version }));
}

function feeds(dir, version, notesFile) {
  const signatures = {};
  for (const file of Object.keys(PLATFORMS)) {
    const sig = path.join(dir, `${file}.sig`);
    if (fs.existsSync(sig)) signatures[file] = fs.readFileSync(sig, 'utf8');
  }
  const notes = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : '';
  const text = tauriFeed({ version, notes, signatures, url: (file) => releaseUrl(version, file) });
  // a tester reads beta.json: for a beta it is the beta, for a release it moves them onto it
  for (const name of ['latest.json', 'beta.json']) fs.writeFileSync(path.join(dir, name), text);
  console.log(text);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, dir, raw, notes] = process.argv.slice(2);
  const version = String(raw || '').replace(/^v/, '');
  const run = { windows, linux, feeds }[cmd];
  if (!run || !dir || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error('usage: node tools/tauri-release.mjs windows|linux|feeds <dir> <version> [notes.md]');
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  run(dir, version, notes);
}
