/* The main menu background of the user's own (issue #418): a WebM behind the menu, dimmed and
 * blurred as they chose, in a pak made out of the game's own layouts.
 *
 * The menu's background is a Panorama panel, DOTADashboardBackgroundManager, which picks one of
 * several backgrounds (the event's, the last match's...). Mods in the catalog do this by hand: the
 * manager told to show the last match's background, and that background given a movie. This does
 * the same to the compiled layouts of the player's own game, read out of pak01 and written back
 * with one change each, so nothing else in them is a copy of an older patch:
 *
 * - dashboard.vxml_c and dashboard_background_manager.vxml_c: the manager's override-background
 *   set to DOTADashboardBackgroundLastMatch, where the manager is made and in its own layout;
 * - dashboard_background_last_match.vxml_c: every panel of it hidden, and a MoviePanel playing
 *   the WebM put over them, with a black panel over it for the dimming.
 *
 * A compiled layout keeps its panels as a tree in the LaCo block, binary KV3 (src/kv3.ts); the
 * styles are inline, so no stylesheet is compiled. The WebM goes into the pak as it is: the
 * game's movie panel plays a file from the archive by its path. A Dota update can change any of
 * the three layouts, so the record is built again from the new ones (src/menu-background-service.ts).
 */
import { readKv3, type Kv3Block, type Kv3Node } from './kv3.ts';
import { writeKv3 } from './kv3-write.ts';
import { resourceBlock } from './resource.ts';
import { buildVpk, entryAt, type VpkIndex } from './vpk.ts';
import { t } from './i18n.ts';

/** Where the movie sits in the pak, and the files the pak replaces. */
export const MOVIE = 'd2mm/menu_background.webm';
export const LAYOUTS = {
  dashboard: 'panorama/layout/dashboard.vxml_c',
  manager: 'panorama/layout/dashboard_background_manager.vxml_c',
  lastMatch: 'panorama/layout/dashboard_background_last_match.vxml_c',
} as const;
const SHOWN = 'DOTADashboardBackgroundLastMatch';

/** How the movie is shown: how dark the veil over it is (0 to 0.9) and how blurred (0 to 20 px). */
export interface BackgroundLook { dim: number; blur: number }

type Obj = Extract<Kv3Node, { kind: 'object' }>;
const str = (value: string): Kv3Node => ({ kind: 'string', value });
const obj = (o: Record<string, Kv3Node>): Obj => ({ kind: 'object', members: new Map(Object.entries(o)) });
const field = (n: Kv3Node | undefined, k: string): string | undefined => {
  const v = n?.kind === 'object' ? n.members.get(k) : undefined;
  return v?.kind === 'string' ? v.value : undefined;
};

/** A panel's attribute as the compiler writes one: a name and its value under it. */
export const attribute = (name: string, value: string): Obj =>
  obj({ eType: str('PANEL_ATTRIBUTE'), name: str(name), child: obj({ eType: str('PANEL_ATTRIBUTE_VALUE'), name: str(value) }) });

/** A node's children as a list that can be changed: one child alone is stored as `child`, more as `vecChildren`. */
export function children(node: Obj): Kv3Node[] {
  const m = node.members;
  const list = m.get('vecChildren');
  if (list?.kind === 'array') return list.items;
  const one = m.get('child');
  const items = one ? [one] : [];
  m.delete('child');
  m.set('vecChildren', { kind: 'array', items, type: 8 });
  return items;
}

/** Every panel of this name anywhere in the layout. */
export function panels(root: Kv3Node, name: string, out: Obj[] = []): Obj[] {
  if (root.kind === 'object') {
    if (field(root, 'eType') === 'PANEL' && field(root, 'name') === name) out.push(root);
    for (const v of root.members.values()) panels(v, name, out);
  } else if (root.kind === 'array') {
    for (const v of root.items) panels(v, name, out);
  }
  return out;
}

/** The attribute `name` of a panel set to `value`, in place of the one it had. */
export function setAttribute(panel: Obj, name: string, value: string): void {
  const list = children(panel);
  const had = list.findIndex((c) => field(c, 'eType') === 'PANEL_ATTRIBUTE' && field(c, 'name') === name);
  if (had >= 0) list[had] = attribute(name, value);
  else list.push(attribute(name, value));
}

/** The compiled layout with its LaCo tree changed by `change`. */
function rewrite(file: Buffer, change: (kv: Kv3Block) => void): Buffer {
  const laco = resourceBlock(file, 'LaCo');
  const kv = readKv3(laco.data);
  change(kv);
  return laco.replace(writeKv3(kv));
}

/** The veil's colour: black, as opaque as the dimming. */
export const veil = (dim: number): string => `#000000${Math.round(Math.min(Math.max(dim, 0), 0.9) * 255).toString(16).padStart(2, '0')}`;

/** The panels the last match's background gets: the movie, then the veil over it. */
function moviePanels(look: BackgroundLook, like: Obj): Obj[] {
  const blur = Math.round(Math.min(Math.max(look.blur, 0), 20));
  const panel = (name: string, attrs: Obj[]): Obj => obj({
    eType: str('PANEL'), name: str(name), vecChildren: { kind: 'array', items: attrs, type: 8 },
    ...(like.members.get('sourceLineColumn') ? { sourceLineColumn: like.members.get('sourceLineColumn')! } : {}),
  });
  const fill = 'width: 100%; height: 100%; horizontal-align: center; vertical-align: center;';
  return [
    panel('MoviePanel', [attribute('id', 'D2MMBackground'), attribute('src', `s2r://${MOVIE}`), attribute('repeat', 'true'),
      attribute('autoplay', 'onload'), attribute('hittest', 'false'), attribute('style', `${fill}${blur ? ` blur: gaussian( ${blur} );` : ''}`)]),
    panel('Panel', [attribute('id', 'D2MMBackgroundDim'), attribute('hittest', 'false'), attribute('style', `${fill} background-color: ${veil(look.dim)};`)]),
  ];
}

/** The three layouts with the movie in them, out of the game's own. */
export function backgroundLayouts(read: (file: string) => Buffer | null, look: BackgroundLook): { path: string; data: Buffer }[] {
  const get = (file: string) => {
    const b = read(file);
    if (!b) throw new Error(t('В игре нет файла {0}', file));
    return b;
  };
  const point = (kv: Kv3Block) => {
    const found = panels(kv.root, 'DOTADashboardBackgroundManager');
    if (!found.length) throw new Error(t('В игре нет панели фона меню'));
    for (const p of found) setAttribute(p, 'override-background', SHOWN);
  };
  const lastMatch = rewrite(get(LAYOUTS.lastMatch), (kv) => {
    const root = panels(kv.root, SHOWN)[0];
    if (!root) throw new Error(t('В игре нет панели фона меню'));
    const list = children(root);
    const own = list.filter((c) => field(c, 'eType') === 'PANEL') as Obj[];
    // hidden rather than removed: the panel's code finds its children by id
    for (const c of own) setAttribute(c, 'style', 'visibility: collapse;');
    const first = own[0] ?? root;
    list.splice(own.length ? list.indexOf(first) + 1 : list.length, 0, ...moviePanels(look, first));
  });
  return [
    { path: LAYOUTS.dashboard, data: rewrite(get(LAYOUTS.dashboard), point) },
    { path: LAYOUTS.manager, data: rewrite(get(LAYOUTS.manager), point) },
    { path: LAYOUTS.lastMatch, data: lastMatch },
  ];
}

const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/** Why these bytes cannot be the menu's movie, or null: a WebM, with a VP8 or VP9 track. */
export function webmProblem(webm: Buffer, max = 48 * 1024 * 1024): string | null {
  if (webm.length < 64 || !webm.subarray(0, 4).equals(EBML)) return t('Это не WebM');
  if (!webm.subarray(0, 256).includes('webm')) return t('Это не WebM');
  if (webm.length > max) return t('Фон больше {0} МБ', Math.round(max / 1024 / 1024));
  const head = webm.subarray(0, Math.min(webm.length, 4096));
  if (!head.includes('V_VP9') && !head.includes('V_VP8')) return t('В WebM нет видео VP8 или VP9');
  return null;
}

/** The pak: the three layouts and the movie. */
export function buildBackground(ix: Pick<VpkIndex, 'read'>, webm: Buffer, look: BackgroundLook): Buffer {
  const why = webmProblem(webm);
  if (why) throw new Error(why);
  const layouts = backgroundLayouts((f) => ix.read(f), look);
  return buildVpk([...layouts.map((l) => entryAt(l.path, l.data)), entryAt(MOVIE, webm)]);
}
