// JSON written one record per line, for the files a scheduled workflow regenerates and commits.
//
// fingerprints.json, hero-index.json and the site's two catalog tables are produced by a bot
// and pushed to main several times a day. Nobody reads those files; the only thing anybody
// ever sees of them is the diff. Written by JSON.stringify(x, null, 0) they are a single line
// each, so "three mods were added" and "the whole catalog was rewritten" look identical in
// `git log -p`, in a pull request and in a review - a quarter of this repository's history is
// commits whose contents cannot be read at all.
//
// Breaking a record onto its own line fixes that, and costs nothing where cost is measured:
// fingerprints.json is the one of the four that travels to installed copies of the app, and
// gzipped it comes out the same size line-broken as it was on one line (46 KB either way).
// On disk it grows by 5%. The other three never leave the repository.
//
// Not JSON.stringify(x, null, 2): that breaks every leaf onto its own line and turns a
// 170 KB file into a megabyte of punctuation. The rule here is one line per record - a value
// that already fits on a line stays on it, and only the containers holding many of them open
// up.

/**
 * Renders `value` as JSON, keeping any value whose one-line form is at most `inlineAt`
 * characters on a single line and expanding the containers above it.
 *
 * Byte-for-byte equal to `JSON.stringify(value)` after a parse, whitespace aside: this is a
 * formatter, not a transform.
 *
 * @param {unknown} value      what to render
 * @param {object}  [opts]
 * @param {number}  [opts.inlineAt=200]  the longest one-line record left alone
 * @param {string}  [opts.indent='']     leading whitespace of the line this value starts on
 * @returns {string} JSON with no trailing newline
 */
function jsonLines(value, { inlineAt = 200, indent = '' } = {}) {
  const flat = JSON.stringify(value);

  // undefined, a function, a symbol: JSON.stringify drops these, and so must this. Returning
  // the undefined lets the callers below skip the key the same way stringify would.
  if (flat === undefined) return undefined;
  if (value === null || typeof value !== 'object' || flat.length <= inlineAt) return flat;

  const pad = `${indent}  `;
  const child = (v) => jsonLines(v, { inlineAt, indent: pad });

  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    // a hole or an undefined member is null in JSON, which is what stringify does with it
    const parts = value.map((v) => pad + (child(v) ?? 'null'));
    return `[\n${parts.join(',\n')}\n${indent}]`;
  }

  const parts = [];
  for (const key of Object.keys(value)) {
    const rendered = child(value[key]);
    if (rendered === undefined) continue; // same key stringify would have omitted
    parts.push(`${pad}${JSON.stringify(key)}: ${rendered}`);
  }
  if (!parts.length) return '{}';
  return `{\n${parts.join(',\n')}\n${indent}}`;
}

/** The same thing with the trailing newline a text file is supposed to end on. */
const jsonLinesFile = (value, opts) => `${jsonLines(value, opts)}\n`;

module.exports = { jsonLines, jsonLinesFile };
