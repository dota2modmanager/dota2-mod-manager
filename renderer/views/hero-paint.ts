/* A hero recoloured part by part (issue #422): the window opened from the hero's window in the item
 * builder. It keeps a switch, a colour and, for a picture, a mode per layer, and the layer the editor
 * works on; the 3D hero in it is painted from those as they change (catalog/paint/preview-paint.ts).
 * Nothing reaches the game until its button is pressed, and then the main process builds one pak
 * for the hero (src/hero-paint-service.ts), a mod in My mods like any other. */
import { refreshInstalledIndex } from '../core/installed.ts';
import { toast } from '../ui/toast.ts';
import { showPaintModal } from '../catalog/modal/root.tsx';
import type { PaintCell, PaintModalModel } from '../catalog/paint/PaintModal.tsx';
import type { PaintLayer } from '../api/content.ts';
import type { PreviewSlot } from '../api/preview3d.ts';
import { closeOverlay } from './catalog/overlay.ts';
import { isOpen, openWindow } from './item-builder.ts';
import { toHex } from '../catalog/arcana/tint.ts';
import { paintValue, splitPaint, type PaintMode } from '../catalog/paint/paint-mode.ts';
import { previewPaint } from '../catalog/paint/preview-paint.ts';
import { editorOf, isPicture, layerLabel, paintSummary } from './hero-paint-model.ts';

/** What the hero wears, as the hero's window shows him: the 3D stage's slots, and the item in each. */
export interface PaintPreview { hero: string; slots: PreviewSlot[]; sig: string; items: Record<string, string> }

export interface PaintState {
  hero: string;
  label: string;
  back: () => void;
  layers: PaintLayer[];
  on: Set<string>;
  colors: Map<string, string>;
  modes: Map<string, PaintMode>;
  /** what is in the game now, to say whether the button changes anything */
  installed: Record<string, string> | null;
  all: string;
  allMode: PaintMode;
  /** the layer the editor works on; null: all that are on */
  selected: string | null;
  busy: boolean;
  vrf: boolean;
  gettingTool: boolean;
  /** his portrait and his abilities' icons, as they come from the game */
  portrait: string | null;
  icons: Record<string, string>;
  gems: { key: string; name: string; hex: string }[];
  preview: PaintPreview | null;
}

const START = '#7f5af0';

/** The hero's window for colours. back: the hero's own window, where it was opened from. */
export async function openPaint(hero: string, label: string, back: () => void, preview: PaintPreview | null = null): Promise<void> {
  const worn = preview ? [...new Set(Object.values(preview.items))] : [];
  const r = await window.api.paint.state(hero, worn);
  if (r.error || !('layers' in r)) { toast(r.error || L`Не удалось прочитать файлы героя`, 'error'); return; }
  const installed = r.installed?.layers ?? null;
  const split = Object.entries(installed || {}).map(([id, v]) => [id, splitPaint(v)] as const);
  const st: PaintState = {
    hero, label, back, layers: r.layers, installed,
    on: new Set(split.map(([id]) => id)),
    colors: new Map(split.map(([id, p]) => [id, p.hex])),
    modes: new Map(split.map(([id, p]) => [id, p.mode])),
    all: split[0]?.[1].hex || START,
    allMode: 'tint',
    selected: null,
    busy: false,
    vrf: r.vrf,
    gettingTool: false,
    portrait: null,
    icons: {},
    gems: [],
    preview,
  };
  openWindow(null, true, (key) => { draw(key, st); void pictures(key, st); });
}

/** The pictures the colours are shown on, and the gems offered: each drawn in as it comes. */
async function pictures(key: number, st: PaintState): Promise<void> {
  const id = st.hero.replace(/^npc_dota_hero_/, '');
  const abilities = [...new Set(st.layers.filter((l) => l.kind === 'ability' || l.kind === 'abilityIcon').map((l) => l.id.slice(l.id.indexOf(':') + 1)))];
  const [portraits, icons, arcana] = await Promise.all([
    window.api.cosmetics.heroPortraits([id], true).catch(() => ({} as Record<string, string>)),
    window.api.paint.icons(abilities).catch(() => ({})),
    window.api.arcana.state().catch(() => null),
  ]);
  st.portrait = portraits[id] || null;
  st.icons = icons;
  st.gems = arcana && !arcana.error ? arcana.gems.map((g) => ({ key: g.key, name: g.name, hex: toHex(g.rgb) })) : [];
  draw(key, st);
}

/** A layer's colour and mode as it would be sent; an effect has no mode. */
const colorOf = (st: PaintState, id: string): { hex: string; mode: PaintMode } => {
  const layer = st.layers.find((l) => l.id === id);
  return { hex: st.colors.get(id) || st.all, mode: layer && isPicture(layer) ? st.modes.get(id) || st.allMode : 'tint' };
};

/** The colours the button would put on: a '#rrggbb[:mode]' for each layer that is on. */
const wanted = (st: PaintState): Record<string, string> =>
  Object.fromEntries(st.layers.filter((l) => st.on.has(l.id)).map((l) => { const c = colorOf(st, l.id); return [l.id, paintValue(c.hex, c.mode)]; }));

const same = (a: Record<string, string>, b: Record<string, string> | null) =>
  !!b && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k]?.toLowerCase() === v.toLowerCase());

const worn = (st: PaintState) => (st.preview ? [...new Set(Object.values(st.preview.items))] : []);

function draw(key: number, st: PaintState): void {
  if (!isOpen(key)) return;
  const cell = (id: string): PaintCell | null => {
    if (!st.layers.some((l) => l.id === id)) return null;
    const c = colorOf(st, id);
    return { id, on: st.on.has(id), color: c.hex, mode: c.mode, selected: st.selected === id };
  };
  const abilities = st.layers.filter((l) => l.kind === 'ability' || l.kind === 'abilityIcon')
    .reduce<{ key: string; name: string }[]>((out, l) => {
      const k = l.id.slice(l.id.indexOf(':') + 1);
      if (!out.some((a) => a.key === k)) out.push({ key: k, name: l.name || k });
      return out;
    }, []);
  const items = st.layers.filter((l) => l.kind === 'item' || l.kind === 'itemModel')
    .reduce<{ key: string; name: string }[]>((out, l) => {
      const k = l.id.slice(l.id.indexOf(':') + 1);
      if (!out.some((a) => a.key === k)) out.push({ key: k, name: l.name || k });
      return out;
    }, []);
  const want = wanted(st);
  const m: PaintModalModel = {
    hero: st.label,
    portrait: st.portrait,
    preview: st.preview && { ...st.preview, paint: previewPaint(st.layers, st.on, (id) => colorOf(st, id), st.preview.items) },
    editor: editorOf(st),
    abilities: abilities.map((a) => ({ key: a.key, name: a.name, picture: st.icons[a.key] || null, effect: cell(`ability:${a.key}`), icon: cell(`abilityIcon:${a.key}`) })),
    own: { effects: cell('effects'), portrait: cell('portrait'), body: cell('body') },
    items: items.map((it) => ({ name: it.name, model: cell(`itemModel:${it.key}`), effect: cell(`item:${it.key}`) })),
    on: st.on.size,
    total: st.layers.length,
    summary: paintSummary(st.layers.filter((l) => st.on.has(l.id)).map(layerLabel)),
    action: !Object.keys(want).length
      ? { label: st.installed ? L`Включи хотя бы один слой` : L`Поставить`, icon: 'format_paint', off: true }
      : same(want, st.installed)
        ? { label: L`Стоит`, icon: 'check', off: true }
        : { label: st.installed ? L`Обновить` : L`Поставить`, icon: 'format_paint' },
    busy: st.busy,
    vrf: st.vrf,
    gettingTool: st.gettingTool,
  };
  const redraw = () => draw(key, st);
  const toggle = (id: string) => {
    if (st.on.has(id)) st.on.delete(id);
    else { st.on.add(id); st.selected = id; }
    redraw();
  };
  const color = (id: string, hex: string) => { st.colors.set(id, hex); st.on.add(id); redraw(); };
  showPaintModal(key, m, {
    back: st.back,
    close: closeOverlay,
    toggle,
    color,
    select: (id) => { st.selected = id; redraw(); },
    editor: {
      color: (hex) => {
        if (st.selected) { color(st.selected, hex); return; }
        st.all = hex;
        for (const id of st.on) st.colors.set(id, hex);
        redraw();
      },
      mode: (mode) => {
        if (st.selected) { st.modes.set(st.selected, mode); st.on.add(st.selected); redraw(); return; }
        st.allMode = mode;
        for (const id of st.on) st.modes.set(id, mode);
        redraw();
      },
      all: () => { st.selected = null; redraw(); },
      toggle: () => { if (st.selected) toggle(st.selected); },
    },
    every: (on) => { st.on = new Set(on ? st.layers.map((l) => l.id) : []); redraw(); },
    apply: () => void apply(key, st),
    getTool: () => void getTool(key, st),
  });
}

/** ValveResourceFormat, downloaded once; the window says whether it came. */
async function getTool(key: number, st: PaintState): Promise<void> {
  if (st.gettingTool) return;
  st.gettingTool = true;
  draw(key, st);
  const r = await window.api.tools.install('vrf');
  st.gettingTool = false;
  if (r.error) toast(r.error, 'error', 8000);
  else st.vrf = true;
  draw(key, st);
}

async function apply(key: number, st: PaintState): Promise<void> {
  const want = wanted(st);
  if (st.busy || !Object.keys(want).length) return;
  st.busy = true;
  draw(key, st);
  const r = await window.api.paint.install(st.hero, want, st.label, worn(st));
  st.busy = false;
  if (r.error || !('record' in r)) {
    toast(r.error || L`Не удалось перекрасить героя`, 'error', 8000);
  } else {
    st.installed = want;
    await refreshInstalledIndex();
    // textures Valve's compiler could not build again went in as the game has them: say so, not "done"
    const left = (r.record.generated as { left?: number } | undefined)?.left ?? 0;
    if (left) toast(L`${st.label}: частицы перекрашены, но текстур осталось как в игре: ${left}. Их собирает компилятор из Dota 2 Workshop Tools, подробности в журнале.`, 'error', 10000);
    else toast(L`Готово: ${st.label} в новых цветах. Запусти игру, чтобы увидеть.`, 'ok');
  }
  draw(key, st);
}
