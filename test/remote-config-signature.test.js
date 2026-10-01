// The switches file and its signature, kept in agreement by the build.
//
// config/app.json can turn a feature off after a release and put a notice in front of everyone
// who opens the app. It is fetched through the same public proxies as everything else, so it is
// signed, and src/remote-config.js ignores a copy that does not verify.
//
// That makes an unsigned edit silent in the worst way: the file would go out, every client would
// quietly refuse it, and the switch nobody could see not working is the one you reached for in
// an emergency. Editing the file without re-signing has to fail here, loudly, before the commit
// is anywhere near a release.
//
// To re-sign after editing it:
//   CATALOG_KEY=<path to the private key> node tools/sign-catalog.js config/app.json
//
// The private key is not in this repository and must never be. It lives outside the working
// tree on the maintainer's machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { verify } = require('../src/catalog-signature.ts');
const { CONFIG_PUBLIC_KEY, CONFIG_URL, CONFIG_SIG_URL } = require('../src/remote-config.js');

const root = path.join(__dirname, '..');
const configFile = path.join(root, 'config', 'app.json');
const sigFile = `${configFile}.sig`;

test('the committed config is the one the pinned key signed', () => {
  assert.ok(fs.existsSync(sigFile), 'config/app.json.sig is missing entirely');
  const ok = verify(fs.readFileSync(configFile), fs.readFileSync(sigFile, 'utf-8'), CONFIG_PUBLIC_KEY);
  assert.ok(
    ok,
    'config/app.json does not match config/app.json.sig. Edited without re-signing?\n'
    + '  CATALOG_KEY=<private key> node tools/sign-catalog.js config/app.json',
  );
});

test('the file has no carriage returns, or the signature is over bytes nobody downloads', () => {
  // This is not tidiness. The file was signed on a Windows machine at 1014 bytes and served
  // from the repository at 999, because text=auto stores LF and checks out CRLF, and the
  // signature verified on that machine and nowhere else on earth. The test above cannot see
  // it: it signs and checks the same local bytes and is happy either way.
  //
  // .gitattributes pins this file to LF so the two can no longer differ. This is the alarm for
  // the day something rewrites it anyway.
  assert.ok(!fs.readFileSync(configFile).includes(0x0d), 'config/app.json has CRLF line endings');
});

test('a config with one byte added does not pass, or the check above proves nothing', () => {
  const tampered = Buffer.concat([fs.readFileSync(configFile), Buffer.from(' ')]);
  assert.equal(verify(tampered, fs.readFileSync(sigFile, 'utf-8'), CONFIG_PUBLIC_KEY), false);
});

test('the signature is fetched from beside the file, not from somewhere else', () => {
  // the two URLs have to be the same file with .sig on the end: a signature fetched from a
  // different path is a signature an attacker can leave in place while changing the data
  assert.equal(CONFIG_SIG_URL, `${CONFIG_URL}.sig`);
});

test('the private half is not in the repository', () => {
  // A key committed by accident is worse than no key: it looks like protection and is not.
  for (const dir of ['', 'config', 'tools', 'src']) {
    const here = path.join(root, dir);
    for (const name of fs.readdirSync(here)) {
      if (!name.endsWith('.pem')) continue;
      const text = fs.readFileSync(path.join(here, name), 'utf-8');
      assert.ok(!text.includes('PRIVATE KEY'), `${path.join(dir, name)} holds a private key`);
    }
  }
});
