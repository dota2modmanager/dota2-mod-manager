// The feeds a Tauri release carries (tools/tauri-release.mjs). latest.yml is what every installed
// Electron copy reads to find its way over to the Tauri build; latest.json is what a Tauri copy
// reads afterwards. A wrong field in either is an app that silently stops updating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { electronFeed, tauriFeed, releaseUrl, SETUP, APPIMAGE } from '../tools/tauri-release.mjs';

test('latest.yml names the Tauri installer the way electron-builder names its own', () => {
  const bytes = Buffer.from('an installer');
  const text = electronFeed({ file: SETUP, bytes, version: '3.9.0', date: '2026-11-14T10:00:00.000Z' });
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  assert.equal(text, [
    'version: 3.9.0',
    'files:',
    `  - url: ${SETUP}`,
    `    sha512: ${sha512}`,
    `    size: ${bytes.length}`,
    `path: ${SETUP}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-11-14T10:00:00.000Z'",
    '',
  ].join('\n'));
});

test('latest.json carries each signed platform, pointing at its file on the release', () => {
  const feed = JSON.parse(tauriFeed({
    version: '3.9.0',
    notes: 'What changed',
    date: '2026-11-14T10:00:00.000Z',
    signatures: { [SETUP]: 'sig-windows\n', [APPIMAGE]: 'sig-linux' },
    url: (file) => releaseUrl('3.9.0', file),
  }));
  assert.deepEqual(feed, {
    version: '3.9.0',
    notes: 'What changed',
    pub_date: '2026-11-14T10:00:00.000Z',
    platforms: {
      'windows-x86_64': { signature: 'sig-windows', url: `https://github.com/dota2modmanager/dota2-mod-manager/releases/download/v3.9.0/${SETUP}` },
      'linux-x86_64': { signature: 'sig-linux', url: `https://github.com/dota2modmanager/dota2-mod-manager/releases/download/v3.9.0/${APPIMAGE}` },
    },
  });
});

test('a feed with no signature at all is refused rather than published', () => {
  assert.throws(() => tauriFeed({ version: '3.9.0', signatures: {}, url: (f) => f }), /TAURI_SIGNING_PRIVATE_KEY/);
});

// A minisign key and signature in the shape `tauri signer` writes them: base64 of the text, whose
// second line is base64 again ("Ed" + key id + key; "ED" + key id + signature of BLAKE2b-512).
function minisign(file: Buffer, keyId = Buffer.from('0123456789abcdef', 'hex')) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  const pubkey = Buffer.from(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64')}\n`).toString('base64');
  const sig = crypto.sign(null, crypto.createHash('blake2b512').update(file).digest(), privateKey);
  const trusted = 'timestamp:1\tfile:x';
  const global = crypto.sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
  const text = `untrusted comment: signature\n${Buffer.concat([Buffer.from('ED'), keyId, sig]).toString('base64')}\ntrusted comment: ${trusted}\n${global.toString('base64')}\n`;
  return { pubkey, sig: Buffer.from(text).toString('base64') };
}

test('a build signed with the key tauri.conf.json names passes, and any other is stopped', async () => {
  const { checkSignature } = await import('../tools/tauri-release.mjs');
  const file = Buffer.from('an installer');
  const { pubkey, sig } = minisign(file);
  assert.equal(checkSignature(pubkey, sig, file), null);
  assert.match(checkSignature(pubkey, sig, Buffer.from('another installer')), /does not match the file/);
  // a key generated again by mistake: what every installed copy would refuse
  const other = minisign(file, Buffer.from('fedcba9876543210', 'hex'));
  assert.match(checkSignature(pubkey, other.sig, file), /another key/);
  // the same key id but another key behind it
  assert.match(checkSignature(pubkey, minisign(file).sig, file), /does not match the file/);
});

test('the release refuses a public key that is not minisign Ed25519', async () => {
  const { checkSignature } = await import('../tools/tauri-release.mjs');
  assert.match(checkSignature(Buffer.from('nonsense\nAAAA\n').toString('base64'), '', Buffer.alloc(0)), /not a minisign/);
});
