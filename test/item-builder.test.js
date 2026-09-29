// The item builder (src/item-builder.js): a hero's stock item built from one of its wearables,
// with an effect on top. Written with the feature by h6rd (#117); moved here from
// schema.test.js when the builder got a module of its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const schema = require('../src/schema.js');
const builder = require('../src/item-builder.js');
const vpk = require('../src/vpk.js');

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

const table = (blocks) => `"items_game"
{
	"items"
	{
${blocks.join('')}	}
}
`;

/** One inline-data entry in the shape buildVpk() wants. */
function entry(relPath, body) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
  const lower = relPath.toLowerCase();
  const slash = lower.lastIndexOf('/');
  const file = slash === -1 ? lower : lower.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  return {
    ext: dot === -1 ? ' ' : file.slice(dot + 1),
    folder: slash === -1 ? ' ' : lower.slice(0, slash),
    name: dot === -1 ? file : file.slice(0, dot),
    data,
    preload: Buffer.alloc(0),
    crc: vpk.crc32(data),
  };
}

function itemWearableTable() {
  return table([
    `\t\t"10"
\t\t{
\t\t\t"name"\t\t"Default Weather"
\t\t\t"prefab"\t\t"weather"
\t\t\t"baseitem"\t\t"1"
\t\t}`,
    `\t\t"282"
\t\t{
\t\t\t"name"\t\t"Sniper's Cape"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"back"
\t\t\t"model_player"\t\t"models/heroes/sniper/cape.vmdl"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"particle"
\t\t\t\t\t"asset"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf"
\t\t\t\t\t"modifier"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_stock_should_be_replaced.vpcf"
\t\t\t\t}
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"particle"
\t\t\t\t\t"asset"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf"
\t\t\t\t\t"modifier"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_slow_caster_stock_should_be_replaced.vpcf"
\t\t\t\t}
\t\t\t}
\t\t}`,
    `\t\t"400"
\t\t{
\t\t\t"name"\t\t"Sniper default with visuals"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"head"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"500"
\t\t{
\t\t\t"name"\t\t"Bloodseeker weapon default"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"image_inventory"\t\t"econ/heroes/blood_seeker/weapon"
\t\t\t"model_player"\t\t"models/heroes/blood_seeker/weapon.vmdl"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_bloodseeker"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"501"
\t\t{
\t\t\t"name"\t\t"Bloodseeker offhand default"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"offhand_weapon"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_bloodseeker"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9455"
\t\t{
\t\t\t"name"\t\t"Golden Full-Bore Bonanza"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"back"
\t\t\t"model_player"\t\t"models/items/sniper/sniper_cape_immortal/sniper_cape_immortal.vmdl"
\t\t\t"item_name"\t\t"#DOTA_Item_Golden_FullBore_Bonanza"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"particle"
\t\t\t\t\t"asset"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf"
\t\t\t\t\t"modifier"\t\t"particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow.vpcf"
\t\t\t\t}
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"particle_create"
\t\t\t\t\t"modifier"\t\t"particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_ambient.vpcf"
\t\t\t\t}
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"ability_icon"
\t\t\t\t\t"asset"\t\t"sniper_headshot"
\t\t\t\t\t"modifier"\t\t"sniper_headshot_immortal_gold"
\t\t\t\t\t"apply_when_equipped_in_ability_effects_slot"\t\t"2"
\t\t\t\t}
\t\t\t\t"asset_modifier"
\t\t\t\t{
\t\t\t\t\t"type"\t\t"particle"
\t\t\t\t\t"asset"\t\t"particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf"
\t\t\t\t\t"modifier"\t\t"particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow_caster.vpcf"
\t\t\t\t}
\t\t\t\t"styles"
\t\t\t\t{
\t\t\t\t\t"0"
\t\t\t\t\t{
\t\t\t\t\t\t"unlock"
\t\t\t\t\t\t{
\t\t\t\t\t\t\t"item_def"\t\t"123"
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t}`,
    `\t\t"9456"
\t\t{
\t\t\t"name"\t\t"Unsupported back"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"back"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_axe"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9500"
\t\t{
\t\t\t"name"\t\t"Bundle that must stay hidden"
\t\t\t"prefab"\t\t"bundle"
\t\t\t"item_slot"\t\t"back"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9700"
\t\t{
\t\t\t"name"\t\t"Io Ball"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"ambient"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_wisp"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9701"
\t\t{
\t\t\t"name"\t\t"Io Ambient"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"ambient"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_wisp"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9457"
\t\t{
\t\t\t"name"\t\t"No visuals here"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"head"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t}`,
    `\t\t"9600"
\t\t{
\t\t\t"name"\t\t"Bloodseeker main blade"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"weapon"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_bloodseeker"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9601"
\t\t{
\t\t\t"name"\t\t"Bloodseeker offhand blade"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"offhand_weapon"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_bloodseeker"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9800"
\t\t{
\t\t\t"name"\t\t"Tidehunter's Anchor"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"image_inventory"\t\t"econ/heroes/tidehunter/tidehunter_anchor"
\t\t\t"model_player"\t\t"models/heroes/tidehunter/tidehunter_anchor.vmdl"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_tidehunter"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9801"
\t\t{
\t\t\t"name"\t\t"Tidehunter bonus anchor"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"weapon"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_tidehunter"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9900"
\t\t{
\t\t\t"name"\t\t"Sniper Persona Default"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"weapon_persona_1"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9901"
\t\t{
\t\t\t"name"\t\t"Sniper Persona Gun"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"weapon_persona_1"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_sniper"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9902"
\t\t{
\t\t\t"name"\t\t"Axe Arcana Back"
\t\t\t"prefab"\t\t"default_item"
\t\t\t"item_slot"\t\t"back"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_axe"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
    `\t\t"9903"
\t\t{
\t\t\t"name"\t\t"Axe Arcana Cape"
\t\t\t"prefab"\t\t"wearable"
\t\t\t"item_slot"\t\t"back"
\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_axe"\t\t"1"
\t\t\t}
\t\t\t"visuals"
\t\t\t{
\t\t\t}
\t\t}`,
  ]);
}

test('item cosmetics build one slot per hero part, infer missing stock slots, and hide arcana/persona', () => {
  const text = itemWearableTable();
  const slots = builder.itemSlots(text);
  assert.deepEqual(slots.map((s) => [s.slot, s.equipSlot, s.slotLabel, s.options.map((o) => o.id)]), [
    ['item:bloodseeker:weapon', 'weapon', 'Weapon', ['9600']],
    ['item:bloodseeker:offhand_weapon', 'offhand_weapon', 'Offhand weapon', ['9601']],
    ['item:sniper:head', 'head', 'Head', ['9457']],
    ['item:sniper:back', 'back', 'Back', ['9455']],
    ['item:tidehunter:weapon', 'weapon', 'Weapon', ['9801']],
  ]);
  assert.equal(slots[0].label.includes('Bloodseeker'), true);
  assert.equal(slots[0].label.includes('Weapon'), true);
  assert.equal(slots.some((s) => s.slot.includes('wisp')), false);
  assert.equal(slots.some((s) => /arcana|persona/i.test(`${s.slot} ${s.label}`)), false);
  assert.deepEqual(builder.itemOptions(text), [
    { id: '9600', name: 'Bloodseeker main blade' },
    { id: '9601', name: 'Bloodseeker offhand blade' },
    { id: '9457', name: 'No visuals here' },
    { id: '9455', name: 'Golden Full-Bore Bonanza' },
    { id: '9801', name: 'Tidehunter bonus anchor' },
  ]);
  assert.deepEqual(builder.itemEffects(), [
    { id: '', name: 'No effect' },
    { id: 'fire', name: 'Fire' },
    { id: 'lightnings', name: 'Lightnings' },
    { id: 'frostbloom', name: 'Frostbloom' },
    { id: 'snow', name: 'Snow' },
    { id: 'bubbles', name: 'Bubbles' },
    { id: 'sand-storm', name: 'Sand Storm' },
    { id: 'ghost', name: 'Ghost' },
  ]);
});

test('a wearable resolves to the matching default item by hero and slot', () => {
  const text = itemWearableTable();
  const hit = builder.defaultItemForWearable(text, '9455');
  assert.ok(hit, 'default item should be found');
  assert.equal(hit.id, '282');
  assert.equal(hit.name, "Sniper's Cape");

  const offhand = builder.defaultItemForWearable(text, '9601');
  assert.ok(offhand, 'offhand alias should resolve too');
  assert.equal(offhand.id, '501');
  assert.equal(offhand.name, 'Bloodseeker offhand default');

  const inferred = builder.defaultItemForWearable(text, '9801');
  assert.ok(inferred, 'weapon-like default without item_slot should still resolve');
  assert.equal(inferred.id, '9800');
  assert.equal(inferred.name, "Tidehunter's Anchor");

  assert.equal(builder.defaultItemForWearable(text, '9901'), null, 'persona items stay hidden');
  assert.equal(builder.defaultItemForWearable(text, '9903'), null, 'arcana items stay hidden');
});

test('item effects keep the donor body, rewrite only the stock header and collect asset copies', () => {
  const text = itemWearableTable();
  const plain = builder.itemEffectPatch(text, '9455', '');
  assert.doesNotMatch(plain.block, /seasonal_ambient_silver\.vpcf/);

  const modelOnly = builder.itemEffectPatch(text, '9457', '');
  assert.equal(modelOnly.id, '400');
  assert.match(modelOnly.block, /^"400"/);
  assert.match(modelOnly.block, /"prefab"\s+"default_item"/);
  assert.match(modelOnly.block, /"visuals"\s*\{\s*\}/);


  const patched = builder.itemEffectPatch(text, '9455', 'frostbloom');

  assert.equal(patched.id, '282');
  assert.match(patched.block, /^"282"/);
  assert.match(patched.block, /"name"\s+"Sniper's Cape"/);
  assert.match(patched.block, /"prefab"\s+"default_item"/);
  assert.match(patched.block, /"item_name"\s+"#DOTA_Item_Golden_FullBore_Bonanza"/);
  assert.match(patched.block, /"model_player"\s+"models\/items\/sniper\/sniper_cape_immortal\/sniper_cape_immortal\.vmdl"/);
  assert.match(patched.block, /"modifier"\s+"particles\/econ\/items\/sniper\/sniper_immortal_cape_golden\/sniper_immortal_cape_golden_headshot_slow\.vpcf"/);
  assert.match(patched.block, /"modifier"\s+"particles\/econ\/items\/sniper\/sniper_immortal_cape_golden\/sniper_immortal_cape_golden_headshot_slow_caster\.vpcf"/);
  assert.match(patched.block, /particles\/econ\/items\/sniper\/sniper_immortal_cape_golden\/sniper_immortal_cape_golden_ambient\.vpcf/);
  assert.match(patched.block, /"type"\s+"ability_icon"/);
  assert.match(patched.block, /"modifier"\s+"sniper_headshot_immortal_gold"/);
  assert.match(patched.block, /particles\/econ\/seasonal\/seasonal_ambient_silver\.vpcf/);
  assert.ok(patched.block.indexOf('sniper_immortal_cape_golden_ambient.vpcf') < patched.block.indexOf('seasonal_ambient_silver.vpcf'));
  assert.ok(patched.block.indexOf('seasonal_ambient_silver.vpcf') < patched.block.indexOf('sniper_headshot_slow_caster.vpcf'));
  assert.doesNotMatch(patched.block, /"unlock"/);
  assert.doesNotMatch(patched.block, /"styles"/);
  assert.deepEqual(patched.assetCopies, [
    {
      from: 'models/items/sniper/sniper_cape_immortal/sniper_cape_immortal.vmdl',
      to: 'models/heroes/sniper/cape.vmdl',
    },
    {
      from: 'particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow.vpcf',
      to: 'particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf',
    },
    {
      from: 'particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow_caster.vpcf',
      to: 'particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf',
    },
  ]);

  const out = schema.mergeSchema(text, [{ id: patched.id, block: patched.block, source: 'items' }]);
  assert.equal(out.applied.length, 1);
  const merged = schema.findItem(out.text, '282');
  assert.ok(merged);
  assert.match(merged.text, /seasonal_ambient_silver\.vpcf/);
  assert.match(merged.text, /models\/items\/sniper\/sniper_cape_immortal\/sniper_cape_immortal\.vmdl/);
});

test('game asset entries read donor bytes from pak01 and buildSchemaVpk packs them under stock paths', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-schema-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dota', 'pak01_dir.vpk'), vpk.buildVpk([
    entry('models/items/sniper/sniper_cape_immortal/sniper_cape_immortal.vmdl_c', 'donor model bytes'),
    entry('particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow.vpcf_c', 'slow bytes'),
    entry('particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow_caster.vpcf_c', 'caster bytes'),
  ]));

  const extras = builder.gameAssetEntries(dir, [
    { from: 'models/items/sniper/sniper_cape_immortal/sniper_cape_immortal.vmdl', to: 'models/heroes/sniper/cape.vmdl' },
    { from: 'particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow.vpcf', to: 'particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf' },
    { from: 'particles/econ/items/sniper/sniper_immortal_cape_golden/sniper_immortal_cape_golden_headshot_slow_caster.vpcf', to: 'particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf' },
  ]);
  assert.deepEqual(extras.map((en) => vpk.entryPath(en)), [
    'models/heroes/sniper/cape.vmdl_c',
    'particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf_c',
    'particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf_c',
  ]);

  const buf = schema.buildSchemaVpk(large(1200), extras);
  const paths = vpk.listVpkPaths(buf).sort();
  assert.ok(paths.includes('scripts/items/items_game.txt'));
  assert.ok(paths.includes('models/heroes/sniper/cape.vmdl_c'));
  assert.ok(paths.includes('particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf_c'));
  assert.ok(paths.includes('particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf_c'));

  const packed = new Map(vpk.readVpkEntries(buf).map((en) => [vpk.entryPath(en), en.data.toString('latin1')]));
  assert.equal(packed.get('models/heroes/sniper/cape.vmdl_c'), 'donor model bytes');
  assert.equal(packed.get('particles/units/heroes/hero_sniper/sniper_headshot_slow.vpcf_c'), 'slow bytes');
  assert.equal(packed.get('particles/units/heroes/hero_sniper/sniper_headshot_slow_caster.vpcf_c'), 'caster bytes');
});

test('a pick carries several effects in one order, and an effect nobody offers refuses it', () => {
  // The window offers several ("Effects (you can pick several)") and sent them as "fire,snow" to
  // a build that looked for one effect by that name. The pick failed there, and the failure was
  // swallowed with the other free cosmetics' ones: the window said installed, the game got nothing.
  const text = itemWearableTable();
  assert.equal(builder.effectKey('snow,fire'), 'fire,snow', 'the order the list offers them in');
  assert.equal(builder.effectKey(['FIRE', ' fire ', 'snow']), 'fire,snow', 'each once, whatever the case');
  assert.equal(builder.effectKey(''), '');
  assert.equal(builder.effectKey(null), '');

  const both = builder.itemEffectPatch(text, '9455', 'snow,fire');
  const count = (needle) => both.block.split(needle).length - 1;
  assert.equal(count('courier_trail_lava.vpcf'), 1, 'fire, once');
  assert.equal(count('seasonal_ambient_snow.vpcf'), 1, 'snow, once');
  assert.throws(() => builder.itemEffectPatch(text, '9455', 'fire,sparkles'), /sparkles/);
});

test('choosing other effects for the same item changes its row instead of adding one', (t) => {
  // My mods showed three rows reading "Blightfall - Head" for one item picked with fire, then
  // snow, then nothing, and nothing on them said which was which.
  const { createSchemaService } = require('../src/schema-service.js');
  const { Library } = require('../src/library.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-picks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const library = new Library(dir);
  const values = { dotaGamePath: null }; // no game: the pick is recorded, nothing is written
  const settings = { get: (k) => values[k], set: (k, v) => { values[k] = v; } };
  const service = createSchemaService({ settings, library, installer: {}, userDataDir: dir });
  const slot = 'item:abaddon:head';
  const picks = () => library.list().filter((r) => r.categoryId === 'cosmetic');

  const first = service.pickCosmetic(slot, '19416', 'Blightfall - Head', 'fire');
  service.pickCosmetic(slot, '19416', 'Blightfall - Head', 'snow,fire');
  service.pickCosmetic(slot, '19416', 'Blightfall - Head', '');
  assert.equal(picks().length, 1, 'one row for one item');
  assert.equal(picks()[0].id, first.id);
  assert.equal(picks()[0].effectId, undefined, 'its effects are the last ones chosen');
  service.pickCosmetic(slot, '19416', 'Blightfall - Head', 'snow,fire');
  assert.equal(picks()[0].effectId, 'fire,snow');

  // another item for the same slot is another pick, and the first one waits switched off
  service.pickCosmetic(slot, '7365', 'Compendium Rider of Avarice Helmet', 'ghost');
  assert.deepEqual(picks().map((r) => [r.itemId, r.enabled !== false, r.effectId || '']).sort(),
    [['19416', false, 'fire,snow'], ['7365', true, 'ghost']]);
  // back to the first: its row again, with the effects asked for now
  service.pickCosmetic(slot, '19416', 'Blightfall - Head', 'bubbles');
  assert.equal(picks().length, 2);
  assert.deepEqual(picks().find((r) => r.itemId === '19416'), { ...picks().find((r) => r.itemId === '19416'), enabled: true, effectId: 'bubbles' });
});

/** The builder's table with sets on top: what a set holds, as items_game lists it. */
function itemSetTable() {
  const block = (id, name, prefab, hero, extra = '') => `\t\t"${id}"
\t\t{
\t\t\t"name"\t\t"${name}"
\t\t\t"prefab"\t\t"${prefab}"
${extra}\t\t\t"used_by_heroes"
\t\t\t{
\t\t\t\t"npc_dota_hero_${hero}"\t\t"1"
\t\t\t}
\t\t}
`;
  const bundle = (id, name, hero, pieces) => block(id, name, 'bundle', hero,
    `\t\t\t"bundle"\n\t\t\t{\n${pieces.map((p) => `\t\t\t\t"${p}"\t\t"1"\n`).join('')}\t\t\t}\n`);
  return itemWearableTable().replace(/\t}\n}\n$/, [
    block('9951', 'Sniper Spare Cape', 'wearable', 'sniper', '\t\t\t"item_slot"\t\t"back"\n'),
    block('9952', 'Sniper Loading Screen', 'loading_screen', 'sniper'),
    block('9954', 'Sniper Third Cape', 'wearable', 'sniper', '\t\t\t"item_slot"\t\t"back"\n'),
    // no item_slot, and a name that reads like a helmet: the game puts it in the hand
    block('9953', 'Bloodseeker Headmaster Wand', 'wearable', 'bloodseeker'),
    bundle('9960', 'Sniper Set', 'sniper',
      ['Golden Full-Bore Bonanza', 'No visuals here', 'Sniper Persona Gun', 'Sniper Loading Screen', 'Sniper Spare Cape']),
    bundle('9961', 'Bloodseeker Set', 'bloodseeker', ['Bloodseeker Headmaster Wand']),
    bundle('9962', 'Axe Set', 'axe', ['Unsupported back']),
    // a store bundle of several sets: more pieces want a taken slot than fit
    bundle('9963', 'Sniper Big Bundle', 'sniper', ['Golden Full-Bore Bonanza', 'Sniper Spare Cape', 'Sniper Third Cape']),
    bundle('9964', 'Sniper Set DO NOT USE', 'sniper', ['Golden Full-Bore Bonanza']),
  ].join('') + '\t}\n}\n');
}

test('a wearable that names no slot is a weapon, as the game reads it', () => {
  // Guessed from its words, Oblivion Headmaster Wand went on the head and Emerald Frenzy
  // Flail on the back, and 99 weapons went nowhere. The game's "wearable" prefab says weapon.
  const text = itemSetTable();
  const wand = schema.listItems(text).find((i) => i.name === 'Bloodseeker Headmaster Wand');
  assert.equal(schema.inferredItemSlot(wand), 'weapon');
  const slot = builder.itemSlots(text).find((s) => s.options.some((o) => o.id === '9953'));
  assert.equal(slot.slot, 'item:bloodseeker:weapon');
});

test('a set lists the hero items the builder puts on, and says why it leaves one out', () => {
  const sets = builder.itemSets(itemSetTable());
  assert.deepEqual(sets.map((s) => s.name), ['Bloodseeker Set', 'Sniper Set'],
    'left out: a set with nothing to put on, a bundle of several sets, one Valve marks DO NOT USE');
  const sniper = sets.find((s) => s.name === 'Sniper Set');
  assert.equal(sniper.heroLabel, 'Sniper');
  assert.equal(sniper.fit, 2);
  // the loading screen is not a hero item: not listed, not counted
  assert.deepEqual(sniper.pieces.map((p) => [p.name, p.fits, p.slot || p.reason]), [
    ['Golden Full-Bore Bonanza', true, 'item:sniper:back'],
    ['No visuals here', true, 'item:sniper:head'],
    ['Sniper Persona Gun', false, 'an arcana or persona: the builder leaves those alone'],
    ['Sniper Spare Cape', false, 'a second item for the same slot'],
  ]);
  assert.equal(builder.itemSlots(itemSetTable()).some((s) => s.equipSlot === 'bundle'), false, 'a set is not a slot');
});

test('a whole set goes on in one write, a row per piece, and a piece already on keeps its effects', (t) => {
  const { createSchemaService } = require('../src/schema-service.js');
  const { Library } = require('../src/library.ts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-sets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), vpk.buildVpk([entry(schema.SCHEMA_REL, itemSetTable())]));
  const library = new Library(path.join(dir, 'lib'));
  // schemaPatch off: every write the service makes takes the table away and clears the stamp
  const values = { dotaGamePath: game, schemaPatch: false };
  let writes = 0;
  const settings = { get: (k) => values[k], set: (k, v) => { if (k === 'schemaStamp') writes++; values[k] = v; } };
  const service = createSchemaService({ settings, library, installer: {}, userDataDir: dir });
  const picks = () => library.list().filter((r) => r.categoryId === 'cosmetic' && r.enabled !== false);

  service.pickCosmetic('item:sniper:head', '9457', 'No visuals here', 'fire,snow');
  service.pickCosmetic('item:sniper:back', '9951', 'Sniper Spare Cape', 'ghost');
  writes = 0;
  const res = service.pickSet('9960');
  assert.deepEqual(res, { applied: 2, pieces: 4 });
  assert.equal(writes, 1, 'one write for the whole set');
  assert.deepEqual(picks().map((r) => [r.slot, r.itemId, r.effectId || '']).sort(), [
    ['item:sniper:back', '9455', ''], // the set's cape in place of the spare one, and no effects with it
    ['item:sniper:head', '9457', 'fire,snow'], // already on: keeps what it had
  ]);
  assert.throws(() => service.pickSet('404'), /Set not found/);
});
