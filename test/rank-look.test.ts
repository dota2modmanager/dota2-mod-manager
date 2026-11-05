/* The rank medal and hero levels of the player's own screen: the medal's rules added to the two
 * styles, the levels script, its include put into the layouts (src/rank-look.ts), and the record in
 * My mods that keeps them (src/rank-look-service.ts). The layouts here have the shape the game's
 * compiled ones have; Valve's own files cannot be committed. The two tools are functions:
 * ValveResourceFormat hands back CSS, the compiler hands back what it was given. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryAt, openVpkIndex } from '../src/vpk.ts';
import { readKv3, type Kv3Node } from '../src/kv3.ts';
import { resourceBlock } from '../src/resource.ts';
import { clampLook, LAYOUTS, medalImage, SCRIPT, STYLES, tierOf, withMedal, withScript } from '../src/rank-look.ts';
import { levelsScript } from '../src/rank-look-script.ts';
import { createRankLook } from '../src/rank-look-service.ts';
import { encodeKv3, resource, type V } from './helpers/kv3-build.ts';
import type { CompileJob } from '../src/resource-compiler.ts';

const s = (str: string): V => ({ str });
const layout = (...body: V[]): Buffer => resource([['RED2', Buffer.from('editor')], ['DATA', Buffer.alloc(6)],
  ['LaCo', encodeKv3({ obj: [['m_AST', { obj: [['m_pRoot', { obj: [['eType', s('ROOT')], ['vecChildren', { arr: body }]] }]] }]] })]]);
const styles = (): V => ({ obj: [['eType', s('STYLES')]] });
const panel = (name: string): V => ({ obj: [['eType', s('PANEL')], ['name', s(name)]] });

/** The ROOT's children of a compiled layout, by eType, and every name a REFERENCE_COMPILED gives. */
function shape(file: Buffer): { kinds: string[]; refs: string[] } {
  const kv = readKv3(resourceBlock(file, 'LaCo').data);
  const str = (n: Kv3Node | undefined, k: string) => {
    const v = n?.kind === 'object' ? n.members.get(k) : undefined;
    return v?.kind === 'string' ? v.value : '';
  };
  const refs: string[] = [];
  const walk = (n: Kv3Node) => {
    if (n.kind === 'object') {
      if (str(n, 'eType') === 'REFERENCE_COMPILED') refs.push(str(n, 'name'));
      for (const v of n.members.values()) walk(v);
    } else if (n.kind === 'array') n.items.forEach(walk);
  };
  walk(kv.root);
  const root = (kv.root as { members: Map<string, Kv3Node> }).members.get('m_AST') as { members: Map<string, Kv3Node> };
  const list = (root.members.get('m_pRoot') as { members: Map<string, Kv3Node> }).members.get('vecChildren') as { items: Kv3Node[] };
  return { kinds: list.items.map((c) => str(c, 'eType')), refs };
}

const CSS = `/* Prettified by Source 2 Viewer 20.1.0.0 - https://valveresourceformat.github.io */

.RankTier3 .RankTierImage
{
\tbackground-image: url("s2r://panorama/images/rank_tier_icons/rank3_psd.vtex");
}

.RankTier3 .RankTierImage.Minimal
{
\tbackground-image: url("s2r://panorama/images/rank_tier_icons/mini/rank3_psd.vtex");
}

.RankPips0 .RankPipImage
{
\tvisibility: collapse;
}

.RankPips2 .RankPipImage
{
\tbackground-image: url("s2r://panorama/images/rank_tier_icons/pip2_psd.vtex");
}

.Other
{
\twidth: 10px;
}
`;

test('a medal is copied onto every rule that draws one, small where it is drawn small, with its stars', () => {
  const out = withMedal(CSS, { tier: 7, stars: 4, top: 0 });
  assert.doesNotMatch(out, /Source 2 Viewer/);
  const added = out.slice(out.indexOf('/* d2mm: rank medal */'));
  assert.match(added, /\.RankTier3 \.RankTierImage\n\{\n\tbackground-image: url\("s2r:\/\/panorama\/images\/rank_tier_icons\/rank7_psd\.vtex"\);/);
  assert.match(added, /\.RankTier3 \.RankTierImage\.Minimal\n\{\n\tbackground-image: url\("s2r:\/\/panorama\/images\/rank_tier_icons\/mini\/rank7_psd\.vtex"\);/);
  assert.match(added, /\.RankPips2 \.RankPipImage\n\{\n\tbackground-image: url\("[^"]*pip4_psd\.vtex"\);\n\tvisibility: visible;/);
  assert.match(added, /\.RankPips0 \.RankPipImage\n\{\n\tbackground-image: url\("[^"]*pip4_psd\.vtex"\);/, 'an uncalibrated rank shows the stars too');
  assert.doesNotMatch(added, /\.Other/, 'a rule with no medal in it is left alone');
  // built again from its own output: the old rules go, the new ones take their place
  const twice = withMedal(out, { tier: 8, stars: 1, top: 10 });
  assert.equal(twice.match(/d2mm: rank medal/g)?.length, 1);
  assert.match(twice, /rank8c_psd\.vtex[\s\S]*rank8c_mini_psd\.vtex/);
  assert.match(twice.slice(twice.indexOf('d2mm')), /\.RankPips2 \.RankPipImage\n\{\n\tvisibility: collapse;/, 'an Immortal has no stars');
});

test('the medal pictures are the game’s own names, the Immortal places included', () => {
  assert.equal(medalImage({ tier: 0, stars: 1, top: 0 }, false), 's2r://panorama/images/rank_tier_icons/rank0_psd.vtex');
  assert.equal(medalImage({ tier: 8, stars: 1, top: 0 }, true), 's2r://panorama/images/rank_tier_icons/mini/rank8_psd.vtex');
  assert.equal(medalImage({ tier: 8, stars: 1, top: 5000 }, false), 's2r://panorama/images/rank_tier_icons/rank8a_psd.vtex');
  assert.equal(medalImage({ tier: 8, stars: 1, top: 100 }, true), 's2r://panorama/images/rank_tier_icons/rank8b_mini_psd.vtex');
});

test('what the window sends is kept to what the game has', () => {
  assert.deepEqual(clampLook({ medal: { tier: 3, stars: 9, top: 10 }, levels: { axe: 30, antimage: 0, '../x': 5, lina: 12.5, juggernaut: '17' }, every: 31 }),
    { medal: { tier: 3, stars: 1, top: 0 }, levels: { axe: 30, juggernaut: 17 }, every: null });
  assert.deepEqual(clampLook({ medal: { tier: 8, top: 100 }, every: 5 }), { medal: { tier: 8, stars: 1, top: 100 }, levels: {}, every: 5 });
  assert.deepEqual(clampLook('nonsense'), { medal: null, levels: {}, every: null });
  assert.deepEqual([1, 5, 6, 25, 26, 30].map(tierOf), [0, 0, 1, 4, 5, 5]);
});

test('the script knows the levels and the medal, in the game’s own words', () => {
  const js = levelsScript({ medal: { tier: 7, stars: 5, top: 0 }, levels: { axe: 30 }, every: 12 });
  assert.match(js, /var D2MM_LEVELS = \{"axe":30\};/);
  assert.match(js, /var D2MM_EVERY = 12;/);
  assert.match(js, /\$\.Localize\("#DOTARankTierName7"\) \+ \$\.Localize\("#DOTARankPipsName5"\)/);
  assert.match(levelsScript({ medal: null, levels: {}, every: null }), /var D2MM_RANK = null;/);
  assert.doesNotThrow(() => new Function('$', 'Players', js), 'the script is JavaScript the game can parse');
});

/** A Panorama panel, as much of one as the script touches. */
interface Fake { id: string; paneltype: string; classes: Set<string>; kids: Fake[]; text: string; heroname?: string; heroid?: number; herolevel?: number; visible: boolean; vars: Record<string, number>; style?: Record<string, string | null> }
const fake = (paneltype: string, id = '', classes: string[] = [], kids: Fake[] = [], extra: Partial<Fake> = {}): Fake => ({ id, paneltype, classes: new Set(classes), kids, text: '', visible: true, vars: {}, ...extra });
const all = (p: Fake): Fake[] => p.kids.flatMap((k) => [k, ...all(k)]);
/** The match the script is in: the local player's hero and the unit in the portrait, which is that hero unless said. */
interface Match { hero: string; portraitOwn?: boolean }
const MENU: Match = { hero: '' };
/** Runs the script on `root`, then `between` before each of the next ticks; returns what it said in the console. */
function runScript(js: string, root: Fake, ...between: (() => void)[]): string[] { return runIn(MENU, js, root, ...between); }
function runIn(match: Match, js: string, root: Fake, ...between: (() => void)[]): string[] {
  const said: string[] = [];
  // the game hands a script the same object for the same panel each time
  const seen = new WeakMap<Fake, unknown>();
  const api = (p: Fake): unknown => seen.get(p) ?? (seen.set(p, wrap(p)), seen.get(p));
  const wrap = (p: Fake): unknown => new Proxy(p, { get: (t, k) => ({
    FindChildTraverse: (id: string) => { const f = all(t).find((c) => c.id === id); return f ? api(f) : null; },
    FindChildrenWithClassTraverse: (c: string) => all(t).filter((x) => x.classes.has(c)).map(api),
    SetHasClass: (c: string, on: boolean) => { if (on) t.classes.add(c); else t.classes.delete(c); },
    BHasClass: (c: string) => t.classes.has(c),
    SetDialogVariableInt: (n: string, v: number) => { t.vars[n] = v; },
    GetChildCount: () => t.kids.length,
    GetChild: (i: number) => api(t.kids[i]),
  } as Record<string | symbol, unknown>)[k] ?? Reflect.get(t, k) });
  const names: Record<string, string> = { '#npc_dota_hero_axe': 'Axe', '#npc_dota_hero_lina': 'Lina' };
  let next: (() => void) | null = null;
  const $ = { GetContextPanel: () => api(root), Localize: (s: string) => names[s] ?? s, Schedule: (_: number, f: () => void) => { next = f; }, Msg: (m: string) => said.push(m) };
  const players = { GetLocalPlayer: () => 3, GetPlayerSelectedHero: () => match.hero, GetLocalPlayerPortraitUnit: () => 400 };
  const entities = { IsRealHero: () => true, GetPlayerOwnerID: () => (match.portraitOwn === false ? 7 : 3) };
  new Function('$', 'Players', 'Entities', js)($, players, entities);
  for (const step of between) { step(); (next as (() => void) | null)?.(); }
  return said;
}

test('a hero card takes the level into the variable its label is bound to, by name or by number', () => {
  const card = (img: Partial<Fake>) => {
    const label = fake('Label', 'HeroBadgeLevel');
    return { label, panel: fake('Panel', '', ['HeroCard'], [fake('DOTAHeroImage', 'HeroImage', [], [], img), fake('Panel', 'HeroBadgeStatus', [], [label])]) };
  };
  const byName = card({ heroname: 'npc_dota_hero_axe' });
  const byNumber = card({ heroname: '', heroid: 2 });
  const other = card({ heroname: '', heroid: 25 });
  const said = runScript(levelsScript({ medal: null, levels: { axe: 23 }, every: null }, { 2: 'axe' }), fake('Panel', '', [], [byName.panel, byNumber.panel, other.panel]));
  for (const c of [byName, byNumber]) {
    assert.equal(c.label.text, '23');
    assert.equal(c.label.vars.hero_badge_level, 23);
    assert.ok(c.panel.classes.has('MasterTier'));
  }
  assert.equal(other.label.text, '', 'a hero with no level keeps the game’s');
  assert.deepEqual(said, ['d2mm rank look: hero grid: 3 cards, the first npc_dota_hero_axe #undefined']);
});

test('the hero page shows the chosen level on its badges and hides the real experience', () => {
  const page = (name: string) => {
    const level = fake('Label');
    const progress = fake('Label');
    const xp = [fake('Label', '', ['CurrentLevelXPLabel']), fake('Label', '', ['NextLevelXPLabel']), fake('ProgressBar', 'HeroLevelProgress')];
    const root = fake('DOTAHeroPageNewV2', '', [], [
      fake('Label', '', ['TabContentsHeroName'], [], { text: name }),
      fake('DOTAHeroBadge', 'HeroBadge', [], [fake('DOTAHeroBadge', '', ['ModelStyle'], [fake('DOTAScenePanel', 'RankScene'), level])]),
      fake('Panel', '', [], xp),
      fake('DOTAPlusHeroPageV2', '', [], [fake('DOTAHeroBadge', 'HeroBadgeProgression', [], [fake('DOTAHeroBadge', '', ['ModelStyle'], [progress])])]),
    ]);
    return { root, level, progress, xp };
  };
  const axe = page('Axe');
  runScript(levelsScript({ medal: null, levels: { axe: 8 }, every: null }), axe.root);
  assert.equal(axe.level.text, '8');
  assert.equal(axe.level.vars.hero_level, 8);
  assert.equal(axe.progress.text, '8', 'the progress tab’s badge too');
  assert.deepEqual(axe.xp.map((p) => p.visible), [false, false, false]);
  const lina = page('Lina');
  runScript(levelsScript({ medal: null, levels: { axe: 8 }, every: null }), lina.root);
  assert.equal(lina.level.text, '', 'a hero with no level of its own keeps the game’s');
  assert.deepEqual(lina.xp.map((p) => p.visible), [true, true, true]);
  const every = page('Lina');
  runScript(levelsScript({ medal: null, levels: { axe: 8 }, every: 30 }), every.root);
  assert.equal(every.level.text, '30');
});

test('the card over a hero takes its level, and a part that breaks says so once', () => {
  const level = fake('Label');
  const tip = fake('Panel', '', ['HeroCardTooltipContents'], [fake('DOTAHeroImage', 'HeroImage', [], [], { heroid: 2 }), fake('DOTAHeroBadge', 'HeroBadge', [], [fake('DOTAHeroBadge', '', ['LevelStyle'], [level])])]);
  runScript(levelsScript({ medal: null, levels: { axe: 12 }, every: null }, { 2: 'axe' }), tip);
  assert.equal(level.text, '12');
  assert.ok(tip.kids[1].classes.has('GoldTier'));
  const broken = fake('DOTAHeroPageNewV2', '', [], [fake('Label', '', ['TabContentsHeroName'], [], { text: 'Axe' }), fake('DOTAHeroBadge', 'HeroBadge')]);
  Object.defineProperty(broken.kids[1], 'classes', { get: () => { throw new Error('renamed'); } });
  const said = runScript(levelsScript({ medal: null, levels: { axe: 8 }, every: null }), broken);
  assert.ok(said.some((m) => /hero page failed: Error: renamed/.test(m)), said.join('\n'));
});

test('a badge that takes a level is given it, and gets the game’s back when its hero has none', () => {
  const name = fake('Label', '', ['TabContentsHeroName'], [], { text: 'Axe' });
  const badge = fake('DOTAHeroBadge', 'HeroBadge', [], [], { herolevel: 5 });
  const page = fake('DOTAHeroPageNewV2', '', [], [name, badge]);
  const levels: number[] = [];
  runScript(levelsScript({ medal: null, levels: { axe: 30 }, every: null }), page,
    () => { levels.push(badge.herolevel!); badge.herolevel = 2; }, // the game moves on to Lina before the page names her
    () => { levels.push(badge.herolevel!); name.text = 'Lina'; },
    () => { levels.push(badge.herolevel!); name.text = 'Axe'; },
    () => levels.push(badge.herolevel!));
  assert.deepEqual(levels, [30, 30, 2, 30]);
});

test('a badge the game sets back is on the chosen level the next frame', () => {
  const badge = fake('DOTAHeroBadge', 'HeroBadge', [], [], { herolevel: 5 });
  const page = fake('DOTAHeroPageNewV2', '', [], [fake('Label', '', ['TabContentsHeroName'], [], { text: 'Axe' }), badge]);
  const levels: number[] = [];
  const progress = fake('DOTAHeroBadge', 'HeroBadgeProgression', [], [], { herolevel: 5 });
  runScript(levelsScript({ medal: null, levels: { axe: 30 }, every: null }), page,
    () => { badge.herolevel = 5; }, // the game opens the badge on the real level
    () => { levels.push(badge.herolevel!); page.kids.push(progress); }, // the Progress tab opens with a badge of its own
    () => levels.push(progress.herolevel!));
  assert.deepEqual(levels, [30, 30]);
});

test('the include goes in front of the layout’s panel, once', () => {
  const game = layout(styles(), panel('DOTAHeroGrid'));
  const once = withScript(game);
  assert.deepEqual(shape(once), { kinds: ['STYLES', 'SCRIPTS', 'PANEL'], refs: [SCRIPT.ref] });
  assert.deepEqual(shape(withScript(once)), shape(once), 'a layout that has it is left as it is');
});

function world(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-rank-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  fs.mkdirSync(path.join(game, 'dota_russian'), { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([
    ...STYLES.map((st) => entryAt(st.compiled, Buffer.from(st.source))),
    ...LAYOUTS.map((p) => entryAt(p, layout(styles(), panel('Panel')))),
    entryAt('scripts/npc/heroes/npc_dota_hero_axe.txt', Buffer.from('axe')),
    entryAt('scripts/npc/heroes/npc_dota_hero_antimage.txt', Buffer.from('am')),
    entryAt('scripts/npc/heroes/npc_dota_hero_base.txt', Buffer.from('base')),
  ]));
  const userdata = path.join(dir, 'userdata');
  const installer = new Installer({ userDataDir: userdata, getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(userdata);
  const jobs: CompileJob[] = [];
  const rebuilt: string[] = [];
  const service = createRankLook({
    gamePath: () => game, installer, library, vrf: () => 'vrf.exe',
    decompile: async (exe, style) => `${CSS}/* from ${style.toString()} */\n`,
    compile: async (job) => { jobs.push(job); return job.files.map((f) => entryAt(f.path.replace(/\.css$/, '.vcss_c').replace(/\.js$/, '.vjs_c'), f.data)); },
    run: async () => {},
    onRebuilt: (id) => rebuilt.push(id),
  });
  const pak = (rec: { files: { relPath: string }[] }) => openVpkIndex(path.join(installer.langFolder(), rec.files[0].relPath));
  return { service, library, jobs, rebuilt, pak };
}

test('in a match the player’s own hero shows its level on the portrait, the top bar and the player card', () => {
  const lvl = { medal: null, levels: { axe: 30 }, every: null };
  const overlay = () => fake('Panel', 'PortraitHeroBadgeOverlay', [], [], { style: {} });
  const ring = overlay();
  const frame = fake('DOTAUnitHeroBadge', 'unitbadge', ['BronzeTier'], [ring]);
  // the game's panel puts its own tier back between frames; the frame drawn on the overlay stays
  runIn({ hero: 'npc_dota_hero_axe' }, levelsScript(lvl), fake('DOTAHud', 'Hud', [], [fake('Panel', '', [], [frame])]),
    () => { frame.classes.clear(); frame.classes.add('BronzeTier'); });
  assert.match(String(ring.style!.backgroundImage), /portrait_hero_badge_frame_tier_6_psd/);
  const allyRing = overlay();
  const ally = fake('DOTAUnitHeroBadge', 'unitbadge', ['BronzeTier'], [allyRing]);
  runIn({ hero: 'npc_dota_hero_axe', portraitOwn: false }, levelsScript(lvl), fake('DOTAHud', 'Hud', [], [ally]));
  assert.deepEqual([...ally.classes], ['BronzeTier'], 'another player’s unit in the portrait keeps its own frame');
  assert.equal(allyRing.style!.backgroundImage, undefined);
  const bar = (hero: string) => fake('DOTATopBarPlayer', '', ['BronzeTier'], [fake('DOTAHeroImage', 'HeroImage', [], [], { heroname: hero })]);
  const mine = bar('npc_dota_hero_axe');
  const theirs = bar('npc_dota_hero_lina');
  runIn({ hero: 'npc_dota_hero_axe' }, levelsScript(lvl), mine);
  runIn({ hero: 'npc_dota_hero_axe' }, levelsScript(lvl), theirs);
  assert.ok(mine.classes.has('GrandmasterTier'));
  assert.ok(theirs.classes.has('BronzeTier') && !theirs.classes.has('GrandmasterTier'));
  const name = fake('Label', 'HeroName', [], [], { text: 'AXE' });
  const badge = fake('DOTAHeroBadge', 'HeroBadge', [], [], { herolevel: 5 });
  const levels: number[] = [];
  runIn({ hero: 'npc_dota_hero_axe' }, levelsScript(lvl), fake('DOTAHUDInspect', '', [], [badge, name]),
    () => { levels.push(badge.herolevel!); name.text = 'Lina'; badge.herolevel = 12; }, // the card opens on another player
    () => levels.push(badge.herolevel!));
  assert.deepEqual(levels, [30, 12]);
  // in the menu there is no hero of the player's own, and nothing to say about it
  assert.deepEqual(runScript(levelsScript(lvl), fake('DOTAUnitHeroBadge', 'unitbadge')), []);
});

test('a look is one record: both styles with the medal, the script, and the layouts including it', async (t) => {
  const w = world(t);
  assert.deepEqual(w.service.state(), { installed: null, heroes: [{ id: 'antimage', name: 'Anti-Mage' }, { id: 'axe', name: 'Axe' }], vrf: true });
  await assert.rejects(w.service.install({ medal: null, levels: {}, every: null }), /медаль|medal/i);
  const rec = await w.service.install({ medal: { tier: 6, stars: 2, top: 0 }, levels: { axe: 30 }, every: null });
  assert.equal(rec.categoryId, 'ranks');
  assert.deepEqual(w.jobs[0].compile, [...STYLES.map((st) => st.source), SCRIPT.source]);
  const ix = w.pak(rec);
  for (const st of STYLES) assert.match(ix.read(st.compiled)!.toString(), new RegExp(`from ${st.source}[\\s\\S]*rank6_psd`));
  assert.match(ix.read(SCRIPT.compiled)!.toString(), /"axe":30/);
  for (const p of LAYOUTS) assert.deepEqual(shape(ix.read(p)!).refs, [SCRIPT.ref]);
  // levels alone need no style
  const again = await w.service.install({ medal: null, levels: {}, every: 20 });
  assert.equal(again.id, rec.id);
  assert.deepEqual(w.jobs[1].compile, [SCRIPT.source]);
  assert.equal(w.pak(again).read(STYLES[0].compiled), null);
  assert.deepEqual(w.service.state().installed, { id: rec.id, look: { medal: null, levels: {}, every: 20 }, enabled: true });
});

test('after an update the record is built again in its slot, and says so', async (t) => {
  const w = world(t);
  const rec = await w.service.install({ medal: { tier: 1, stars: 1, top: 0 }, levels: {}, every: null });
  assert.deepEqual(w.service.rebuild(['other']), []);
  assert.deepEqual(w.service.rebuild([rec.id]), []);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(w.rebuilt, [rec.id]);
  assert.equal(w.library.list().length, 1);
});

test('a look built by an older app is built again with this app’s script, once', async (t) => {
  const w = world(t);
  const rec = await w.service.install({ medal: { tier: 1, stars: 1, top: 0 }, levels: {}, every: null });
  assert.equal(w.service.refreshScript(), null, 'built by this app: nothing to do');
  w.library.update(rec.id, { generated: { rank: (rec.generated as { rank: unknown }).rank } });
  assert.equal(w.service.refreshScript(), rec.id);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(w.rebuilt, [rec.id]);
  assert.equal(w.service.refreshScript(), null, 'the new build carries the mark');
});
