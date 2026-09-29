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

function build() {
  const text = read(OUT);
  const table = buildTable();

  return text.replace(
    /\| Found \| Incident \| Versions \| Fixed in \|\n\| --- \| --- \| --- \| --- \|\n[\s\S]*?(?=\n## Writing one)/,
    `${table}`,
  );
}

function main() {
  fs.writeFileSync(OUT, build());
  console.log('wrote docs/incidents/README.md');
}

if (require.main === module) main();

module.exports = { build };