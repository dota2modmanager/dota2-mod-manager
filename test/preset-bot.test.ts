/* The preset bot (tools/preset-bot/worker.mjs, issue #434). Its decoder has to give the answers the
 * app's does (src/preset-link.ts) for the links the app writes; it answers only requests Discord
 * signed; and a link in a slash command or in a message becomes an embed of the preset's mods, with
 * covers and pages when the site's catalog can be reached and without them when it cannot. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { decodePresetLink, encodePresetLink } from '../src/preset-link.ts';
import worker, { answer, decodeCode, findCode, forgetCatalog } from '../tools/preset-bot/worker.mjs';
import { COMMANDS } from '../tools/preset-bot/register.mjs';

const MODS = [
  { categoryId: 'river', name: 'Frozen River' },
  { categoryId: 'huds', name: 'Hud Fernando', styleLabel: 'gray' },
  { kind: 'cosmetic', slot: 'weapon', itemId: '7375', name: 'Blade of Tears', effectId: '' },
];

const CATALOG = {
  v: 1,
  cats: [['river', 'River', 'Река', 'world'], ['huds', 'HUD', 'HUD', 'interface']],
  heroes: [],
  mods: [['frozen-river', 'Frozen River', 0, -1, 'frozen-river', 'a', 0, '', [], '', '', '']],
};
const catalogFetch = async () => new Response(JSON.stringify(CATALOG));

test('the bot decodes what the app encodes, the same way the app does', async () => {
  const { code, web, direct } = encodePresetLink({ name: 'Winter', author: 'misha', mods: MODS });
  const app = decodePresetLink(web);
  const bot = await decodeCode(code);
  // the app's catalog lines carry a fingerprint slot (always null from a link) the bot has no use for
  const withoutFp = app.mods.map((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'fp')));
  assert.deepEqual(bot, { ...app, mods: withoutFp });
  assert.equal(findCode(`look at this ${web} gg`), code);
  assert.equal(findCode(`<${direct}>`), code);
  assert.equal(findCode(code), code);
  assert.equal(findCode('hello there'), null);
  assert.equal(await decodeCode('not_a_preset_at_all_but_long'), null);
});

async function signed(body: string) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
  return { raw, timestamp, signature };
}

test("only a request Discord signed is answered, and Discord's ping gets its pong", async () => {
  const body = JSON.stringify({ type: 1 });
  const s = await signed(body);
  const req = (sig: string) => new Request('https://bot.example/', {
    method: 'POST', body, headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': s.timestamp },
  });
  const ok = await worker.fetch(req(s.signature), { DISCORD_PUBLIC_KEY: s.raw });
  assert.deepEqual(await ok.json(), { type: 1 });
  const forged = await worker.fetch(req('00'.repeat(64)), { DISCORD_PUBLIC_KEY: s.raw });
  assert.equal(forged.status, 401);
});

test('a link becomes an embed of its mods, with the covers and pages the catalog has', async () => {
  forgetCatalog();
  const { web } = encodePresetLink({ name: 'Winter', author: 'misha', mods: MODS });
  const r = await answer({ type: 2, locale: 'ru', data: { type: 1, name: 'preset', options: [{ name: 'link', value: web }] } }, catalogFetch);
  const { type, data } = await r.json();
  assert.equal(type, 4);
  const [embed] = data.embeds;
  assert.equal(embed.title, 'Winter');
  assert.equal(embed.url, web);
  assert.match(embed.description, /\[Frozen River\]\(https:\/\/dota2modmanager\.com\/ru\/mods\/frozen-river\/\) · Река/);
  assert.match(embed.description, /Hud Fernando \(gray\) · HUD/);
  assert.match(embed.description, /Blade of Tears · \*вид из игры\*/);
  assert.equal(embed.image.url, 'https://dota2modmanager.com/mods/frozen-river.webp');
  assert.equal(embed.footer.text, '3 мода · от misha');
  assert.equal(data.components[0].components[0].url, web);
  assert.deepEqual(data.allowed_mentions, { parse: [] });
});

test('from a message, without the catalog, and with nothing to show', async () => {
  forgetCatalog();
  const { web } = encodePresetLink({ name: 'Winter', mods: MODS.slice(0, 1) });
  const fromMessage = { type: 2, locale: 'en-US', data: { type: 3, name: 'Show preset', resolved: { messages: { 1: { content: `try ${web}` } } } } };
  const down = async () => new Response('', { status: 503 });
  const { data } = await (await answer(fromMessage, down)).json();
  assert.equal(data.embeds[0].description, '• Frozen River');
  assert.equal(data.embeds[0].footer.text, '1 mod');

  const none = await (await answer({ ...fromMessage, data: { ...fromMessage.data, resolved: { messages: { 1: { content: 'no link' } } } } })).json();
  assert.equal(none.data.flags, 64, 'an error is shown only to whoever asked');
  assert.match(none.data.content, /no preset link/);
});

test('the commands are a slash command with a link and a message command', () => {
  assert.deepEqual(COMMANDS.map((c) => [c.type, c.name]), [[1, 'preset'], [3, 'Show preset']]);
  assert.ok(COMMANDS[0].options?.[0].required);
});
