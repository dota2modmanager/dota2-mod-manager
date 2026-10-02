// Cosmetic and hero pictures off the Dota wikis (src/icons.ts, src/icon-wiki.ts, src/icon-match.ts).
//
// Two promises matter most. A picture on a card belongs to that item, or the card stays empty:
// the matching forgives a typo but never a different number or an extra word. And the wikis are
// asked as little as possible: a picture is fetched once, a confirmed "no such picture" is
// remembered for a week, and a request that never got an answer is never mistaken for a "no".
// The wikis are played here by a fake fetch that answers the MediaWiki API the way they do.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Icons } from '../src/icons.ts';
import {
  cosmeticFileNames, editDistance, heroFileNames, prefixOf, sniff, stripScreenSuffix, titlePicker,
} from '../src/icon-match.ts';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('a picture')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function userDir(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-icons-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

type Wiki = {
  /** files Fandom serves under Special:FilePath */
  fandomFiles?: Record<string, Buffer>;
  /** what Fandom's allimages and search listings return */
  fandomListing?: string[];
  /** article title -> lead picture URL */
  pages?: Record<string, string>;
  /** what Liquipedia's listings return, and the URL each file resolves to */
  liqListing?: string[];
  liqUrls?: Record<string, string>;
  /** any other URL that serves bytes */
  urls?: Record<string, Buffer>;
  /** every request fails, as with no network */
  down?: boolean;
  /** the file host answers 503 while the API still answers */
  filesBusy?: boolean;
};

/** A fetch that answers like the two wikis, and keeps every URL it was asked for. */
function wikis(w: Wiki) {
  const asked: { url: string; ua: string }[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const bytes = (buf: Buffer | undefined) => (buf ? new Response(new Uint8Array(buf), { status: 200 }) : new Response('', { status: 404 }));
  const fetch = async (url: string, init?: RequestInit) => {
    asked.push({ url, ua: String((init?.headers as Record<string, string> | undefined)?.['User-Agent'] || '') });
    if (w.down) throw new Error('getaddrinfo ENOTFOUND');
    const u = new URL(url);
    if (u.pathname.startsWith('/wiki/Special:FilePath/')) {
      if (w.filesBusy) return new Response('busy', { status: 503 });
      return bytes(w.fandomFiles?.[decodeURIComponent(u.pathname.slice('/wiki/Special:FilePath/'.length))]);
    }
    const q = u.searchParams;
    const liq = u.hostname === 'liquipedia.net';
    const listing = (liq ? w.liqListing : w.fandomListing) || [];
    if (u.pathname.endsWith('/api.php')) {
      if (q.get('list') === 'allimages') {
        const prefix = q.get('aiprefix') || '';
        return json({ query: { allimages: listing.filter((n) => n.startsWith(prefix)).map((name) => ({ name })) } });
      }
      if (q.get('list') === 'search') return json({ query: { search: listing.map((n) => ({ title: `File:${n}` })) } });
      if (q.get('prop') === 'pageimages') {
        const src = w.pages?.[q.get('titles') || ''];
        return json({ query: { pages: { 1: src ? { thumbnail: { source: src } } : { missing: '' } } } });
      }
      if (q.get('prop') === 'imageinfo') {
        const file = (q.get('titles') || '').replace(/^File:/, '').replace(/ /g, '_');
        const resolved = w.liqUrls?.[file];
        return json({ query: { pages: { 1: resolved ? { imageinfo: [{ url: resolved }] } : { missing: '' } } } });
      }
    }
    return bytes(w.urls?.[url]);
  };
  return { fetch, asked };
}

/** An Icons over a fake pair of wikis, with Liquipedia's two-second pacing taken out. */
function icons(t: TestContext, w: Wiki, dir = userDir(t)) {
  const net = wikis(w);
  const ic = new Icons(dir, net.fetch);
  ic.wiki.liqGate = (fn) => fn();
  return { ic, asked: net.asked, dir };
}

const dataUri = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString('base64')}`;

// ---------- naming and matching ----------

test('the file names tried first follow the wiki\'s spellings of the same name', () => {
  assert.deepEqual(cosmeticFileNames('Weather Rain'), ['Cosmetic_icon_Weather_Rain.png']);
  // a colon is dropped or written as a dash, and the game's typographic apostrophe is a plain one
  assert.deepEqual(cosmeticFileNames('Mega-Kills: Axe’s  Fury'), [
    "Cosmetic_icon_Mega-Kills:_Axe's_Fury.png",
    "Cosmetic_icon_Mega-Kills_Axe's_Fury.png",
    "Cosmetic_icon_Mega-Kills-_Axe's_Fury.png",
    'Cosmetic_icon_Mega-Kills:_Axe’s_Fury.png',
  ]);
  assert.deepEqual(heroFileNames('Elder Titan'), ['Elder_Titan_icon.png', 'Elder_Titan_minimap_icon.png']);
});

test('a listing is asked for by the first word, or the first two when the first is short', () => {
  assert.equal(prefixOf('Golden Full-Bore Bonanza'), 'Golden');
  assert.equal(prefixOf('The Dark Lord'), 'The_Dark');
  assert.equal(prefixOf('!!!'), null);
});

test('a listing\'s title counts when it is the same name give or take a typo, and nothing looser', () => {
  const pick = titlePicker('Aghanim\'s Labyrinth 2021 HUD');
  // the schema's own typo, two letters swapped
  assert.equal(pick(["File:Cosmetic icon Aghanim's Labryinth 2021 HUD.png"]), "Cosmetic_icon_Aghanim's_Labryinth_2021_HUD.png");
  // an extra word is a different item, and so is a different year
  assert.equal(pick(["Cosmetic_icon_Aghanim's_Labyrinth_2021_HUD_Bundle.png"]), null);
  assert.equal(pick(["Cosmetic_icon_Aghanim's_Labyrinth_2022_HUD.png"]), null);
  // not a cosmetic icon at all
  assert.equal(pick(["Aghanim's_Labyrinth_2021_HUD.png"]), null);
  // the closest wins when several pass
  assert.equal(pick(["Cosmetic_icon_Aghanims_Labyrinht_2021_HUD.png", "Cosmetic_icon_Aghanim's_Labyrinth_2021_HUD.png"]),
    "Cosmetic_icon_Aghanim's_Labyrinth_2021_HUD.png");
  // "VI" and "IV" are one swap apart and two different pictures
  assert.equal(titlePicker('Loading Screen VI')(['Cosmetic_icon_Loading_Screen_IV.png']), null);
  // the "Skin" the schema gives some HUDs and the wiki does not
  assert.equal(titlePicker('Sunken HUD Skin')(['Cosmetic_icon_Sunken_HUD.png']), 'Cosmetic_icon_Sunken_HUD.png');
});

test('a screen is retried under its outfit\'s name, and anything else is left alone', () => {
  assert.equal(stripScreenSuffix('Crimson Witness Loading Screen'), 'Crimson Witness');
  assert.equal(stripScreenSuffix('Crimson Witness - Versus Screen'), 'Crimson Witness');
  assert.equal(stripScreenSuffix('Crimson Witness LS'), 'Crimson Witness');
  assert.equal(stripScreenSuffix('Crimson Witness'), null);
  assert.equal(stripScreenSuffix('Loading Screen'), null, 'a name that is only the suffix has no outfit');
});

test('only bytes that are a picture count as one', () => {
  assert.equal(sniff(PNG), 'image/png');
  assert.equal(sniff(WEBP), 'image/webp');
  assert.equal(sniff(JPEG), 'image/jpeg');
  assert.equal(sniff(Buffer.from('<!doctype html>')), null);
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('same', 'same'), 0);
});

// ---------- asking the wikis, and remembering ----------

test('a picture under the game\'s own name is fetched once, then read from disk', async (t) => {
  const { ic, asked } = icons(t, { fandomFiles: { 'Cosmetic_icon_Weather_Rain.png': PNG } });
  assert.equal(await ic.get('Weather Rain'), dataUri('image/png', PNG));
  const first = asked.length;
  assert.equal(await ic.get('Weather Rain'), dataUri('image/png', PNG));
  assert.equal(asked.length, first, 'the second look is served from the cache');
  assert.ok(ic.size() >= PNG.length);
  assert.equal(await ic.get(''), null);
  assert.equal(await ic.get(null), null);
});

test('a confirmed "no such picture" is remembered, across restarts, and a dropped request is not', async (t) => {
  const dir = userDir(t);
  const nobody = icons(t, {}, dir);
  assert.equal(await nobody.ic.get('Nothing Anywhere'), null);
  assert.ok(nobody.asked.length > 0);

  const again = icons(t, {}, dir);
  assert.equal(await again.ic.get('Nothing Anywhere'), null);
  assert.equal(again.asked.length, 0, 'a miss from this week is not asked again, even by a new start');

  // with no network nothing answered, so nothing is known: the next look asks again
  const offline = icons(t, { down: true });
  assert.equal(await offline.ic.get('Weather Rain'), null);
  const tried = offline.asked.length;
  assert.equal(await offline.ic.get('Weather Rain'), null);
  assert.ok(offline.asked.length > tried, 'a dropped request is not remembered as a miss');

  // a wiki error page is not a "no" either
  const flaky = icons(t, { urls: {} });
  flaky.ic.wiki.fetch = async () => new Response('busy', { status: 503 });
  assert.equal(await flaky.ic.get('Weather Rain'), null);
  assert.equal(flaky.ic.misses.size, 0);
});

test('a busy file host with an empty listing is not a "no": the card asks again next time', async (t) => {
  /* The picture may well be under the item's own name; the host just did not hand it over. The
     listing and the search answering "nothing" do not settle that, so nothing is remembered. */
  const { ic, asked } = icons(t, { filesBusy: true });
  assert.equal(await ic.get('Weather Rain'), null);
  assert.equal(ic.misses.size, 0, 'no miss recorded');
  const first = asked.length;
  await ic.get('Weather Rain');
  assert.ok(asked.length > first, 'asked again');
});

test('two cards asking for the same picture at once cost one lookup', async (t) => {
  const { ic, asked } = icons(t, { fandomFiles: { 'Cosmetic_icon_Weather_Rain.png': PNG } });
  const [a, b] = await Promise.all([ic.get('Weather Rain'), ic.get('Weather Rain')]);
  assert.equal(a, b);
  assert.equal(asked.filter((r) => r.url.includes('Weather_Rain')).length, 1);
});

test('a picture filed under another name is found through the listing, then the page, then Liquipedia', async (t) => {
  // the wiki's own spelling, found by the prefix listing
  const listed = icons(t, {
    fandomListing: ["Cosmetic_icon_Aghanim's_Labryinth_2021_HUD.png"],
    fandomFiles: { "Cosmetic_icon_Aghanim's_Labryinth_2021_HUD.png": WEBP },
  });
  assert.equal(await listed.ic.get("Aghanim's Labyrinth 2021 HUD"), dataUri('image/webp', WEBP));

  // a courier illustrated on its own page under some other file name
  const page = icons(t, {
    pages: { 'Shagbark': 'https://static.wikia.example/shagbark.png' },
    urls: { 'https://static.wikia.example/shagbark.png': PNG },
  });
  assert.equal(await page.ic.get('Shagbark'), dataUri('image/png', PNG));

  // nothing on Fandom at all: Liquipedia, asked with an agent that names the project
  const liq = icons(t, {
    liqListing: ['Cosmetic_icon_Mega-Kills_Axe.png'],
    liqUrls: { 'Cosmetic_icon_Mega-Kills_Axe.png': 'https://liquipedia.net/commons/images/axe.png' },
    urls: { 'https://liquipedia.net/commons/images/axe.png': JPEG },
  });
  assert.equal(await liq.ic.get('Mega-Kills Axe'), dataUri('image/jpeg', JPEG));
  const host = (r: { url: string }) => new URL(r.url).hostname;
  const liqAsks = liq.asked.filter((r) => host(r) === 'liquipedia.net');
  assert.ok(liqAsks.length >= 2);
  assert.ok(liqAsks.every((r) => /^Dota2ModManager\//.test(r.ua)), 'Liquipedia is asked as this project');
  assert.ok(liq.asked.filter((r) => host(r) === 'dota2.fandom.com').every((r) => /Mozilla/.test(r.ua)), 'Fandom as a browser');
});

test('a loading screen with no picture of its own shows its outfit\'s', async (t) => {
  const { ic } = icons(t, {
    fandomListing: ['Cosmetic_icon_Crimson_Witness.png'],
    fandomFiles: { 'Cosmetic_icon_Crimson_Witness.png': PNG },
  });
  assert.equal(await ic.get('Crimson Witness Loading Screen'), dataUri('image/png', PNG));
});

test('heroes and stand-ins come through the same batch call, each kind under its own key', async (t) => {
  const { ic } = icons(t, {
    fandomFiles: { 'Axe_icon.png': PNG, 'Cosmetic_icon_Weather_Rain.png': WEBP },
    pages: { 'Cursor Pack': 'https://static.wikia.example/cursor.png' },
    urls: { 'https://static.wikia.example/cursor.png': JPEG },
  });
  const got = await ic.getMany(['hero:Axe', 'generic:cursor', 'generic:nonsense', 'Weather Rain', 'Weather Rain', '', 'hero:Nobody']);
  assert.deepEqual(got, {
    'hero:Axe': dataUri('image/png', PNG),
    'generic:cursor': dataUri('image/jpeg', JPEG),
    'generic:nonsense': null,
    'Weather Rain': dataUri('image/webp', WEBP),
    'hero:Nobody': null,
  });
  assert.deepEqual(await ic.getMany('not a list'), {});
  // a hero named like a cosmetic is a different picture
  assert.notEqual(ic.cachePath('hero:Axe'), ic.cachePath('Axe'));
});

test('clearing the cache forgets the pictures and the misses', async (t) => {
  const { ic } = icons(t, { fandomFiles: { 'Cosmetic_icon_Weather_Rain.png': PNG } });
  await ic.get('Weather Rain');
  await ic.get('Nothing Anywhere');
  assert.ok(ic.size() > 0 && ic.misses.size === 1);
  ic.clear();
  assert.equal(ic.size(), 0);
  assert.equal(ic.misses.size, 0);
});
