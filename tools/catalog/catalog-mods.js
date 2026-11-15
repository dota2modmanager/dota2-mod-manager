// Walking the catalog, in one place instead of three.
//
// mods.json keeps most categories as an array of mods and five of them as
// { groups: [ { id, name, mods: [...] } ] }: hero-items, item-effects, creeps, creep-deny and
// towers. Every tool in this repository that reads the catalog has to know that, and until
// 2026-09-10 three of them each knew it separately. Two were right. tools/catalog/r2-sync.mjs skipped
// anything that was not an array, so 313 mods of 1,336 had never reached the mirror, and the
// gap was invisible because the site and the fingerprint index looked complete.
//
// Styles are left to the caller. A mod with several styles is one archive to the mirror and
// several entries to the site, so there is no single right answer and this does not invent one.

/**
 * Every mod in the catalog, with the category it belongs to.
 *
 * @param {object} modsData  the `modsData` object out of mods.json
 * @param {object} [opts]
 * @param {string[]} [opts.skip]  category ids to leave out
 * @yields {{ categoryId: string, mod: object }}
 */
function* iterMods(modsData, { skip = [] } = {}) {
  if (!modsData || typeof modsData !== 'object') return;
  for (const [categoryId, data] of Object.entries(modsData)) {
    if (skip.includes(categoryId)) continue;
    for (const mod of modsUnder(data)) yield { categoryId, mod };
  }
}

/**
 * The mods inside one category's value, whichever shape it arrived in.
 *
 * Written as a walk rather than as "array, or groups, or nothing", because the shape has
 * already changed once without warning and the next one should cost nothing.
 */
function modsUnder(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) modsUnder(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  // a mod is an object that says which file it ships as; anything else is scaffolding
  if (typeof node.file === 'string') {
    out.push(node);
    return out;
  }
  for (const value of Object.values(node)) modsUnder(value, out);
  return out;
}

module.exports = { iterMods, modsUnder };
