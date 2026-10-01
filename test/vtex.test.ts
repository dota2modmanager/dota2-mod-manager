// The picture inside a compiled Source 2 texture. Panorama images are compiled with the
// format left as PNG, so almost every item icon comes out of the game whole - but only when
// the bytes really are a whole PNG, which is what these check. Guessing wrong here would put
// a corrupt file in the icon cache and keep serving it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { pngFromVtex } from '../src/vtex.ts';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG with nothing in it but the two chunks a reader looks at. */
function png(width = 4, height = 3) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([SIGNATURE, ihdr, iend]);
}

/** A resource whose first field is the size of the header part, with `tail` appended. */
function vtex(headerBytes: number, tail: Buffer): Buffer {
  const head = Buffer.alloc(headerBytes);
  head.writeUInt32LE(headerBytes, 0);
  return Buffer.concat([head, tail]);
}

test('a texture that carries a PNG gives back exactly that PNG', () => {
  const file = png();
  const got = pngFromVtex(vtex(64, file));
  assert.ok(got, 'expected the picture to be found');
  assert.ok(got, 'a PNG after the header is found');
  assert.equal(Buffer.compare(got as Buffer, file), 0);
});

test('the header size is trusted over a stray signature earlier in the file', () => {
  // a resource whose header happens to contain the eight signature bytes
  const head = Buffer.alloc(64);
  head.writeUInt32LE(64, 0);
  SIGNATURE.copy(head, 20);
  const file = png(8, 8);
  const got = pngFromVtex(Buffer.concat([head, file]));
  assert.ok(got, 'the PNG after the real header is found');
  assert.equal(Buffer.compare(got as Buffer, file), 0);
});

test('a block-compressed texture is refused rather than guessed at', () => {
  const pixels = Buffer.alloc(512, 0x7f); // DXT blocks, no signature anywhere
  assert.equal(pngFromVtex(vtex(64, pixels)), null);
});

test('a picture that stops before IEND is not a picture', () => {
  const cut = png().subarray(0, 20);
  assert.equal(pngFromVtex(vtex(64, cut)), null);
});

test('trailing bytes after IEND mean this is not a plain PNG either', () => {
  const file = Buffer.concat([png(), Buffer.alloc(16, 1)]);
  assert.equal(pngFromVtex(vtex(64, file)), null);
});

test('nothing usable comes back for junk, an empty buffer, or no buffer at all', () => {
  assert.equal(pngFromVtex(null), null);
  assert.equal(pngFromVtex(Buffer.alloc(0)), null);
  assert.equal(pngFromVtex(Buffer.alloc(8, 0)), null);
  // a header size that points past the end of the file
  assert.equal(pngFromVtex(vtex(64, png()).subarray(0, 40)), null);
});
