/* A cursor set of the user's own: the card first among the cursors, the Workshop's tile, and the
 * window (catalog/cursor/CursorModal.tsx). Each cursor is the game's, one of the game's cursor sets'
 * or a picture of the user's; every one that is not the game's is drawn here on a canvas at each size
 * the game keeps it in, and the core writes them as the game's files and puts the set in My mods
 * (crates/mm-core/src/looks/cursor_maker.rs). */
import { refreshInstalledIndex } from '../../core/installed.ts';
import { state as store } from '../../core/store.ts';
import { switchView } from '../../core/router.ts';
import { toast } from '../../ui/toast.ts';
import { showCursorModal } from '../../catalog/modal/root.tsx';
import { kindsOf, packName, type CursorKind } from '../../catalog/cursor/kinds.ts';
import { cleanDesign, EMPTY_DESIGN, picturesOf, place, sourceOf, tipOf, wholePack, withPack, withSource, type CursorDesign, type Source } from '../../catalog/cursor/design.ts';
import { drawPicture, pngOf } from '../../catalog/cursor/draw.ts';
import type { CursorModalModel, CursorTile, PlayMode } from '../../catalog/cursor/model.ts';
import type { CursorPack, DrawnCursor, GameCursor } from '../../api/cursor.ts';
import { closeOverlay, openOverlay, sharesOverlay, takeOverlay } from './overlay.ts';
import { screen } from './state.ts';

interface Picture { img: HTMLImageElement; png: Uint8Array; url: string; tip: [number, number] }

let open = false;
let game: GameCursor[] = [];
let packs: CursorPack[] = [];
let kinds: CursorKind[] = [];
let design: CursorDesign = EMPTY_DESIGN;
let installedId: string | null = null;
let savedKey: string | null = null;
let selected: string | null = null;
let play: PlayMode = 'move';
let busy = false;
const pics = new Map<string, Picture>();
/** the sets' pictures, decoded once: by "pack|cursor" */
const packImages = new Map<string, HTMLImageElement>();
sharesOverlay(() => { open = false; });

type Generated = { cursor?: unknown };
const mine = () => [...store.installedIndex.values()].find((r) => typeof (r.generated as Generated | undefined)?.cursor === 'object') ?? null;

/** The card first among the cursors. */
export function cursorLead(category: string): { installed: boolean } | null {
  return category === 'cursors' ? { installed: !!mine() } : null;
}

/** The Workshop's line on the set: on, or nothing. */
export const cursorOn = (): boolean => !!mine();

const MAX = 256;

/** A picture of the user's, made at most 256px, kept as a PNG by its sha1. */
async function takePicture(src: Blob): Promise<string> {
  const bitmap = await createImageBitmap(src).catch(() => null);
  if (!bitmap) throw new Error(L`Не удалось открыть картинку`);
  const k = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bitmap.width * k));
  c.height = Math.max(1, Math.round(bitmap.height * k));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const png = await pngOf(c);
  const id = [...new Uint8Array(await crypto.subtle.digest('SHA-1', png as Uint8Array<ArrayBuffer>))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!pics.has(id)) {
    const url = URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    const img = new Image();
    img.src = url;
    await img.decode();
    pics.set(id, { img, png, url, tip: tipOf(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height) });
  }
  return id;
}

const keyOf = (d: CursorDesign) => JSON.stringify(d);
const packOf = (id: string) => packs.find((p) => p.id === id);

/** The picture a source draws from, and its hotspot as a share of the cursor; null: the game's. */
function pictureOf(name: string, s: Source): { img: HTMLImageElement; url: string; hot: [number, number] } | null {
  if (s.from === 'own') {
    const p = pics.get(s.picture);
    return p ? { img: p.img, url: p.url, hot: s.hot } : null;
  }
  if (s.from === 'pack') {
    const c = packOf(s.pack)?.cursors[name];
    const img = packImages.get(`${s.pack}|${name}`);
    return c && img ? { img, url: c.picture, hot: c.hot } : null;
  }
  return null;
}

const fromText = (s: Source) => (s.from === 'own' ? L`Своя` : s.from === 'pack' ? packName(s.pack) : L`Игра`);

function tiles(): CursorTile[] {
  return kinds.map((k) => {
    const g = game.find((x) => x.name === k.name)!;
    const source = sourceOf(design, k.name);
    const p = pictureOf(k.name, source);
    const hot = p ? p.hot : g.hot;
    const small = p ? drawPicture(p.img, 48).toDataURL('image/png') : null;
    const css = !p && g.width > 64 ? 'auto' : `url(${small ?? g.picture}) ${Math.round(hot[0] * (p ? 48 : g.width))} ${Math.round(hot[1] * (p ? 48 : g.width))}, auto`;
    const options = packs.filter((x) => x.cursors[k.name]).map((x) => ({ id: x.id, name: packName(x.id), picture: x.cursors[k.name].picture }));
    return { kind: k, source, from: fromText(source), game: g.picture, mine: p?.url ?? null, hot, css, options };
  });
}

function model(): CursorModalModel {
  const def = game.find((g) => g.name === 'cursor_default');
  return {
    tiles: tiles(),
    packs: packs.map((p) => ({ id: p.id, name: packName(p.id), picture: (p.cursors.cursor_default ?? Object.values(p.cursors)[0]).picture, count: Object.keys(p.cursors).length })),
    whole: wholePack(design, packs.map((p) => ({ id: p.id, names: Object.keys(p.cursors).filter((n) => kinds.some((k) => k.name === n)) }))),
    gamePicture: def?.picture ?? '', selected, play, installed: installedId !== null, saved: savedKey === keyOf(design), busy,
  };
}

function setDesign(d: CursorDesign): void {
  design = d;
  draw();
}

const fail = (err: unknown) => toast(String((err as Error)?.message || err), 'error', 8000);

function draw(): void {
  if (!open) return;
  showCursorModal(model(), {
    close: closeOverlay,
    pack: (id) => {
      if (!id) { setDesign(EMPTY_DESIGN); return; }
      const p = packOf(id);
      if (p) setDesign(withPack(EMPTY_DESIGN, id, Object.keys(p.cursors).filter((n) => kinds.some((k) => k.name === n))));
    },
    select: (name) => { selected = name; draw(); },
    source: (name, s) => setDesign(withSource(design, name, s)),
    own: (name, f) => void takePicture(f).then((id) => {
      const p = pics.get(id)!;
      // the spell cursors aim with their middle; anything else with its tip, wherever the picture sits
      const b = place(p.img.naturalWidth, p.img.naturalHeight, 1);
      const spell = kinds.find((x) => x.name === name)?.group === 'spell';
      const hot: [number, number] = spell ? [0.5, 0.5] : [b.x + p.tip[0] * b.w, b.y + p.tip[1] * b.h];
      selected = name;
      setDesign(withSource(design, name, { from: 'own', picture: id, hot }));
    }, fail),
    hot: (name, at) => { const s = sourceOf(design, name); if (s.from === 'own') setDesign(withSource(design, name, { ...s, hot: at })); },
    play: (p) => { play = p; draw(); },
    install: () => void install(),
  });
}

function bytesOfUri(uri: string): Uint8Array {
  const bin = atob(uri.slice(uri.indexOf(',') + 1));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function image(src: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img, () => null);
}

/** The window, on the set made before when there is one. */
export async function openCursor(from: Element | null): Promise<void> {
  const r = await window.api.cursor.state();
  if (r.error || !('cursors' in r)) { toast(r.error || L`Не удалось прочитать курсоры игры`, 'error'); return; }
  game = r.cursors;
  packs = r.packs ?? [];
  kinds = kindsOf(game.map((g) => g.name));
  await Promise.all(packs.flatMap((p) => Object.entries(p.cursors).map(async ([name, c]) => {
    const key = `${p.id}|${name}`;
    if (packImages.has(key)) return;
    const img = await image(c.picture);
    if (img) packImages.set(key, img);
  })));
  selected = null;
  design = EMPTY_DESIGN;
  installedId = null;
  savedKey = keyOf(EMPTY_DESIGN);
  if (r.installed) {
    for (const [id, uri] of Object.entries(r.installed.pictures)) {
      if (pics.has(id)) continue;
      const img = await image(uri);
      if (img) pics.set(id, { img, png: bytesOfUri(uri), url: uri, tip: [0, 0] });
    }
    const d = cleanDesign(r.installed.design);
    // a picture the folder lost, or a set the game no longer has, is the game's cursor again
    design = { states: Object.fromEntries(Object.entries(d.states).filter(([, s]) => (s.from === 'own' ? pics.has(s.picture) : s.from === 'pack' ? !!packOf(s.pack) : false))) };
    installedId = r.installed.id;
    savedKey = keyOf(design);
  }
  takeOverlay();
  open = true;
  openOverlay(draw, from);
}

async function install(): Promise<void> {
  if (busy) return;
  busy = true;
  draw();
  try {
    const drawn: DrawnCursor[] = [];
    for (const k of kinds) {
      const p = pictureOf(k.name, sourceOf(design, k.name));
      if (!p) continue;
      const g = game.find((x) => x.name === k.name)!;
      const pngs: Record<string, Uint8Array> = {};
      for (const size of new Set([32, ...g.sizes])) pngs[String(size)] = await pngOf(drawPicture(p.img, size));
      drawn.push({ name: k.name, hot: p.hot, pngs });
    }
    if (!drawn.length && installedId) {
      // every cursor the game's again: the set is no more
      const r = await window.api.mods.remove(installedId);
      if (r.error) throw new Error(r.error);
      installedId = null;
      toast(L`Курсоры снова как в игре`);
    } else {
      const pictures = picturesOf(design).filter((id) => pics.has(id)).map((id) => ({ id, png: pics.get(id)!.png }));
      const r = await window.api.cursor.install(design, drawn, pictures).catch((err) => ({ error: String(err?.message || err) }));
      if (r.error) throw new Error(r.error);
      installedId = (r as { record?: { id: string } }).record?.id ?? installedId;
      toast(L`Собрано и стоит в «Моих модах»`);
    }
    savedKey = keyOf(design);
    await refreshInstalledIndex();
    await screen.redraw();
  } catch (err) {
    fail(err);
  } finally {
    busy = false;
    draw();
  }
}

/** From My mods: the cursors, with the window open. */
export async function cursorFromLibrary(): Promise<void> {
  store.activeCategory = 'cursors';
  await switchView('catalog');
  await screen.redraw();
  await openCursor(null);
}
