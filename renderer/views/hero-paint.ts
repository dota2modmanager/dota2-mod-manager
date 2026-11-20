/* A hero recoloured part by part (issue #422): the window opened from the hero's window in the item
 * builder. It keeps a switch and a look (colour, mode, material) per key: a layer, or a part of a
 * model and a colour zone of its texture (catalog/paint/paint-recipe.ts), and the key the editor
 * works on; the 3D hero in it is painted from those as they change (catalog/paint/preview-paint.ts).
 * Nothing reaches the game until its button is pressed, and then the main process builds one pak
 * for the hero (crates/mm-core/src/looks/hero_paint_service.rs), a mod in My mods like any other. */
import { refreshInstalledIndex } from '../core/installed.ts';
import { toast } from '../ui/toast.ts';
import { showPaintModal } from '../catalog/modal/root.tsx';
import type { PaintCell, PaintModalModel } from '../catalog/paint/PaintModal.tsx';
import type { PaintLayer, PaintPartPicture } from '../api/content.ts';
import type { PreviewSlot } from '../api/preview3d.ts';
import { closeOverlay } from './catalog/overlay.ts';
import { isOpen, openWindow } from './item-builder.ts';
import { toHex } from '../catalog/arcana/tint.ts';
import type { PaintMode } from '../catalog/paint/paint-mode.ts';
import { MATERIAL_PRESETS, parseLook, splitKey, type Look } from '../catalog/paint/paint-recipe.ts';
import { previewPaint } from '../catalog/paint/preview-paint.ts';
import { editorOf, isModel, keyLabel, lookOf, moveKey, paintSummary, wantedValues } from './hero-paint-model.ts';

/** What the hero wears, as the hero's window shows him: the 3D stage's slots, and the item in each. */
export interface PaintPreview { hero: string; slots: PreviewSlot[]; sig: string; items: Record<string, string> }

export interface PaintState {
  hero: string;
  label: string;
  back: () => void;
  layers: PaintLayer[];
  /** the keys on: layers, and parts and zones of model layers */
  on: Set<string>;
  /** by key; a layer without one takes `all` and `allMode` */
  looks: Map<string, Look>;
  /** what is in the game now, to say whether the button changes anything */
  installed: Record<string, string> | null;
  all: string;
  allMode: PaintMode;
  /** the key the editor works on; null: all layers that are on */
  selected: string | null;
  busy: boolean;
  vrf: boolean;
  gettingTool: boolean;
  /** his portrait and his abilities' icons, as they come from the game */
  portrait: string | null;
  icons: Record<string, string>;
  gems: { key: string; name: string; hex: string }[];
  preview: PaintPreview | null;
  /** the model's textures as pictures with their zones, by file; asked for once a model layer is picked */
  pictures: Record<string, PaintPartPicture>;
  asked: Set<string>;
}

const START = '#7f5af0';

/** The hero's window for colours. back: the hero's own window, where it was opened from. */
export async function openPaint(hero: string, label: string, back: () => void, preview: PaintPreview | null = null): Promise<void> {
  const worn = preview ? [...new Set(Object.values(preview.items))] : [];
  const r = await window.api.paint.state(hero, worn);
  if (r.error || !('layers' in r)) { toast(r.error || L`Не удалось прочитать файлы героя`, 'error'); return; }
  const installed = r.installed?.layers ?? null;
  const looks = new Map<string, Look>();
  for (const [k, v] of Object.entries(installed || {})) { const l = parseLook(v); if (l) looks.set(k, l); }
  const first = [...looks.values()].find((l) => l.hex);
  const st: PaintState = {
    hero, label, back, layers: r.layers, installed,
    on: new Set(looks.keys()),
    looks,
    all: first?.hex || START,
    allMode: 'tint',
    selected: null,
    busy: false,
    vrf: r.vrf,
    gettingTool: false,
    portrait: null,
    icons: {},
    gems: [],
    preview,
    pictures: {},
    asked: new Set(),
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

/** A model layer's parts as pictures with their zones, once, when it is first picked. */
async function partPictures(key: number, st: PaintState, layerId: string): Promise<void> {
  const layer = st.layers.find((l) => l.id === layerId);
  const files = (layer?.parts ?? []).map((p) => p.file).filter((f) => !st.asked.has(f));
  if (!files.length) return;
  for (const f of files) st.asked.add(f);
  const got = await window.api.paint.parts(files).catch(() => ({} as Record<string, PaintPartPicture>));
  // one it could not read shows no picture and no zones, but does not wait for one
  for (const f of files) st.pictures[f] = got[f] ?? { picture: '', zones: [] };
  draw(key, st);
}

const same = (a: Record<string, string>, b: Record<string, string> | null) =>
  !!b && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k]?.toLowerCase() === v.toLowerCase());

const worn = (st: PaintState) => (st.preview ? [...new Set(Object.values(st.preview.items))] : []);

function draw(key: number, st: PaintState): void {
  if (!isOpen(key)) return;
  const cell = (id: string): PaintCell | null => {
    if (!st.layers.some((l) => l.id === id)) return null;
    const c = lookOf(st, id);
    const sel = st.selected ? splitKey(st.selected).layer === id : false;
    return { id, on: st.on.has(id), color: c.hex ?? st.all, mode: c.mode, selected: sel };
  };
  const named = (kinds: string[]) => st.layers.filter((l) => kinds.includes(l.kind))
    .reduce<{ key: string; name: string }[]>((out, l) => {
      const k = l.id.slice(l.id.indexOf(':') + 1);
      if (!out.some((a) => a.key === k)) out.push({ key: k, name: l.name || k });
      return out;
    }, []);
  const abilities = named(['ability', 'abilityIcon']);
  const items = named(['item', 'itemModel']);
  const want = wantedValues(st);
  const m: PaintModalModel = {
    hero: st.label,
    portrait: st.portrait,
    preview: st.preview && { ...st.preview, paint: previewPaint(st.layers, want, st.preview.items) },
    editor: editorOf(st),
    abilities: abilities.map((a) => ({ key: a.key, name: a.name, picture: st.icons[a.key] || null, effect: cell(`ability:${a.key}`), icon: cell(`abilityIcon:${a.key}`) })),
    own: { effects: cell('effects'), portrait: cell('portrait'), body: cell('body') },
    items: items.map((it) => ({ name: it.name, model: cell(`itemModel:${it.key}`), effect: cell(`item:${it.key}`) })),
    // layers with anything on: a part or zone counts for its layer, not as one more
    on: new Set(Object.keys(want).map((k) => splitKey(k).layer)).size,
    total: st.layers.length,
    summary: paintSummary(Object.keys(want).map((k) => keyLabel(st.layers, k))),
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
  // items drawn from one texture take one colour in the game: their layers move together
  const linked = (id: string) => [id, ...(splitKey(id).part || splitKey(id).zone ? [] : st.layers.find((l) => l.id === id)?.shares ?? [])];
  /** a key's look changed by `f`, and the key on */
  const change = (id: string, f: (l: Look) => Look) => {
    for (const x of linked(id)) { st.looks.set(x, f({ ...lookOf(st, x), mats: [...lookOf(st, x).mats] })); st.on.add(x); }
    redraw();
  };
  const select = (id: string) => {
    st.selected = id;
    const layer = st.layers.find((l) => l.id === splitKey(id).layer);
    if (layer && isModel(layer)) void partPictures(key, st, layer.id);
    redraw();
  };
  const toggle = (id: string) => {
    const off = st.on.has(id);
    for (const x of linked(id)) if (off) st.on.delete(x); else st.on.add(x);
    if (!off) { select(id); return; }
    redraw();
  };
  showPaintModal(key, m, {
    back: st.back,
    close: closeOverlay,
    toggle,
    color: (id, hex) => change(id, (l) => ({ ...l, hex })),
    select,
    editor: {
      color: (hex) => {
        if (st.selected) { change(st.selected, (l) => ({ ...l, hex })); return; }
        st.all = hex;
        for (const id of st.on) if (!splitKey(id).part && !splitKey(id).zone) st.looks.set(id, { ...lookOf(st, id), hex });
        redraw();
      },
      mode: (mode) => {
        if (st.selected) { change(st.selected, (l) => ({ ...l, mode, hex: l.hex ?? st.all, to: mode === 'grad' ? l.to ?? '#ffb020' : l.to })); return; }
        st.allMode = mode;
        for (const id of st.on) if (!splitKey(id).part && !splitKey(id).zone) st.looks.set(id, { ...lookOf(st, id), mode });
        redraw();
      },
      keep: () => { if (st.selected) change(st.selected, (l) => ({ ...l, hex: null })); },
      at: (n) => { if (st.selected) change(st.selected, (l) => ({ ...l, at: n, mode: 'grad', hex: l.hex ?? st.all })); },
      to: (hex) => { if (st.selected) change(st.selected, (l) => ({ ...l, to: hex, mode: 'grad', hex: l.hex ?? st.all })); },
      mat: (i, n) => { if (st.selected) change(st.selected, (l) => ({ ...l, mats: l.mats.map((x, j) => (j === i ? n : x)) })); },
      preset: (name) => {
        const p = MATERIAL_PRESETS.find((x) => x.key === name);
        if (p && st.selected) change(st.selected, (l) => ({ ...l, mats: [...p.mats] }));
      },
      part: (part) => { if (st.selected) select(moveKey(st.selected, { part })); },
      zone: (zone) => { if (st.selected) select(moveKey(st.selected, { zone })); },
      all: () => { st.selected = null; redraw(); },
      toggle: () => { if (st.selected) toggle(st.selected); },
    },
    every: (on) => { st.on = new Set(on ? [...st.layers.map((l) => l.id), ...[...st.looks.keys()].filter((k) => k.includes('@') || k.includes('~'))] : []); redraw(); },
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
  const want = wantedValues(st);
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
