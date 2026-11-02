// A name that came from somebody else is text, never markup.
//
// L`...` fills its values in as they are, and a string built with it often goes straight into
// innerHTML. A preset's name travels between strangers in a d2mm:// link or a .d2mm file, stays
// the name once its mods are installed, and the share sheet put it into its title through L
// unescaped: a name like <a href="https://..." class="btn btn-primary">Copy</a> drew a working
// button there that opened its address in the browser. The content security policy stops a
// script, not a link. So every name, title, author, note or label that goes through L into an
// HTML template goes through esc() first.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return files(p);
    // .tsx is left out: React writes a string as text whatever is in it
    return /\.(ts|js)$/.test(d.name) && !d.name.endsWith('.d.ts') ? [p] : [];
  });
}

/** `${L`... ${value} ...`}` inside a bigger template: the shape that lands in HTML. */
const IN_HTML = /\$\{L`([^`]*)`\}/g;
const NAMED = /\$\{([^}]*?(?:name|title|author|note|label)[^}]*)\}/gi;

test('a name put into HTML through L is escaped first', () => {
  const bad = [];
  for (const f of files(path.join(ROOT, 'renderer'))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(IN_HTML)) {
      for (const v of m[1].matchAll(NAMED)) {
        if (!/^esc\(/.test(v[1].trim()) && !/\.length\b/.test(v[1])) {
          const line = text.slice(0, m.index).split('\n').length;
          bad.push(`${path.relative(ROOT, f)}:${line} \${${v[1]}}`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], 'wrap these in esc()');
});
