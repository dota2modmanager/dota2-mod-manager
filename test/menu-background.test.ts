/* The main menu background of the user's own (issue #418): the game's three layouts written back
 * with the movie in them (src/menu-background.ts), and the record in My mods that keeps it
 * (src/menu-background-service.ts). The layouts here have the shape the game's compiled ones have,
 * a tree of panels in the LaCo block; Valve's own files cannot be committed. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Installer } from '../src/installer.ts';
import { Library } from '../src/library.ts';
import { buildVpk, entryAt, listVpkPathsFile, openVpkIndex } from '../src/vpk.ts';
import { readKv3, type Kv3Node } from '../src/kv3.ts';
import { resourceBlock } from '../src/resource.ts';
import { backgroundLayouts, buildBackground, LAYOUTS, MOVIE, veil, webmProblem } from '../src/menu-background.ts';
import { createMenuBackground } from '../src/menu-background-service.ts';
import { muxWebm } from '../renderer/catalog/background/webm.ts';
import { encodeKv3, resource, type V } from './helpers/kv3-build.ts';

const s = (str: string): V => ({ str });
const at = (name: string, value: string): V => ({ obj: [['eType', s('PANEL_ATTRIBUTE')], ['name', s(name)], ['child', { obj: [['eType', s('PANEL_ATTRIBUTE_VALUE')], ['name', s(value)]] }]] });
const panel = (name: string, kids: V[] = []): V => ({ obj: [['eType', s('PANEL')], ['name', s(name)],
  ...(kids.length === 1 ? [['child', kids[0]] as [string, V]] : kids.length ? [['vecChildren', { arr: kids }] as [string, V]] : [])] });
const layout = (...body: V[]): Buffer => resource([['RED2', Buffer.from('editor')], ['DATA', Buffer.alloc(6)],
  ['LaCo', encodeKv3({ obj: [['m_AST', { obj: [['m_pRoot', { obj: [['eType', s('ROOT')], ['vecChildren', { arr: body }]] }]] }]] })]]);

const GAME = new Map<string, Buffer>([
  [LAYOUTS.dashboard, layout(panel('DOTADashboard', [panel('Panel', [at('id', 'DashboardCore'), panel('DOTADashboardBackgroundManager', [at('id', 'DashboardBackgroundManager')])])]))],
  [LAYOUTS.manager, layout(panel('DOTADashboardBackgroundManager'))],
  [LAYOUTS.lastMatch, layout(panel('DOTADashboardBackgroundLastMatch', [
    panel('DOTAScenePanel', [at('id', 'BackgroundScene'), at('map', 'scenes/dashboard_background/last_match')]),
    panel('Panel', [at('id', 'DetailsContainer')]),
  ]))],
]);

// a WebM as the window makes one: two frames of made-up VP9
const WEBM = Buffer.from(muxWebm({ width: 64, height: 36, duration: 2_000_000, frames: [
  { data: Uint8Array.from([0x82, 0x49, 0x83, 0x42, 0x00]), time: 0, key: true },
  { data: Uint8Array.from([0x86, 0x00]), time: 1_000_000, key: false },
] }));

/** The panel tree of a compiled layout, as plain names: "Panel#id[attr=value,...]" with its children. */
function tree(file: Buffer): unknown {
  const kv = readKv3(resourceBlock(file, 'LaCo').data);
  const v = (n: Kv3Node | undefined, k: string) => (n?.kind === 'object' && n.members.get(k)?.kind === 'string' ? (n.members.get(k) as { value: string }).value : undefined);
  const kids = (n: Kv3Node): Kv3Node[] => {
    if (n.kind !== 'object') return [];
    const list = n.members.get('vecChildren');
    if (list?.kind === 'array') return list.items;
    const one = n.members.get('child');
    return one ? [one] : [];
  };
  const walk = (n: Kv3Node): unknown => {
    if (v(n, 'eType') !== 'PANEL') return null;
    const attrs = Object.fromEntries(kids(n).filter((c) => v(c, 'eType') === 'PANEL_ATTRIBUTE').map((c) => [v(c, 'name'), v((c as { members: Map<string, Kv3Node> }).members.get('child'), 'name')]));
    const sub = kids(n).map(walk).filter(Boolean);
    return { [v(n, 'name')!]: attrs, ...(sub.length ? { children: sub } : {}) };
  };
  const root = (kv.root as { members: Map<string, Kv3Node> }).members.get('m_AST') as { members: Map<string, Kv3Node> };
  return kids(root.members.get('m_pRoot')!).map(walk).filter(Boolean);
}

test('the manager is told to show the last match’s background, where it is made and in its own layout', () => {
  const out = new Map(backgroundLayouts((f) => GAME.get(f) ?? null, { dim: 0.2, blur: 0 }).map((l) => [l.path, l.data]));
  assert.deepEqual(tree(out.get(LAYOUTS.manager)!), [{ DOTADashboardBackgroundManager: { 'override-background': 'DOTADashboardBackgroundLastMatch' } }]);
  const dash = JSON.stringify(tree(out.get(LAYOUTS.dashboard)!));
  assert.match(dash, /"DOTADashboardBackgroundManager":\{"id":"DashboardBackgroundManager","override-background":"DOTADashboardBackgroundLastMatch"\}/);
  assert.match(dash, /"id":"DashboardCore"/, 'everything else in the dashboard stays the game’s');
});

test('the last match’s panels are hidden, not removed, and the movie and its veil go over them', () => {
  const out = new Map(backgroundLayouts((f) => GAME.get(f) ?? null, { dim: 0.5, blur: 6 }).map((l) => [l.path, l.data]));
  const [root] = tree(out.get(LAYOUTS.lastMatch)!) as { children: Record<string, Record<string, string>>[] }[];
  const names = root.children.map((c) => Object.keys(c)[0]);
  assert.deepEqual(names, ['DOTAScenePanel', 'MoviePanel', 'Panel', 'Panel']);
  const [scene, movie, dim, details] = root.children.map((c) => Object.values(c)[0]);
  assert.equal(scene.style, 'visibility: collapse;');
  assert.equal(scene.map, 'scenes/dashboard_background/last_match');
  assert.equal(details.id, 'DetailsContainer');
  assert.equal(details.style, 'visibility: collapse;');
  assert.equal(movie.src, `s2r://${MOVIE}`);
  assert.equal(movie.repeat, 'true');
  assert.match(movie.style, /blur: gaussian\( 6 \)/);
  assert.equal(dim.id, 'D2MMBackgroundDim');
  assert.match(dim.style, /background-color: #00000080;/);
});

test('the veil is never fully black, and the blur stays in reach', () => {
  assert.equal(veil(0), '#00000000');
  assert.equal(veil(5), '#000000e6');
  const out = new Map(backgroundLayouts((f) => GAME.get(f) ?? null, { dim: 0, blur: 99 }).map((l) => [l.path, l.data]));
  assert.match(JSON.stringify(tree(out.get(LAYOUTS.lastMatch)!)), /gaussian\( 20 \)/);
});

test('a game without the layouts, or without the panel, is refused rather than half built', () => {
  assert.throws(() => backgroundLayouts(() => null, { dim: 0, blur: 0 }), /panorama\/layout/);
  const bare = new Map(GAME);
  bare.set(LAYOUTS.lastMatch, layout(panel('Panel')));
  assert.throws(() => backgroundLayouts((f) => bare.get(f) ?? null, { dim: 0, blur: 0 }));
});

test('only a WebM with a VP8 or VP9 track goes in, and the pak holds it as it is', () => {
  assert.equal(webmProblem(WEBM), null);
  assert.ok(webmProblem(Buffer.from('GIF89a........................................................................')));
  assert.ok(webmProblem(Buffer.concat([WEBM.subarray(0, 40), Buffer.alloc(200)])), 'a header with no video track');
  assert.ok(webmProblem(WEBM, 10), 'too large');
  const vpk = buildBackground({ read: (f: string) => GAME.get(f) ?? null }, WEBM, { dim: 0.2, blur: 0 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-bg-'));
  fs.writeFileSync(path.join(dir, 'pak_dir.vpk'), vpk);
  assert.deepEqual(openVpkIndex(path.join(dir, 'pak_dir.vpk')).read(MOVIE), WEBM);
  fs.rmSync(dir, { recursive: true, force: true });
});

function world(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2mm-menu-bg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const game = path.join(dir, 'game');
  const lang = path.join(game, 'dota_russian');
  fs.mkdirSync(lang, { recursive: true });
  fs.mkdirSync(path.join(game, 'dota'), { recursive: true });
  const writeGame = (layouts: Map<string, Buffer>) => fs.writeFileSync(path.join(game, 'dota', 'pak01_dir.vpk'), buildVpk([...layouts].map(([p, b]) => entryAt(p, b))));
  writeGame(GAME);
  const userdata = path.join(dir, 'userdata');
  const installer = new Installer({ userDataDir: userdata, getGamePath: () => game, getLangSuffix: () => 'russian', onProgress: () => {} });
  const library = new Library(userdata);
  const service = createMenuBackground({ gamePath: () => game, userDataDir: userdata, installer, library });
  const paths = (rec: { files: { relPath: string }[] }) => listVpkPathsFile(path.join(lang, rec.files[0].relPath)).sort();
  return { service, library, installer, paths, writeGame, store: path.join(userdata, 'menu-backgrounds') };
}

test('one record: a new background or a new look takes the place of the one before', (t) => {
  const w = world(t);
  assert.deepEqual(w.service.state(), { installed: null });
  assert.throws(() => w.service.install(null, 'x', 0, 0), /GIF/);
  const first = w.service.install(WEBM, 'sunset.mp4', 0.3, 4);
  assert.equal(first.categoryId, 'backgrounds');
  assert.match(first.name, /sunset\.mp4/);
  assert.deepEqual(w.paths(first), [MOVIE, LAYOUTS.dashboard, LAYOUTS.lastMatch, LAYOUTS.manager].sort());
  assert.deepEqual(w.service.state().installed, { id: first.id, source: 'sunset.mp4', dim: 0.3, blur: 4, enabled: true });

  // a new look alone keeps the movie it had
  const again = w.service.install(null, null, 0.6, 0);
  assert.equal(again.id, first.id);
  assert.equal(w.library.list().length, 1);
  assert.deepEqual(w.service.state().installed, { id: first.id, source: 'sunset.mp4', dim: 0.6, blur: 0, enabled: true });

  // a new movie puts the old one's file away
  const other = Buffer.from(muxWebm({ width: 32, height: 18, duration: 1_000_000, frames: [{ data: Uint8Array.from([0x82, 0x49, 0x83, 0x42, 0x01]), time: 0, key: true }] }));
  w.service.install(other, 'loop.gif', 0.2, 0);
  assert.equal(fs.readdirSync(w.store).length, 1);
  assert.equal(w.library.list().length, 1);
  assert.throws(() => w.service.install(Buffer.from('not a movie at all, not even close to one, and long enough to be read'), 'x', 0, 0), /WebM/);
});

test('a Dota update that reached the record builds it again from the new layouts, and leaves it off if it was', (t) => {
  const w = world(t);
  const rec = w.service.install(WEBM, 'sunset.mp4', 0.2, 0);
  w.installer.setEnabled(rec.files, false, rec.id);
  w.library.update(rec.id, { enabled: false });
  const patched = new Map(GAME);
  patched.set(LAYOUTS.dashboard, layout(panel('DOTADashboard', [panel('Panel', [at('id', 'NewCore'), panel('DOTADashboardBackgroundManager')])])));
  w.writeGame(patched);
  assert.deepEqual(w.service.rebuild(['someone-else']), []);
  assert.deepEqual(w.service.rebuild([rec.id]), [rec.id]);
  const after = w.library.list()[0];
  assert.equal(after.enabled, false);
  assert.deepEqual(w.service.state().installed?.enabled, false);
});
