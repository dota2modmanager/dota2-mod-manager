/**
 * Drop the pages a deploy took away from Cloudflare's cache, and any address named by hand.
 *
 * A Pages deploy replaces the whole site, but an edge that already handed out a page keeps
 * serving its copy. On 2026-11-07 an 18+ mod's page, taken off the site, still answered 200 from
 * one edge after the deploy that removed it, while the site itself said 404.
 *
 * Which pages went: the IndexNow ledger (tools/indexnow.mjs) holds every address the last deploy
 * announced, and the sitemap just built holds every address now. One in the first and not the
 * second is gone. Run after the deploy and before IndexNow, which rewrites the ledger. Addresses
 * given on the command line are purged too (site.yml's workflow_dispatch input), for a page
 * that went before the ledger knew it.
 *
 * Usage: node tools/purge.mjs [--dry] [url ...]
 * Needs CLOUDFLARE_ZONE_ID and a token with Zone, Cache Purge (CLOUDFLARE_API_TOKEN).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sitemap = path.resolve(here, '..', 'dist', 'sitemap-0.xml');
const statePath = path.resolve(here, '..', '..', 'indexnow.state.json');
const { purgeCache } = createRequire(import.meta.url)('../../tools/r2-client.js');

/** The addresses the last deploy had and this one has not. */
export function goneSince(ledger, sitemapXml) {
  const now = new Set([...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  return Object.keys(ledger).filter((url) => !now.has(url));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const named = args.filter((a) => /^https:\/\/dota2modmanager\.com\//.test(a));
  let ledger = {};
  try { ledger = JSON.parse(fs.readFileSync(statePath, 'utf-8')).pages ?? {}; } catch { /* first deploy: nothing to compare */ }
  const gone = goneSince(ledger, fs.readFileSync(sitemap, 'utf-8'));
  const urls = [...new Set([...gone, ...named])];
  console.log(`purge: ${gone.length} page(s) gone since the last deploy, ${named.length} named`);
  for (const u of urls) console.log(`  ${u}`);
  if (dry || !urls.length) process.exit(0);
  const result = await purgeCache(urls);
  if (result.skipped || result.failed) process.exitCode = 1;
}
