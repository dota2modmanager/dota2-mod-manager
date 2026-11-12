/* Another player's item in the user's look, whatever style it is worn in (src/item-builder-styles.ts
 * inEveryStyle). Written after #402: the user had Bracers of the Cavern Luminar on in its first
 * style, an enemy Earthshaker wore the same bracers in their second, and the server sends the
 * owner's style with the item. Under the user's block, which still carried both styles' entries,
 * the enemy's bracers were drawn with the second style's orange particles and its errors.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inEveryStyle, blockInEveryStyle, withStyle } from '../src/item-builder-styles.ts';

const entry = (particle: string, style?: number) => `\t\t"asset_modifier"\r\n\t\t{\r\n\t\t\t"type"\t\t"particle"\r\n\t\t\t"modifier"\t\t"${particle}"${style === undefined ? '' : `\r\n\t\t\t"style"\t\t"${style}"`}\r\n\t\t}`;
const styles = `\t\t"styles"\r\n\t\t{\r\n\t\t\t"0"\r\n\t\t\t{\r\n\t\t\t\t"name"\t\t"#Blue"\r\n\t\t\t\t"skin"\t\t"0"\r\n\t\t\t}\r\n\t\t\t"1"\r\n\t\t\t{\r\n\t\t\t\t"name"\t\t"#Orange"\r\n\t\t\t\t"skin"\t\t"1"\r\n\t\t\t\t"unlock"\t\t{ "price" "1" }\r\n\t\t\t}\r\n\t\t}`;
const visuals = (withStyles: boolean) => `{\r\n${[entry('totem_blur.vpcf', 0), entry('totem_blur_v2.vpcf', 1), entry('ambient.vpcf'), ...(withStyles ? [styles] : [])].join('\r\n')}\r\n\t}`;

/** What the client applies to the item in style `n`: an entry unmarked, or marked n. */
function shown(v: string, n: number): string[] {
  return [...v.matchAll(/"asset_modifier"\s*\{([^}]*)\}/g)]
    .filter((m) => { const s = /"style"\s+"(\d+)"/.exec(m[1]); return !s || s[1] === String(n); })
    .map((m) => /"modifier"\s+"([^"]+)"/.exec(m[1])![1]);
}
const styleBlocks = (v: string) => [...v.slice(v.indexOf('"styles"')).matchAll(/^\s*"(\d+)"\s*$/gm)].map((m) => m[1]);

test('the first style is what every style shows, for an item worn in any of them', () => {
  const before = visuals(true);
  assert.deepEqual(shown(before, 1), ['totem_blur_v2.vpcf', 'ambient.vpcf'], 'the bug: worn in its second style, the second style showed');
  const after = inEveryStyle(before, 2);
  for (const n of [0, 1]) assert.deepEqual(shown(after, n), ['totem_blur.vpcf', 'ambient.vpcf'], `in style ${n}`);
  assert.doesNotMatch(after, /"style"\s+"\d"/, 'no entry is marked for a style');
  assert.deepEqual(styleBlocks(after), ['0', '1'], 'a block for each style the item can be worn in');
  assert.equal((after.match(/"skin"\s+"0"/g) || []).length, 2, 'each with the first style\'s material');
  assert.doesNotMatch(after, /#Orange|"skin"\s+"1"|unlock/, 'and nothing of the second');
});

test('a pick in its first style, written with no styles block, shows that style in every style', () => {
  // the builder takes the styles block out of a first-style pick and leaves its entries marked
  const after = inEveryStyle(visuals(false), 2);
  for (const n of [0, 1, 5]) assert.deepEqual(shown(after, n), ['totem_blur.vpcf', 'ambient.vpcf'], `in style ${n}`);
  assert.doesNotMatch(after, /"styles"/, 'no styles block is made up');
});

test('a pick in its second style is that style in every style', () => {
  const picked = withStyle(visuals(true), 1);
  assert.ok(picked.applied);
  const after = inEveryStyle(picked.visuals, 2);
  for (const n of [0, 1]) assert.deepEqual(shown(after, n), ['totem_blur_v2.vpcf', 'ambient.vpcf'], `in style ${n}`);
  assert.equal((after.match(/"skin"\s+"1"/g) || []).length, 2, 'the second style\'s material, under both numbers');
});

test('a built block takes as many styles as the item it is worn as', () => {
  const block = (v: string) => `"7293"\r\n{\r\n\t"name"\t\t"Bracers"\r\n\t"visuals"\r\n\t${v}\r\n}`;
  const worn = block(visuals(true));
  const out = blockInEveryStyle(block(visuals(true)), worn);
  assert.match(out, /^"7293"\r\n\{\r\n\t"name"\t\t"Bracers"/, 'the rest of the block is left as it was');
  assert.deepEqual(shown(out, 1), ['totem_blur.vpcf', 'ambient.vpcf']);
  assert.deepEqual(styleBlocks(out), ['0', '1']);
  assert.equal(blockInEveryStyle('"1"\r\n{\r\n\t"name"\t\t"no visuals"\r\n}', worn), '"1"\r\n{\r\n\t"name"\t\t"no visuals"\r\n}');
});
