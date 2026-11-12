/**
 * Which pages a deploy took away, for the cache purge after it (tools/purge.mjs).
 *
 * Run from site/: node --test test/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { goneSince } from '../tools/purge.mjs';

test('a page the last deploy announced and this sitemap lacks is gone; the rest stay', () => {
  const ledger = { 'https://dota2modmanager.com/': 'a', 'https://dota2modmanager.com/mods/18-old/': 'b', 'https://dota2modmanager.com/heroes/pudge/': 'c' };
  const xml = '<urlset><url><loc>https://dota2modmanager.com/</loc></url><url><loc>https://dota2modmanager.com/heroes/pudge/</loc></url><url><loc>https://dota2modmanager.com/new/</loc></url></urlset>';
  assert.deepEqual(goneSince(ledger, xml), ['https://dota2modmanager.com/mods/18-old/']);
  assert.deepEqual(goneSince({}, xml), [], 'no ledger, nothing to purge');
});
