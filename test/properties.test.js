/* The promises that have to hold for every input, not for the inputs somebody thought of.
 *
 * The parsers already get seeded noise thrown at them (test/safe-zip-fuzz.test.js,
 * test/vpk-fuzz.test.ts, tools/fuzz-parsers.mjs). Those generators are ours, and they only
 * produce what we imagined; when one does find something, it hands over the 4 KB of rubbish that
 * broke it rather than the two bytes that mattered.
 *
 * fast-check generates the inputs and then shrinks a failure to the smallest one that still
 * fails, which is the difference between "an archive broke it" and "a name of one dot breaks it".
 * It is a development dependency: nothing here ships.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fc = require('fast-check');

const { safeJoin } = require('../src/safe-zip.ts');
const { encodePresetLink, decodePresetLink } = require('../src/preset-link.ts');

const RUNS = { numRuns: 500 };
const ROOT = path.resolve('C:/game/dota_russian');

test('a name out of an archive either lands inside the folder or is refused', () => {
  /* The property the whole zip door rests on. Not "these names are refused": any name at all,
     including the ones nobody would think to write down. */
  fc.assert(fc.property(fc.string({ maxLength: 120 }), (name) => {
    let dest;
    try {
      dest = safeJoin(ROOT, name);
    } catch (err) {
      return typeof err.message === 'string' && err.message.length > 0;
    }
    return dest === ROOT || dest.startsWith(ROOT + path.sep);
  }), RUNS);
});

test('a path built out of several pieces cannot climb out either', () => {
  // the real shape: a zip entry is segments joined by slashes, and any one of them can be ".."
  const segment = fc.oneof(
    fc.constantFrom('..', '.', '', 'heroes', 'pak01_dir.vpk', '...', ' ', 'CON'),
    fc.string({ maxLength: 12 }),
  );
  fc.assert(fc.property(fc.array(segment, { maxLength: 8 }), (parts) => {
    const rel = parts.join('/');
    try {
      const dest = safeJoin(ROOT, rel);
      return dest === ROOT || dest.startsWith(ROOT + path.sep);
    } catch {
      return true;
    }
  }), RUNS);
});

test('a preset link survives the trip there and back', () => {
  const mod = fc.record({
    kind: fc.constant('catalog'),
    categoryId: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
    name: fc.string({ minLength: 1, maxLength: 60, size: 'max' }).filter((s) => s.trim().length > 0),
  });
  // size: 'max' or the generator keeps to a dozen characters and never tests the length limits
  const title = fc.string({ minLength: 1, maxLength: 90, size: 'max' });
  fc.assert(fc.property(fc.array(mod, { minLength: 1, maxLength: 12 }), title, (mods, name) => {
    const { code } = encodePresetLink({ name, author: null, mods });
    const back = decodePresetLink(code);
    assert.equal(back.name, name, 'the name somebody typed is the name that comes back');
    assert.equal(back.mods.length, mods.length);
    back.mods.forEach((m, i) => {
      assert.equal(m.categoryId, mods[i].categoryId);
      assert.equal(m.name, mods[i].name);
    });
    return true;
  }), { numRuns: 200 });
});

test('a link somebody typed wrong is refused in this project own words', () => {
  /* Anything at all arrives here: a truncated code, somebody else's URL, a paste with a newline
     in it. What must never happen is a stack trace out of zlib or JSON reaching the user. */
  fc.assert(fc.property(fc.string({ maxLength: 200 }), (input) => {
    try {
      const out = decodePresetLink(input);
      return typeof out.name === 'string' && Array.isArray(out.mods);
    } catch (err) {
      return err instanceof Error
        && typeof err.message === 'string'
        && err.message.length > 0
        && !/SyntaxError|RangeError|ERR_/.test(err.message);
    }
  }), RUNS);
});
