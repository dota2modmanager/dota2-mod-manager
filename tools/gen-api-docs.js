#!/usr/bin/env node
/*
 * The reference for src/, written by reading src/.
 *
 * Documentation that somebody types is documentation that goes stale, and this project has
 * been bitten by that more than once: a comment claiming six megabytes of preview images when
 * there were forty-five, a page naming Windows as the only platform for weeks after the Linux
 * build started shipping. So this is generated, and test/api-docs.test.js fails if the
 * committed file and the source disagree. Nobody has to remember to run it; CI remembers.
 *
 * What it takes from each module: the header comment (the "why" at the top of the file), and
 * every name it exports (module.exports in JavaScript, export in TypeScript) with its own comment
 * and signature. What it deliberately does
 * not do is describe behaviour in its own words - if an export has no comment, that is what
 * the reference says, and the fix is a comment in the source rather than a paragraph here.
 *
 *   node tools/gen-api-docs.js           write docs/API.md
 *   node tools/gen-api-docs.js --check   exit 1 if the file is out of date
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'docs', 'API.md');

/** Files whose exports are an implementation detail of the app's own wiring. */
const SKIP = (name) => {
  const base = name.replace(/\.[jt]s$/, '');
  return base.startsWith('ipc-') || base === 'settings-view' || base === 'uninstall-window';
};

/** A module the reference covers: JavaScript, or TypeScript that is not only declarations. */
const isModule = (f) => /\.(js|ts)$/.test(f) && !f.endsWith('.d.ts');

/** The comment block immediately above a line, as plain prose. */
function commentAbove(lines, at) {
  let end = at - 1;
  while (end >= 0 && lines[end].trim() === '') end--;
  if (end < 0) return '';
  const isEnd = /\*\/\s*$/.test(lines[end]);
  const isLine = /^\s*\/\//.test(lines[end]);
  if (!isEnd && !isLine) return '';

  let start = end;
  if (isEnd) {
    while (start >= 0 && !/^\s*\/\*/.test(lines[start])) start--;
  } else {
    while (start > 0 && /^\s*\/\//.test(lines[start - 1])) start--;
  }
  if (start < 0) return '';

  return lines.slice(start, end + 1)
    .map((l) => l.replace(/^\s*\/\*+<?/, '').replace(/\*\/\s*$/, '').replace(/^\s*\*\s?/, '').replace(/^\s*\/\/\s?/, ''))
    .join('\n')
    .trim();
}

/* Prose and tags, split at the first @tag rather than line by line.
 *
 * A @returns describing an object runs over several lines and only its first one starts with
 * an @, so filtering per line dropped the continuation into the prose, where it read as a
 * sentence fragment. Everything from the first tag onwards is tags.
 */
function splitDoc(doc) {
  const lines = doc.split('\n');
  const at = lines.findIndex((l) => /^\s*@\w/.test(l));
  if (at === -1) return { prose: doc.trim(), tags: [] };
  return { prose: lines.slice(0, at).join('\n').trim(), tags: lines.slice(at).map((l) => l.trim()) };
}

/** Everything a module says it exports: in the order module.exports lists them, or, for a module
 *  written with export, in the order they appear. A TypeScript module's exported types are listed
 *  with the rest: the shape of what it hands over is as much its interface as its functions. */
function exportsOf(text) {
  const named = [...text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  for (const list of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of list[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) named.push(name);
    }
  }
  if (named.length) return named;
  const m = text.match(/module\.exports\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.replace(/\/\/.*$/gm, '').trim())
    .map((s) => (s.includes(':') ? s.split(':')[0].trim() : s))
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
}

/** Where a name is defined in this file, and how it is written there. */
function defineOf(lines, name) {
  const patterns = [
    new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[(<]`),
    new RegExp(`^(?:export\\s+)?class\\s+${name}\\b`),
    new RegExp(`^(?:export\\s+)?const\\s+${name}\\s*[=:]`),
    new RegExp(`^(?:export\\s+)?let\\s+${name}\\s*[=:]`),
    new RegExp(`^(?:export\\s+)?(?:interface|type)\\s+${name}\\b`),
  ];
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((re) => re.test(lines[i]))) return i;
  }
  return -1;
}

/** One line of signature, with a trailing `{` or `=> …` trimmed off. */
function signature(lines, at) {
  let sig = lines[at].trim();
  // a signature broken over several lines is joined until its bracket closes
  let depth = (sig.match(/\(/g) || []).length - (sig.match(/\)/g) || []).length;
  for (let i = at + 1; depth > 0 && i < lines.length && i < at + 8; i++) {
    sig += ` ${lines[i].trim()}`;
    depth += (lines[i].match(/\(/g) || []).length - (lines[i].match(/\)/g) || []).length;
  }
  return sig.replace(/\s*\{\s*$/, '').replace(/\s*=>\s*\{?\s*$/, '').replace(/;\s*$/, '').trim();
}

/** One module's part of the reference: its header and its exports. `source` is read from src/
 *  unless a test hands one in. */
function moduleDoc(file, source = fs.readFileSync(path.join(SRC, file), 'utf8')) {
  // Windows checks this repository out with CRLF and CI reads it with LF. Without normalising,
  // the same source generates two different files and the check below fails on whichever
  // machine did not write the committed one.
  const text = source.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  // The comment the file opens with, when it opens with one: that is where a module says what it is
  // for. Found by where it starts rather than by what follows it, since what follows can be a
  // require, an import, 'use strict' or the first export with a comment of its own.
  const first = lines.findIndex((l) => l.trim() !== '');
  const opens = first >= 0 && /^\s*(\/\*|\/\/)/.test(lines[first]);
  const firstCode = lines.findIndex((l) => /^(const|let|class|function|'use strict'|import|export|module\.exports|async)/.test(l));
  const leadEnd = opens ? (/^\s*\/\*/.test(lines[first])
    ? lines.findIndex((l, i) => i >= first && /\*\/\s*$/.test(l))
    : lines.findIndex((l, i) => i > first && !/^\s*\/\//.test(l)) - 1) : -1;
  const header = opens && leadEnd >= first ? commentAbove(lines, leadEnd + 1) : commentAbove(lines, firstCode);

  const names = exportsOf(text);
  const items = [];
  for (const name of names) {
    const at = defineOf(lines, name);
    if (at === -1) { items.push({ name, sig: null, doc: '' }); continue; }
    items.push({ name, sig: signature(lines, at), doc: commentAbove(lines, at), line: at + 1 });
  }
  return { file, header, items, lang: file.endsWith('.ts') ? 'ts' : 'js' };
}

function render(mods) {
  const out = [];
  out.push('# The `src/` reference');
  out.push('');
  out.push('Every module the app is built from, what it is for, and what it exports.');
  out.push('');
  out.push('**This file is generated by `tools/gen-api-docs.js` and checked by');
  out.push('`test/api-docs.test.js`.** Editing it by hand is pointless: the test compares it');
  out.push('against the source and fails when they disagree, so a change belongs in the comment');
  out.push('above the code. That is the point - documentation nobody has to remember to update');
  out.push('is documentation that can be trusted.');
  out.push('');
  out.push('An export with no description below has no comment in the source. That is a gap in');
  out.push('the code, not in this page.');
  out.push('');

  out.push('| Module | What it owns |');
  out.push('|---|---|');
  for (const m of mods) {
    // Backslashes first: escaping only the pipe turns a source line ending in "\" into "\\|",
    // which markdown reads as an escaped backslash followed by a live column break.
    const first = (m.header.split('\n').find((l) => l.trim()) || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
    out.push(`| [\`src/${m.file}\`](#src${m.file.replace(/\./g, '')}) | ${first} |`);
  }
  out.push('');

  for (const m of mods) {
    out.push(`## src/${m.file}`);
    out.push('');
    if (m.header) { out.push(m.header); out.push(''); }
    if (!m.items.length) { out.push('_Exports nothing._'); out.push(''); continue; }
    for (const it of m.items) {
      out.push(`### \`${it.name}\``);
      out.push('');
      if (it.sig) { out.push(`\`\`\`${m.lang}`); out.push(it.sig); out.push('```'); out.push(''); }
      const { prose, tags } = splitDoc(it.doc);
      if (prose) { out.push(prose); out.push(''); }
      if (tags.length) { out.push('```'); out.push(...tags.map((t) => t.trim())); out.push('```'); out.push(''); }
      if (!prose && !tags.length) { out.push('_No description in the source._'); out.push(''); }
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function build() {
  const files = fs.readdirSync(SRC).filter((f) => isModule(f) && !SKIP(f)).sort();
  return render(files.map((f) => moduleDoc(f)));
}

/* Only when run as a command. Required as a module - which is how test/api-docs.test.js
 * compares the committed file against the source - it must not write anything, or the test
 * would repair the very file it is checking and pass every time. */
function main() {
  const text = build();
  if (process.argv.includes('--check')) {
    const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (have !== text) {
      console.error('docs/API.md is out of date. Run: npm run docs');
      process.exit(1);
    }
    console.log('docs/API.md matches the source.');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  const mods = text.match(/^## src\//gm) || [];
  const syms = text.match(/^### `/gm) || [];
  console.log(`wrote docs/API.md: ${mods.length} modules, ${syms.length} exports`);
}

if (require.main === module) main();

module.exports = { build, moduleDoc };
