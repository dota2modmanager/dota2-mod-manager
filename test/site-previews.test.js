// The site's pictures are fetched from the bucket by the names the page data gives, so a name
// that is not one picture in /mods/ must not turn into a download or a path outside the folder.
const test = require('node:test');
const assert = require('node:assert/strict');

test('only the /mods/ pictures the page data names are fetched, each once', async () => {
  const { picturesIn } = await import('../tools/catalog/site-previews.mjs');
  const heroes = [{ mods: [{ image: { src: '/mods/b.webp', w: 1 } }, { image: { src: '/mods/a.webp' } }] }];
  const cats = { x: [{ image: { src: '/mods/a.webp' } }, { image: { src: '/mods/t/a.webp' } },
    { image: { src: 'https://elsewhere/a.webp' } }, { image: { src: '/mods/..' } }, { src: '/other/c.webp' }] };
  assert.deepEqual(picturesIn(heroes, cats), ['a.webp', 'b.webp']);
});
