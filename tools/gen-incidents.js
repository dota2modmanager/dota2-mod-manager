#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'incidents');
const OUT = path.join(DIR, 'README.md');

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function parse(name) {
  const text = read(path.join(DIR, name));
  const fields = {};

  const metadata = text.match(
    /\| Field \| Value \|\n\| --- \| --- \|([\s\S]*?)(?=\n\n)/,
  );

  if (metadata) {
    for (const line of metadata[1].trim().split('\n')) {
      const parts = line.split('|');

      if (parts.length >= 3) {
        const field = parts[1].trim();
        const value = parts.slice(2, -1).join('|').trim();
        fields[field] = value;
      }
    }
  }

  const title = (text.match(/^# (.+)$/m) || [])[1];

  return {
    name,
    title,
    date: fields.Date,
    versions: fields.Versions,
    fixedIn: fields['Fixed in'],
  };
}

function buildTable() {
  const files = fs.readdirSync(DIR)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort();

  const incidents = files
    .map(parse)
    .sort((a, b) => a.date.localeCompare(b.date));

  const lines = [
    '| Found | Incident | Versions | Fixed in |',
    '| --- | --- | --- | --- |',
  ];

  for (const incident of incidents) {
    lines.push(
      `| ${incident.date} | [${incident.title}](${incident.name}) | ${incident.versions} | ${incident.fixedIn} |`,
    );
  }

  return lines.join('\n');
}

// The table and its rows, up to the heading that follows it.
const TABLE = /\| Found \| Incident \| Versions \| Fixed in \|\n\| --- \| --- \| --- \| --- \|\n[\s\S]*?(?=\n## Writing one)/;

/**
 * The README with its table rebuilt from the write-ups. A README where the table cannot be found
 * is refused: handed back unchanged, it would still equal what the test compares it with, and the
 * index would quietly stop following the folder.
 * @param {string} [text] the README as it is
 */
function build(text = read(OUT)) {
  if (!TABLE.test(text)) throw new Error('docs/incidents/README.md: no incident table before "## Writing one"');
  // the match ends before the blank line that separates the table from the heading, so it goes back
  return text.replace(TABLE, `${buildTable()}\n`);
}

function main() {
  fs.writeFileSync(OUT, build());
  console.log('wrote docs/incidents/README.md');
}

if (require.main === module) main();

module.exports = { build };
