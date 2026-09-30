// items_game.txt: the one file the app rewrites that the client parses itself. A malformed
// result does not degrade, it kills the game on load with ERROR PARSING SCRIPT, and a merge
// that drops blocks silently removes cosmetics people paid for. So the merge is pinned on
// both counts: what it splices in, and what it refuses to ship.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const schema = require('../src/schema.js');
const vpk = require('../src/vpk.ts');

const item = (id, name, extra = '') => `		"${id}"
		{
			"name"		"${name}"
			"prefab"		"default_item"
${extra}		}
`;

/** A small but structurally real items_game.txt. */
const small = (ids = [['1', 'One'], ['2', 'Two'], ['3', 'Three']]) => `"items_game"
{
	"items"
	{
${ids.map(([id, name]) => item(id, name)).join('')}	}
}
`;

/** Big enough to clear validateSchema's "did we just lose the whole table" floor. */
function large(count = 1200, mark = 'Item') {
  const ids = Array.from({ length: count }, (_, i) => [String(i + 1), `${mark} ${i + 1}`]);
  return small(ids);
}

test('every item in the table is listed', () => {
  assert.equal(schema.listItems(small()).length, 3);
  assert.equal(schema.listItems(large(1200)).length, 1200);
});

test('an item is found by id, and a missing one reports missing rather than throwing', () => {
  const text = small();
  const hit = schema.findItem(text, '2');
  assert.ok(hit, 'id 2 exists');
  assert.ok(text.slice(hit.start, hit.end).includes('"Two"'));
  assert.equal(schema.findItem(text, '9999'), null);
});

test('a block replaces the item with that id and leaves its neighbours untouched', () => {
  const base = small();
  const replacement = `"2"
{
	"name"		"Replaced"
	"prefab"		"default_item"
}`;

  const out = schema.mergeSchema(base, [{ id: '2', block: replacement, source: 'mod A' }]);

  assert.deepEqual(out.applied, [{ id: '2', source: 'mod A' }]);
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.conflicts, []);
  assert.ok(out.text.includes('"Replaced"'));
  assert.equal(out.text.includes('"Two"'), false, 'the old block is gone');
  assert.ok(out.text.includes('"One"') && out.text.includes('"Three"'), 'neighbours survive');
  assert.equal(schema.listItems(out.text).length, 3, 'no item is lost or duplicated');
});

test('several blocks all land, not just the last one', () => {
  // The merge splices from the tail so earlier offsets stay valid; doing it head-first would
  // corrupt every edit after the first.
  const base = small();
  const block = (id, name) => `"${id}"\n{\n\t"name"\t\t"${name}"\n}`;

  const out = schema.mergeSchema(base, [
    { id: '1', block: block('1', 'First'), source: 'a' },
    { id: '3', block: block('3', 'Third'), source: 'b' },
  ]);

  assert.equal(out.applied.length, 2);
  assert.ok(out.text.includes('"First"'));
  assert.ok(out.text.includes('"Third"'));
  assert.ok(out.text.includes('"Two"'), 'the untouched item is still there');
  assert.equal(schema.listItems(out.text).length, 3);
});

test('a block for an item the game does not have is reported, not invented', () => {
  const out = schema.mergeSchema(small(), [{ id: '4242', block: '"4242"\n{\n}', source: 'mod' }]);
  assert.deepEqual(out.missing, ['4242']);
  assert.deepEqual(out.applied, []);
  assert.equal(schema.listItems(out.text).length, 3);
});

test('the same block shipped by two mods is not a conflict', () => {
  // Skinchanger bakes the whole cart into every export, so identical copies are the norm and
  // treating them as conflicts would warn on nearly every pair of imported mods.
  const block = '"2"\n{\n\t"name"\t\t"Shared"\n}';
  const out = schema.mergeSchema(small(), [
    { id: '2', block, source: 'mod A' },
    { id: '2', block: block.replace(/\n\t/g, '\n \t '), source: 'mod B' },
  ]);

  assert.deepEqual(out.conflicts, [], 'whitespace-only differences are the same block');
  assert.equal(out.applied.length, 1);
});

test('two mods changing one item differently is reported as a conflict', () => {
  const out = schema.mergeSchema(small(), [
    { id: '2', block: '"2"\n{\n\t"name"\t\t"From A"\n}', source: 'mod A' },
    { id: '2', block: '"2"\n{\n\t"name"\t\t"From B"\n}', source: 'mod B' },
  ]);

  assert.equal(out.conflicts.length, 1);
  assert.deepEqual(out.conflicts[0], { id: '2', a: 'mod A', b: 'mod B' });
  assert.ok(out.text.includes('"From B"'), 'the later patch wins');
});

test('merging nothing changes nothing', () => {
  const base = small();
  const out = schema.mergeSchema(base, []);
  assert.equal(out.text, base);
});

test('a well-formed table of the right size passes validation', () => {
  const text = large(1200);
  const got = schema.validateSchema(text);
  assert.equal(got.items, 1200);
  assert.equal(got.bytes, text.length);
});

test('an unbalanced block is refused instead of shipped', () => {
  assert.throws(() => schema.validateSchema(`${large(1200)}{`));
  assert.throws(() => schema.validateSchema(large(1200).replace('}\n', '')));
  assert.throws(() => schema.validateSchema(`}${large(1200)}`));
});

test('an unclosed quote is refused', () => {
  assert.throws(() => schema.validateSchema(`${large(1200)}"oops`));
});

test('a table that lost most of its items is refused', () => {
  // The failure this guards against: a merge that empties the table produces a file the game
  // loads happily, with every cosmetic gone.
  assert.throws(() => schema.validateSchema(small()));
});

test('a table smaller than the game shipped is refused even when it is large', () => {
  const base = large(1300);
  const shrunk = large(1200);
  assert.doesNotThrow(() => schema.validateSchema(shrunk), 'fine on its own');
  assert.throws(() => schema.validateSchema(shrunk, base), 'not fine against the game');
});

test('merging into a real-sized table keeps it valid', () => {
  const base = large(1200);
  const out = schema.mergeSchema(base, [
    { id: '500', block: '"500"\n{\n\t"name"\t\t"Patched"\n}', source: 'mod' },
  ]);

  assert.equal(out.applied.length, 1);
  assert.doesNotThrow(() => schema.validateSchema(out.text, base));
});

// ---------------------------------------------------------------- what counts as the mod's

const withModel = (id, name, model) => `		"${id}"
		{
			"name"		"${name}"
			"prefab"		"default_item"
			"model_player"		"${model}"
		}
`;

const table = (blocks) => `"items_game"
{
	"items"
	{
${blocks.join('')}	}
}
`;

test('a block naming a file the mod ships is lifted', () => {
  const mod = table([withModel('1', 'Changed', 'models/heroes/tinker/tinker_helmet.vmdl')]);
  const base = table([withModel('1', 'Stock', 'models/heroes/tinker/tinker_cape.vmdl')]);
  const out = schema.extractDeltas(mod, ['models/heroes/tinker/tinker_helmet.vmdl_c'], base);
  assert.deepEqual(out.map((d) => d.id), ['1']);
});

test("a block pointing a slot at a Valve model the mod repaints is lifted too", () => {
  // The author redirects the cape slot to Valve's Deep Sea Robot back and ships nothing of
  // that item but its materials. The block names a model that is not in the mod at all.
  const mod = table([withModel('467', "Tinker's Cape", 'models/items/tinker/deep_sea_robot_back/deep_sea_robot_back.vmdl')]);
  const base = table([withModel('467', "Tinker's Cape", 'models/heroes/tinker/tinker_cape.vmdl')]);
  const paths = ['materials/models/items/tinker/deep_sea_robot_back/deep_sea_robot_back.vmat_c'];
  const out = schema.extractDeltas(mod, paths, base);
  assert.deepEqual(out.map((d) => d.id), ['467']);
});

test('a block about an item the mod never touches is left alone', () => {
  const mod = table([withModel('99', 'Someone else', 'models/items/pudge/pudge_hook/pudge_hook.vmdl')]);
  const base = table([withModel('99', 'Someone else', 'models/heroes/pudge/pudge_weapon.vmdl')]);
  const paths = ['materials/models/items/tinker/deep_sea_robot_back/deep_sea_robot_back.vmat_c'];
  assert.deepEqual(schema.extractDeltas(mod, paths, base), []);
});

test('a block that matches the game byte for byte is not a delta', () => {
  const same = table([withModel('1', 'Stock', 'models/heroes/tinker/tinker_helmet.vmdl')]);
  const out = schema.extractDeltas(same, ['models/heroes/tinker/tinker_helmet.vmdl_c'], same);
  assert.deepEqual(out, []);
});

test('the item list stays right when two tables are read in turn', () => {
  // A rebuild alternates between the game's table and the merged one, and the parsed lists
  // are cached. With room for a single answer each read evicted the last and every rebuild
  // paid for the walk three times; with room for two, the danger is the opposite - handing
  // back the wrong table's list. Both have to survive being asked for in any order.
  const game = [
    '"items_game"', '{', '  "items"', '  {',
    '    "1"', '    {', '      "name"', '"only_in_game"', '    }',
    '    "2"', '    {', '      "name"', '"in_both"', '    }',
    '  }', '}',
  ].join('\n');
  const merged = game.replace('"only_in_game"', '"renamed_in_merged"');

  const a1 = schema.listItems(game);
  const b1 = schema.listItems(merged);
  // asked again in the other order, both must still describe their own text
  const b2 = schema.listItems(merged);
  const a2 = schema.listItems(game);

  assert.equal(a1.find((i) => i.id === '1').name, 'only_in_game');
  assert.equal(b1.find((i) => i.id === '1').name, 'renamed_in_merged');
  assert.equal(a2.find((i) => i.id === '1').name, 'only_in_game', 'the game table came back as the merged one');
  assert.equal(b2.find((i) => i.id === '1').name, 'renamed_in_merged');
  assert.equal(a1, a2, 'the same text should hand back the same cached list');

  // findItem answers off that list now, so it has to be right about which table it read
  assert.equal(schema.findItem(game, '1').text.includes('only_in_game'), true);
  assert.equal(schema.findItem(merged, '1').text.includes('renamed_in_merged'), true);
  assert.equal(schema.findItem(game, '404'), null);
});

// ---------- the rest of the reader ----------
// Added 2026-09-17: a fifth of src/schema.js had no test, including the free-cosmetics
// picker, the block that dresses a base item, and writing the built table into the game.


test('comments and bare words are read the way the game reads them', () => {
  const text = [
    '// written by a tool',
    '"items_game"',
    '{',
    '\t// the items',
    '\t"items"',
    '\t{',
    '\t\t"7"',
    '\t\t{',
    '\t\t\tname\tBare\t\t// a bare key and value',
    '\t\t\t"prefab"\t"default_item"',
    '\t\t}',
    '\t}',
    '}',
    '',
  ].join('\n');
  const [only] = schema.listItems(text);
  assert.equal(only.name, 'Bare');
  assert.deepEqual([...schema.itemFields(text, schema.findItem(text, '7'))], [['name', 'Bare'], ['prefab', 'default_item']]);

  // a comment that runs to the end of the file ends the walk instead of reading past it
  const cut = '"items_game"\n{\n"items"\n{\n"1"\n{\n"name" "x" // no newline after this}}}';
  assert.equal(schema.listItems(cut)[0].name, 'x');
});

test('a block that never closes is refused by name', () => {
  assert.throws(() => schema.listItems('"items_game"\n{\n\t"items"\n\t{\n\t\t"1"\n\t\t{\n'), /items_game/);
});

const WEATHER = [
  '"items_game"',
  '{',
  '\t"items"',
  '\t{',
  '\t\t"555"',
  '\t\t{',
  '\t\t\t"name"\t\t"Default Weather"',
  '\t\t\t"prefab"\t\t"weather"',
  '\t\t\t"baseitem"\t\t"1"',
  '\t\t}',
  '\t\t"4000"',
  '\t\t{',
  '\t\t\t"name"\t\t"Weather Snow"',
  '\t\t\t"prefab"\t\t"weather"',
  '\t\t\t"visuals"',
  '\t\t\t{',
  '\t\t\t\t"asset_modifier"',
  '\t\t\t\t{',
  '\t\t\t\t\t"type"\t\t"particle_snapshot"',
  '\t\t\t\t}',
  '\t\t\t\t"styles"',
  '\t\t\t\t{',
  '\t\t\t\t\t"1"',
  '\t\t\t\t\t{',
  '\t\t\t\t\t\t"unlock"',
  '\t\t\t\t\t\t{',
  '\t\t\t\t\t\t\t"price"\t\t"100"',
  '\t\t\t\t\t\t}',
  '\t\t\t\t\t}',
  '\t\t\t\t}',
  '\t\t\t}',
  '\t\t}',
  '\t\t"4002"',
  '\t\t{',
  // the table is read as latin1, so a UTF-8 name arrives as its raw bytes
  `\t\t\t"name"\t\t"${Buffer.from('Weather Café', 'utf8').toString('latin1')}"`,
  '\t\t\t"prefab"\t\t"weather"',
  '\t\t\t"visuals"',
  '\t\t\t{',
  '\t\t\t\t"skin"\t\t"2"',
  '\t\t\t}',
  '\t\t}',
  '\t\t"4003"',
  '\t\t{',
  '\t\t\t"name"\t\t"Weather Without Looks"',
  '\t\t\t"prefab"\t\t"weather"',
  '\t\t}',
  '\t\t"5000"',
  '\t\t{',
  '\t\t\t"name"\t\t"A Hat"',
  '\t\t\t"prefab"\t\t"wearable"',
  '\t\t\t"item_slot"\t\t"head"',
  '\t\t\t"visuals"',
  '\t\t\t{',
  '\t\t\t}',
  '\t\t}',
  '\t}',
  '}',
  '',
].join('\r\n');

test('the free-cosmetics picker offers what the installed game has for that slot', () => {
  assert.equal(schema.baseItemFor(WEATHER, 'weather').id, '555');
  assert.equal(schema.baseItemFor(WEATHER, 'head'), null, 'no base item, no picker');
  assert.deepEqual(schema.cosmeticOptions(WEATHER, 'weather'), [
    { id: '4002', name: 'Weather Café' },
    { id: '4000', name: 'Weather Snow' },
  ], 'the base item and an item with no visuals are not options; names are shown as UTF-8');
  assert.deepEqual(schema.cosmeticOptions(WEATHER, 'head'), [{ id: '5000', name: 'A Hat' }]);
});

test("a base item is dressed in another item's visuals, without the paid style gates", () => {
  const block = schema.baseItemPatch(WEATHER, '555', '4000');
  assert.ok(block.startsWith('"555"'));
  assert.ok(block.includes('"asset_modifier"'));
  assert.ok(!block.includes('"unlock"'), 'a locked style on a base item is a button that does nothing');
  assert.ok(!block.includes('"price"'));

  const dressed = schema.mergeSchema(WEATHER, [{ id: '555', block }]).text;
  assert.equal(schema.listItems(dressed).find((i) => i.id === '555').hasVisuals, true);
  // once dressed, the base item has visuals of its own, and is still not an option for itself
  assert.deepEqual(schema.cosmeticOptions(dressed, 'weather').map((o) => o.id), ['4002', '4000']);

  // dressing it again replaces the visuals rather than stacking a second block
  const again = schema.baseItemPatch(dressed, '555', '4002');
  assert.equal(again.split('"visuals"').length, 2, 'one visuals block');
  assert.ok(again.includes('"skin"') && !again.includes('"asset_modifier"'));
});

test('dressing a base item names what is missing', () => {
  assert.throws(() => schema.baseItemPatch(WEATHER, '9', '4000'), /9/);
  assert.throws(() => schema.baseItemPatch(WEATHER, '555', '9'), /9/);
  assert.throws(() => schema.baseItemPatch(WEATHER, '555', '4003'), /4003/);
});

test('a block belongs to a mod only when it names a file that mod ships', () => {
  const block = '"visuals" { "model_player" "models/heroes/axe/axe_arcana.vmdl" }';
  assert.equal(schema.blockUsesAssets(block, ['models/heroes/axe/axe_arcana.vmdl_c']), true);
  assert.equal(schema.blockUsesAssets(block, ['models/heroes/lina/lina_arcana.vmdl_c']), false);
});

test("a mod's lifted blocks travel as a table the game can read back", () => {
  const table = schema.deltaTable([
    { id: '1', block: '"1"\r\n\t\t{\r\n\t\t\t"name"\t\t"Lifted"\r\n\t\t}' },
    { id: '2', block: '"2"\r\n\t\t{\r\n\t\t\t"name"\t\t"Also lifted"\r\n\t\t}' },
  ]);
  assert.deepEqual(schema.listItems(table).map((i) => [i.id, i.name]), [['1', 'Lifted'], ['2', 'Also lifted']]);
  assert.deepEqual(schema.listItems(schema.deltaTable([])), []);
});

// ---------- into the game ----------

/** A game folder whose pak01 carries this items_game.txt. */
function gameWith(t, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-schema-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), schema.buildSchemaVpk(text));
  return dir;
}

test('the built table is written into the mod folder, read back the same, and taken away again', (t) => {
  const base = large(1200);
  const game = gameWith(t, base);
  const block = '"2"\r\n{\r\n\t"name"\t\t"Patched"\r\n\t"prefab"\t\t"default_item"\r\n}';

  const out = schema.deploy({ gamePath: game, folder: 'dota_mods', patches: [{ id: '2', block, source: 'a mod' }] });
  assert.deepEqual(out.applied, [{ id: '2', source: 'a mod' }]);
  assert.equal(out.items, 1200);
  assert.equal(out.stamp, schema.readGameSchema(game).stamp);
  assert.equal(schema.isDeployed(game, 'dota_mods'), true);

  const written = vpk.readVpkEntryFile(path.join(game, 'dota_mods', schema.SCHEMA_VPK), schema.SCHEMA_REL);
  const text = written.data.toString('latin1');
  assert.ok(text.includes('"Patched"'));
  assert.equal(schema.listItems(text).length, 1200);
  assert.deepEqual(fs.readdirSync(path.join(game, 'dota_mods')), [schema.SCHEMA_VPK], 'no temporary file left behind');

  // the engine drops empty folders into every path it mounts; those do not keep ours alive
  fs.mkdirSync(path.join(game, 'dota_mods', 'rpt', 'server'), { recursive: true });
  schema.undeploy({ gamePath: game, folder: 'dota_mods' });
  assert.equal(schema.isDeployed(game, 'dota_mods'), false);
  assert.equal(fs.existsSync(path.join(game, 'dota_mods')), false);
  schema.undeploy({ gamePath: game, folder: 'dota_mods' }); // nothing there: nothing to do
});

test("taking the table away leaves a folder that holds somebody else's file", (t) => {
  const game = gameWith(t, large(1200));
  schema.deploy({ gamePath: game, folder: 'dota_mods', patches: [] });
  fs.writeFileSync(path.join(game, 'dota_mods', 'notes.txt'), 'not ours');
  schema.undeploy({ gamePath: game, folder: 'dota_mods' });
  assert.deepEqual(fs.readdirSync(path.join(game, 'dota_mods')), ['notes.txt']);
});

test('a table that would not load is never written into the game', (t) => {
  const game = gameWith(t, small());
  assert.throws(() => schema.deploy({ gamePath: game, folder: 'dota_mods', patches: [] }), /items_game/);
  assert.equal(fs.existsSync(path.join(game, 'dota_mods', schema.SCHEMA_VPK)), false);
});

test("the game's own table must be where the game keeps it", (t) => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-schema-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.throws(() => schema.readGameSchema(empty), /pak01_dir\.vpk/);

  fs.mkdirSync(path.join(empty, 'dota'));
  const other = Buffer.from('not the item table');
  fs.writeFileSync(path.join(empty, 'dota', 'pak01_dir.vpk'), vpk.buildVpk([
    { ext: 'txt', folder: 'scripts', name: 'other', crc: schema.crc32(other), preload: Buffer.alloc(0), data: other },
  ]));
  assert.throws(() => schema.readGameSchema(empty), /items_game/);
});

test('the built table carries the files the item builder copies, each once', (t) => {
  // Two picks can stage the same stock path (two wearables of one hero share a model): the pak
  // holds it once, and the first copy wins, as the builder staged them in the order of the picks.
  const game = gameWith(t, large(1200));
  const data = (s) => Buffer.from(s);
  const asset = (rel, body) => {
    const d = data(body);
    const slash = rel.lastIndexOf('/');
    const dot = rel.lastIndexOf('.');
    return { ext: rel.slice(dot + 1), folder: rel.slice(0, slash), name: rel.slice(slash + 1, dot), data: d, preload: Buffer.alloc(0), crc: vpk.crc32(d) };
  };
  const block = (id) => `"${id}"\r\n{\r\n\t"name"\t\t"Built ${id}"\r\n\t"prefab"\t\t"default_item"\r\n}`;
  schema.deploy({ gamePath: game, folder: 'dota_mods', patches: [
    { id: '2', block: block('2'), source: 'head', assets: [asset('models/heroes/abaddon/helmet.vmdl_c', 'first')] },
    { id: '3', block: block('3'), source: 'again', assets: [asset('models/heroes/abaddon/helmet.vmdl_c', 'second'), asset('models/heroes/abaddon/shoulders.vmdl_c', 'shoulders')] },
  ] });
  const packed = vpk.readVpkEntries(fs.readFileSync(path.join(game, 'dota_mods', schema.SCHEMA_VPK)));
  const byPath = new Map(packed.map((en) => [vpk.entryPath(en), en.data.toString()]));
  assert.equal(packed.length, 3, 'the table and two models, the shared one once');
  assert.equal(byPath.get('models/heroes/abaddon/helmet.vmdl_c'), 'first');
  assert.equal(byPath.get('models/heroes/abaddon/shoulders.vmdl_c'), 'shoulders');
});

test('a bundle lists the items it holds', () => {
  const text = small([['1', 'Stock']]).replace('\t}\n}', `\t\t"20010"
\t\t{
\t\t\t"name"\t\t"Garments Set"
\t\t\t"prefab"\t\t"bundle"
\t\t\t"bundle"
\t\t\t{
\t\t\t\t"Garments Head"\t\t"1"
\t\t\t\t"Garments Arms"\t\t"1"
\t\t\t\t"Not in it"\t\t"0"
\t\t\t}
\t\t}
\t}
}`);
  const set = schema.listItems(text).find((i) => i.id === '20010');
  assert.deepEqual(set.bundleItems, ['Garments Head', 'Garments Arms']);
});
