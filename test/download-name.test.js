// Where a downloaded file is allowed to land.
//
// A catalog entry decides two things the app used to take literally: which URL a mod comes
// from, and - through the last segment of that URL - what the file is called on disk. The
// name was decoded before it was used, so "..%2F..%2F..%2FStartup%2Fx.zip" decoded into a
// path and the download followed it out of the app's own folder. The catalog is somebody
// else's repository, read through mirrors, so this is not a hypothetical author typo.
//
// Everything here is about containment: whatever the name says, the bytes land under
// userData/downloads and nowhere else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { Installer } = require('../src/installer.ts');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-dl-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A server that hands over the same bytes whatever is asked of it. */
function serve(t, body = 'the mod') {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  });
  server.listen(0, '127.0.0.1');
  t.after(() => server.close());
  return new Promise((resolve) => server.on('listening', () => resolve(server.address().port)));
}

function installer(t) {
  return new Installer({
    userDataDir: tmpDir(t),
    getGamePath: () => null,
    getLangSuffix: () => 'russian',
    onProgress: () => {},
  });
}

test('a file name that decodes into a path cannot walk out of the downloads folder', async (t) => {
  const port = await serve(t);
  const inst = installer(t);
  const escapes = [
    `http://127.0.0.1:${port}/x/..%2F..%2F..%2FStartup%2Fboot.zip`,
    `http://127.0.0.1:${port}/x/..%5C..%5Cboot.zip`,
    `http://127.0.0.1:${port}/x/%2E%2E%2F%2E%2E%2Fboot.zip`,
  ];
  for (const url of escapes) {
    const dest = await inst.download('heroes', url, 'Mod');
    assert.ok(
      path.resolve(dest).startsWith(path.resolve(inst.downloadsDir) + path.sep),
      `${url} stayed inside downloads (landed at ${dest})`,
    );
    assert.ok(!path.basename(dest).includes('..'), 'and is not named ".." either');
    assert.equal(fs.readFileSync(dest, 'utf-8'), 'the mod');
  }
});

test('a category from the catalog is a folder name, not a route out of it', async (t) => {
  const port = await serve(t);
  const inst = installer(t);
  const dest = await inst.download('../../..', `http://127.0.0.1:${port}/mod.zip`, 'Mod');
  assert.ok(path.resolve(dest).startsWith(path.resolve(inst.downloadsDir) + path.sep));
});

// The names in the real catalog have spaces, brackets and Cyrillic in them, and they are
// also the keys of the download cache. Scrubbing them would re-download every mod on disk.
test('an ordinary catalog name is kept exactly as it is', async (t) => {
  const port = await serve(t);
  const inst = installer(t);
  const dest = await inst.download('heroes', `http://127.0.0.1:${port}/Red%20Abaddon%20(v2).zip`, 'Mod');
  assert.equal(path.basename(dest), 'Red Abaddon (v2).zip');

  const cyrillic = await inst.download('heroes', `http://127.0.0.1:${port}/${encodeURIComponent('Пудж.zip')}`, 'Mod');
  assert.equal(path.basename(cyrillic), 'Пудж.zip');
});

test('a file the cache already holds is served from disk, name and all', async (t) => {
  const port = await serve(t);
  const inst = installer(t);
  const first = await inst.download('heroes', `http://127.0.0.1:${port}/Mod.zip`, 'Mod');
  const again = await inst.download('heroes', `http://127.0.0.1:${port}/Mod.zip`, 'Mod');
  assert.equal(first, again);
});
