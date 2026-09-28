/* Who the mod window names as having made a mod.
 *
 * Until 2026-09-24 it showed the first author and nobody else, and a modder or a sender became a
 * link button whose "address" was a name, which opened as a page that does not exist. These pin
 * the cases the catalog actually has: two authors (Earthshaker Arcana), an author and a modder
 * (24 mods), an author and a sender, the older fields on the mod itself, and an empty sender.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/core/credits.ts');
const CONSTANTS = {
  MOD_AUTHOR: { Darkness: 'https://t.me/Darkness_Logovo', apathydxd: 'https://discord.com/users/538760177470668810' },
  MOD_SENDER: { papapodzaborniy: 'https://example.org/papa' },
};

test('two authors are both credited, in the order the catalog gives them', async () => {
  const { modCredits } = await load();
  const got = modCredits({ links: [{ type: 'author', url: 'J0nathan550' }, { type: 'author', url: 'lansory' }] }, CONSTANTS);
  assert.deepEqual(got.map((c) => [c.role, c.name]), [['author', 'J0nathan550'], ['author', 'lansory']]);
});

test('the author comes before the modder, whatever order the links are in, and both link to their page', async () => {
  const { modCredits } = await load();
  const got = modCredits({ links: [{ type: 'modded', url: 'apathydxd' }, { type: 'author', url: 'Darkness' }] }, CONSTANTS);
  assert.deepEqual(got, [
    { role: 'author', name: 'Darkness', href: 'https://t.me/Darkness_Logovo' },
    { role: 'modded', name: 'apathydxd', href: 'https://discord.com/users/538760177470668810' },
  ]);
});

test('a name with no page is still credited, and never turned into an address', async () => {
  const { modCredits } = await load();
  const [c] = modCredits({ links: [{ type: 'modded', url: 'Fr0dech' }] }, CONSTANTS);
  assert.deepEqual(c, { role: 'modded', name: 'Fr0dech', href: null });
});

test('a sender is looked up among the senders, and an empty one is left out', async () => {
  const { modCredits } = await load();
  const got = modCredits({ links: [{ type: 'author', url: 'Kisilev' }, { type: 'sender', url: 'papapodzaborniy' }, { type: 'sender', url: '  ' }] }, CONSTANTS);
  assert.deepEqual(got.map((c) => [c.role, c.name, c.href]), [
    ['author', 'Kisilev', null],
    ['sender', 'papapodzaborniy', 'https://example.org/papa'],
  ]);
});

test('links that are not people stay out, and the older fields on the mod still count', async () => {
  const { modCredits } = await load();
  const got = modCredits({
    author: 'Defiree',
    links: [{ type: 'source', url: 'https://dota2changer.com/x/' }, { type: 'preview', url: 'a.mp4' }, { type: 'author', url: 'Defiree' }],
  }, CONSTANTS);
  assert.deepEqual(got.map((c) => [c.role, c.name]), [['author', 'Defiree']], 'the same author twice is one credit');
});

test('a credit given as an address keeps it, and is named by the name beside it or by its host', async () => {
  const { modCredits } = await load();
  const got = modCredits({ links: [
    { type: 'sender', url: 'https://vk.com/somebody', name: 'Somebody' },
    { type: 'author', url: 'https://www.example.com/me' },
  ] }, CONSTANTS);
  assert.deepEqual(got, [
    { role: 'author', name: 'example.com', href: 'https://www.example.com/me' },
    { role: 'sender', name: 'Somebody', href: 'https://vk.com/somebody' },
  ]);
});

test('a mod with no one credited has an empty list, and a missing mod does not throw', async () => {
  const { modCredits } = await load();
  assert.deepEqual(modCredits({ links: [] }), []);
  assert.deepEqual(modCredits(undefined), []);
});
