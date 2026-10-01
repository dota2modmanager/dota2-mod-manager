/**
 * The preset page, served from here as well as from GitHub Pages.
 *
 * A shared preset is a d2mm:// link, and chat clients only make http(s) clickable, so
 * src/preset-link.ts wraps it in a page that hands the code to the app. That page has lived at
 * thefleece.github.io since presets could be shared, which means a link somebody pastes into
 * Discord does not open for anyone who cannot reach GitHub - and a preset is exactly the thing
 * people paste to each other.
 *
 * docs/p/index.html stays the one copy. This puts it in the site's deploy too, so the same page
 * answers on both hosts and every link ever shared keeps working. New links point here
 * (WEB_BASE in src/preset-link.ts); the old ones keep resolving where they always did.
 *
 * The preset code travels in the URL fragment, which browsers never send to a server. Neither
 * host learns which mods anybody shares, and that is worth keeping true of the second one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, '..');
const repoRoot = path.resolve(siteRoot, '..');

const SOURCE = path.join(repoRoot, 'docs', 'p', 'index.html');
const OUT_DIR = path.join(siteRoot, 'dist', 'p');
const SITE = 'https://dota2modmanager.com';

let html = fs.readFileSync(SOURCE, 'utf-8');

// The card image is an absolute URL because Discord and Telegram will not resolve a relative
// one. Pointed at whichever host is serving the page, so a preview does not fetch from the
// other one and fail for the same reason the page would have.
const before = html;
html = html.replaceAll('https://thefleece.github.io/dota2-mod-manager/og.png', `${SITE}/og.png`);
if (html === before) {
  console.log('preset page: no og:image to rewrite, check docs/p/index.html still has one');
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
console.log(`preset page: ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB -> dist/p/index.html`);
