/* Pull the faces the app uses out of Google's CDN and keep them beside the app.
 *
 * The CSS Google serves is already exactly what we want - correct unicode-ranges, correct
 * weights - so it is fetched, every woff2 in it is downloaded, and the URLs are rewritten to
 * point at the local copies. Nothing is hand-written, so nothing drifts from what the browser
 * was being given before. */
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const OUT = path.join('renderer', 'fonts');

const SHEETS = [
  ['text', 'https://fonts.googleapis.com/css2?family=Exo+2:wght@600;700;800&family=Inter:wght@400;500;600&display=swap'],
  ['icons', 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0..1,0&display=block'],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let css = '';
  let files = 0;
  let bytes = 0;

  for (const [name, url] of SHEETS) {
    const sheet = await fetch(url, { headers: { 'User-Agent': UA } }).then((r) => r.text());
    let out = sheet;
    const urls = [...sheet.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
    let i = 0;
    for (const u of [...new Set(urls)]) {
      // one file per family+range; the name only has to be stable and readable
      const family = (sheet.slice(0, sheet.indexOf(u)).match(/font-family: '([^']+)'/g) || []).pop() || name;
      const file = `${slug(family.replace("font-family: '", '').replaceAll("'", ''))}-${String(++i).padStart(2, '0')}.woff2`;
      const buf = Buffer.from(await fetch(u, { headers: { 'User-Agent': UA } }).then((r) => r.arrayBuffer()));
      fs.writeFileSync(path.join(OUT, file), buf);
      // the sheet lives in renderer/styles/, so the fonts are one level up from it
      out = out.split(u).join(`../fonts/${file}`);
      files++;
      bytes += buf.length;
    }
    css += `/* ${name}: ${url} */\n${out}\n`;
  }

  // the icon class Google ships with the sheet is not used here - the app styles .ms itself
  fs.writeFileSync(path.join('renderer', 'styles', 'fonts.css'),
    '/* Fonts kept beside the app rather than fetched at startup.\n'
    + ' *\n'
    + ' * They used to come from Google every launch, which meant the interface arrived without\n'
    + ' * them whenever that was slow, blocked or simply not reachable yet: with font-display block\n'
    + ' * on the icon face, every icon in the window turned into the word behind it - "campaign",\n'
    + ' * "shield", "play_arrow". A desktop app has no business needing a CDN to draw its own\n'
    + ' * buttons.\n'
    + ' *\n'
    + ' * Generated from the stylesheets Google serves, so the weights and unicode ranges are the\n'
    + ' * ones the browser was already being given. Regenerate with tools/dev/fonts.js.\n'
    + ' */\n' + css);

  console.log(`downloaded ${files} files, ${(bytes / 1048576).toFixed(2)} MB`);
})();
